import { EventEmitter } from 'node:events';
import axios from 'axios';
import { eq, and, desc, sql, count, gt, avg } from 'drizzle-orm';
import type { MonitoringConfig, CheckResult, ServiceUptimeStats } from '@management-ui/shared';
import { DEFAULT_MONITORING_CONFIG } from '@management-ui/shared';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { execCommandSafe } from '../lib/exec.js';
import { loadAppConfig, loadInstallConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createAlert, resolveAlertsBySource, cleanupResolvedAlerts } from './alert.service.js';
import { cleanupOldEvents } from './security.service.js';

// --- Event emitter ---

export const monitoringEmitter = new EventEmitter();

// --- Config persistence ---

export async function loadMonitoringConfig(): Promise<MonitoringConfig> {
  try {
    const db = getDb();
    const [row] = await db.select().from(schema.configEntries)
      .where(eq(schema.configEntries.key, 'monitoring_config'));
    if (row) return JSON.parse(row.value) as MonitoringConfig;
  } catch {
    // DB not ready or parse error
  }
  return { ...DEFAULT_MONITORING_CONFIG };
}

export async function saveMonitoringConfig(config: MonitoringConfig): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const value = JSON.stringify(config);
  await db.insert(schema.configEntries)
    .values({ key: 'monitoring_config', value, source: 'monitoring', updatedAt: now })
    .onConflictDoUpdate({
      target: schema.configEntries.key,
      set: { value, updatedAt: now },
    });
}

// --- Built-in checkers ---

async function checkTraefik(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await axios.get('http://localhost:8080/api/rawdata', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkAuthelia(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await axios.get('http://localhost:9091/api/health', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkFrps(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { frpsDashboardRequest } = await import('../lib/frp-api.js');
    await frpsDashboardRequest('/api/serverinfo');
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: 200 };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkUmami(): Promise<CheckResult> {
  const start = Date.now();
  const dockerResult = execCommandSafe('docker ps --filter name=umami --format "{{.Names}}"');
  if (!dockerResult.success || !dockerResult.stdout.includes('umami')) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: 'Container not running' };
  }
  try {
    const resp = await axios.get('http://localhost:3001/api/heartbeat', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'degraded', responseTimeMs: Date.now() - start, error: err.message, details: { containerRunning: true } };
  }
}

async function checkDnsApi(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await axios.get('http://localhost:5353/api/health', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkGitlab(): Promise<CheckResult> {
  const start = Date.now();
  const config = loadAppConfig();
  if (!config.gitlab_url) {
    return { status: 'down', responseTimeMs: 0, error: 'gitlab_url not configured' };
  }
  try {
    const resp = await axios.get(`${config.gitlab_url}/api/v4/version`, {
      timeout: 5000,
      headers: config.gitlab_token ? { 'PRIVATE-TOKEN': config.gitlab_token } : undefined,
    });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status, details: { version: resp.data?.version } };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkStrapi(): Promise<CheckResult> {
  const start = Date.now();
  const config = loadAppConfig();
  if (!config.strapi_url) {
    return { status: 'down', responseTimeMs: 0, error: 'strapi_url not configured' };
  }
  try {
    const resp = await axios.get(`${config.strapi_url}/_health`, { timeout: 5000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkRuProxy(): Promise<CheckResult> {
  const start = Date.now();
  const installConfig = loadInstallConfig();
  const apiUrl = installConfig.ru_proxy_api_url;
  if (!apiUrl) {
    return { status: 'down', responseTimeMs: 0, error: 'ru_proxy_api_url not configured' };
  }
  try {
    const resp = await axios.get(`${apiUrl}/api/health`, {
      timeout: 10000,
      headers: installConfig.ru_proxy_api_token
        ? { Authorization: `Bearer ${installConfig.ru_proxy_api_token}` }
        : undefined,
    });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err: any) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: err.message };
  }
}

async function checkManagementUi(): Promise<CheckResult> {
  return { status: 'up', responseTimeMs: 0, details: { self: true } };
}

// --- Monitoring Service ---

type HealthCheckSelect = typeof schema.healthChecks.$inferSelect;

class MonitoringService {
  private static instance: MonitoringService;
  private checkers = new Map<string, () => Promise<CheckResult>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private config: MonitoringConfig = { ...DEFAULT_MONITORING_CONFIG };
  private lastStatus = new Map<string, { status: string; consecutiveFailures: number }>();

  private constructor() {
    this.registerChecker('traefik', checkTraefik);
    this.registerChecker('authelia', checkAuthelia);
    this.registerChecker('frps', checkFrps);
    this.registerChecker('umami', checkUmami);
    this.registerChecker('dns-api', checkDnsApi);
    this.registerChecker('gitlab', checkGitlab);
    this.registerChecker('strapi', checkStrapi);
    this.registerChecker('ru-proxy', checkRuProxy);
    this.registerChecker('management-ui', checkManagementUi);
  }

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  registerChecker(name: string, checker: () => Promise<CheckResult>): void {
    this.checkers.set(name, checker);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.config = await loadMonitoringConfig();
    if (!this.config.enabled || !this.config.healthChecks.enabled) return;
    const interval = this.config.healthChecks.intervalMs || 60000;
    logger.info(`Мониторинг запущен, интервал ${interval}ms`);
    this.timer = setInterval(() => void this.runAllChecks(), interval);
    // Первая проверка через 5 секунд после старта
    setTimeout(() => void this.runAllChecks(), 5000);

    // Data retention — раз в сутки
    this.retentionTimer = setInterval(() => void this.runRetention(), 86400000);
    // Первый запуск retention через 1 минуту
    setTimeout(() => void this.runRetention(), 60000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    logger.info('Мониторинг остановлен');
  }

  async reconfigure(config: MonitoringConfig): Promise<void> {
    this.config = config;
    this.stop();
    if (config.enabled && config.healthChecks.enabled) {
      await this.start();
    }
  }

  async runAllChecks(): Promise<void> {
    const allowedServices = this.config.healthChecks.services;
    const entries = [...this.checkers.entries()].filter(
      ([name]) => allowedServices.length === 0 || allowedServices.includes(name),
    );

    const results = await Promise.allSettled(
      entries.map(async ([name, checker]) => {
        const result = await checker();
        return { name, result };
      }),
    );

    for (const settled of results) {
      if (settled.status === 'rejected') continue;
      const { name, result } = settled.value;
      await this.processResult(name, result);
    }
  }

  async runSingleCheck(name: string): Promise<CheckResult> {
    const checker = this.checkers.get(name);
    if (!checker) {
      return { status: 'down', responseTimeMs: 0, error: `Checker "${name}" not found` };
    }
    const result = await checker();
    await this.processResult(name, result);
    return result;
  }

  private async processResult(name: string, result: CheckResult): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    // Write to DB
    await db.insert(schema.healthChecks).values({
      serviceName: name,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode ?? null,
      error: result.error ?? null,
      details: result.details ? JSON.stringify(result.details) : null,
      checkedAt: now,
    });

    // Anti-flapping
    const prev = this.lastStatus.get(name);
    const isDown = result.status === 'down';
    const wasDown = prev?.status === 'down';

    if (isDown) {
      const failures = (prev?.consecutiveFailures ?? 0) + 1;
      this.lastStatus.set(name, { status: 'down', consecutiveFailures: failures });

      // Alert after 2 consecutive failures
      if (failures >= 2) {
        const alert = await createAlert({
          severity: 'critical',
          category: 'health',
          source: `health:${name}`,
          title: `${name} недоступен`,
          message: result.error || `Сервис ${name} не отвечает (${failures} подряд)`,
        });
        monitoringEmitter.emit('alert', alert);
      }
    } else {
      this.lastStatus.set(name, { status: result.status, consecutiveFailures: 0 });

      // Auto-resolve alerts when service recovers
      if (wasDown) {
        await resolveAlertsBySource(`health:${name}`);
        monitoringEmitter.emit('status_change', { service: name, from: 'down', to: result.status });
      }
    }

    // Emit status change for any transition
    if (prev && prev.status !== result.status) {
      monitoringEmitter.emit('status_change', { service: name, from: prev.status, to: result.status });
    }
  }

  async getLatestStatuses(): Promise<Record<string, HealthCheckSelect>> {
    const db = getDb();
    const services = [...this.checkers.keys()];
    const result: Record<string, HealthCheckSelect> = {};

    for (const name of services) {
      const [row] = await db.select().from(schema.healthChecks)
        .where(eq(schema.healthChecks.serviceName, name))
        .orderBy(desc(schema.healthChecks.checkedAt))
        .limit(1);
      if (row) result[name] = row;
    }
    return result;
  }

  async getServiceHistory(name: string, hours: number): Promise<HealthCheckSelect[]> {
    const db = getDb();
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    return db.select().from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        gt(schema.healthChecks.checkedAt, since),
      ))
      .orderBy(desc(schema.healthChecks.checkedAt));
  }

  async getUptimeStats(name: string, days: number): Promise<ServiceUptimeStats> {
    const db = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [totalRow] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        gt(schema.healthChecks.checkedAt, since),
      ));

    const [upRow] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        eq(schema.healthChecks.status, 'up'),
        gt(schema.healthChecks.checkedAt, since),
      ));

    const [avgRow] = await db.select({ avgMs: avg(schema.healthChecks.responseTimeMs) }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        gt(schema.healthChecks.checkedAt, since),
      ));

    const [incRow] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        eq(schema.healthChecks.status, 'down'),
        gt(schema.healthChecks.checkedAt, since),
      ));

    const [lastDownRow] = await db.select({ checkedAt: schema.healthChecks.checkedAt }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serviceName, name),
        eq(schema.healthChecks.status, 'down'),
      ))
      .orderBy(desc(schema.healthChecks.checkedAt))
      .limit(1);

    const totalCount = totalRow?.total ?? 0;
    const upCount = upRow?.total ?? 0;

    return {
      serviceName: name,
      uptimePercent: totalCount > 0 ? Math.round((upCount / totalCount) * 10000) / 100 : 100,
      avgResponseMs: Math.round(Number(avgRow?.avgMs) || 0),
      incidents: incRow?.total ?? 0,
      lastDown: lastDownRow?.checkedAt ?? null,
    };
  }

  async getAllUptimeStats(days: number): Promise<ServiceUptimeStats[]> {
    const names = [...this.checkers.keys()];
    return Promise.all(names.map(name => this.getUptimeStats(name, days)));
  }

  async getOverallUptime(days: number): Promise<number> {
    const stats = await this.getAllUptimeStats(days);
    if (stats.length === 0) return 100;
    const sum = stats.reduce((acc, s) => acc + s.uptimePercent, 0);
    return Math.round((sum / stats.length) * 100) / 100;
  }

  private async runRetention(): Promise<void> {
    try {
      const r = this.config.retention;
      const checks = await this.cleanupOldChecks(r.healthCheckDays);
      const alerts = await cleanupResolvedAlerts(r.alertDays);
      const events = await cleanupOldEvents(r.securityEventDays);
      if (checks > 0 || alerts > 0 || events > 0) {
        logger.info(`Retention: удалено ${checks} checks, ${alerts} alerts, ${events} security events`);
      }
    } catch (err) {
      logger.error('Retention cleanup error:', err);
    }
  }

  async cleanupOldChecks(days: number): Promise<number> {
    const db = getDb();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    // Count before delete (libsql drizzle doesn't expose changes count directly)
    const [before] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(sql`${schema.healthChecks.checkedAt} < ${cutoff}`);
    const toDelete = before?.total ?? 0;

    if (toDelete > 0) {
      await db.delete(schema.healthChecks)
        .where(sql`${schema.healthChecks.checkedAt} < ${cutoff}`);
    }

    return toDelete;
  }
}

export const monitoringService = MonitoringService.getInstance();
