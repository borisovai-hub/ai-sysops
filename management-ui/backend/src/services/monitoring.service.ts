import { EventEmitter } from 'node:events';
import { eq, and, desc, sql, count, gt, avg } from 'drizzle-orm';
import type { MonitoringConfig, ServiceUptimeStats } from '@management-ui/shared';
import { DEFAULT_MONITORING_CONFIG } from '@management-ui/shared';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { createAlert, resolveAlertsBySource, cleanupResolvedAlerts } from './alert.service.js';
import { cleanupOldEvents } from './security.service.js';
import { listServers, getEnabledServers } from './servers.service.js';
import { nodeAgentClient } from '../lib/node-agent-client.js';
import type { ServerRecord } from '@management-ui/shared';

export const monitoringEmitter = new EventEmitter();

type HealthCheckSelect = typeof schema.healthChecks.$inferSelect;

export interface ServiceCheckResult {
  status: 'up' | 'down' | 'degraded';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  details?: Record<string, unknown>;
}

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

// --- MonitoringService ---

class MonitoringService {
  private static instance: MonitoringService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private config: MonitoringConfig = { ...DEFAULT_MONITORING_CONFIG };
  // Anti-flapping state ключ — `${serverName}:${serviceName}`
  private lastStatus = new Map<string, { status: string; consecutiveFailures: number }>();

  private constructor() {}

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) MonitoringService.instance = new MonitoringService();
    return MonitoringService.instance;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.config = await loadMonitoringConfig();
    if (!this.config.enabled || !this.config.healthChecks.enabled) return;
    const interval = this.config.healthChecks.intervalMs || 60000;
    logger.info(`Мониторинг запущен (multi-server fan-out), интервал ${interval}ms`);
    this.timer = setInterval(() => void this.runAllChecks(), interval);
    setTimeout(() => void this.runAllChecks(), 5000);
    this.retentionTimer = setInterval(() => void this.runRetention(), 86400000);
    setTimeout(() => void this.runRetention(), 60000);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.retentionTimer) { clearInterval(this.retentionTimer); this.retentionTimer = null; }
    logger.info('Мониторинг остановлен');
  }

  async reconfigure(config: MonitoringConfig): Promise<void> {
    this.config = config;
    this.stop();
    if (config.enabled && config.healthChecks.enabled) await this.start();
  }

  /**
   * Fan-out: для каждого enabled-сервера запросить /services/status у его node-agent'а.
   */
  async runAllChecks(): Promise<void> {
    const servers = getEnabledServers();
    if (servers.length === 0) {
      logger.warn('Мониторинг: реестр серверов пуст, пропускаем проверки');
      return;
    }

    const results = await Promise.allSettled(servers.map((s) => this.runChecksForServer(s)));
    for (const r of results) {
      if (r.status === 'rejected') logger.error('runChecksForServer rejected:', r.reason);
    }
  }

  async runChecksForServer(server: ServerRecord): Promise<void> {
    const client = nodeAgentClient(server);
    const allowedServices = this.config.healthChecks.services;
    const resp = await client.getServicesStatus();

    if (!resp.reachable) {
      // Записываем синтетический "agent-unreachable" статус
      await this.processResult(server.name, 'agent', {
        status: 'down',
        responseTimeMs: 0,
        error: resp.error || 'agent unreachable',
      });
      return;
    }

    const services = resp.services || {};
    for (const [name, result] of Object.entries(services)) {
      if (allowedServices.length > 0 && !allowedServices.includes(name)) continue;
      await this.processResult(server.name, name, result as ServiceCheckResult);
    }
    // Дополнительно записываем "agent" как 'up' — индикатор связности с сервером
    await this.processResult(server.name, 'agent', { status: 'up', responseTimeMs: 0 });
  }

  /**
   * Прогон одного сервиса по имени. Ищем сервер в реестре, который его проверяет.
   * Параметр serverName опционален: если не указан, используется первый enabled.
   */
  async runSingleCheck(serviceName: string, serverName?: string): Promise<ServiceCheckResult> {
    const server = serverName
      ? listServers().find((s) => s.name === serverName)
      : getEnabledServers()[0];
    if (!server) return { status: 'down', responseTimeMs: 0, error: `server not found: ${serverName || 'any'}` };

    const client = nodeAgentClient(server);
    if (serviceName === 'agent') {
      const h = await client.health();
      const result: ServiceCheckResult = h.reachable
        ? { status: 'up', responseTimeMs: 0 }
        : { status: 'down', responseTimeMs: 0, error: h.error };
      await this.processResult(server.name, 'agent', result);
      return result;
    }

    const resp = await client.getServicesStatus();
    if (!resp.reachable) {
      const result: ServiceCheckResult = { status: 'down', responseTimeMs: 0, error: resp.error || 'agent unreachable' };
      await this.processResult(server.name, serviceName, result);
      return result;
    }
    const r = (resp.services?.[serviceName] as ServiceCheckResult | undefined) ?? {
      status: 'down', responseTimeMs: 0, error: 'service not in agent response',
    };
    await this.processResult(server.name, serviceName, r);
    return r;
  }

  private async processResult(serverName: string, serviceName: string, result: ServiceCheckResult): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    await db.insert(schema.healthChecks).values({
      serverName,
      serviceName,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      statusCode: result.statusCode ?? null,
      error: result.error ?? null,
      details: result.details ? JSON.stringify(result.details) : null,
      checkedAt: now,
    });

    const key = `${serverName}:${serviceName}`;
    const prev = this.lastStatus.get(key);
    const isDown = result.status === 'down';
    const wasDown = prev?.status === 'down';

    if (isDown) {
      const failures = (prev?.consecutiveFailures ?? 0) + 1;
      this.lastStatus.set(key, { status: 'down', consecutiveFailures: failures });

      if (failures >= 2) {
        const alert = await createAlert({
          severity: 'critical',
          category: 'health',
          source: `health:${serverName}:${serviceName}`,
          title: `${serverName}/${serviceName} недоступен`,
          message: result.error || `Сервис ${serviceName} на ${serverName} не отвечает (${failures} подряд)`,
        });
        monitoringEmitter.emit('alert', alert);
      }
    } else {
      this.lastStatus.set(key, { status: result.status, consecutiveFailures: 0 });
      if (wasDown) {
        await resolveAlertsBySource(`health:${serverName}:${serviceName}`);
        monitoringEmitter.emit('status_change', { server: serverName, service: serviceName, from: 'down', to: result.status });
      }
    }

    if (prev && prev.status !== result.status) {
      monitoringEmitter.emit('status_change', { server: serverName, service: serviceName, from: prev.status, to: result.status });
    }
  }

  /**
   * Последний статус каждой пары (server, service).
   */
  async getLatestStatuses(): Promise<Record<string, Record<string, HealthCheckSelect>>> {
    const db = getDb();
    // Группируем по (server, service), берём latest
    const rows = await db.select().from(schema.healthChecks)
      .orderBy(desc(schema.healthChecks.checkedAt));

    const result: Record<string, Record<string, HealthCheckSelect>> = {};
    for (const row of rows) {
      result[row.serverName] = result[row.serverName] || {};
      if (!result[row.serverName][row.serviceName]) {
        result[row.serverName][row.serviceName] = row;
      }
    }
    return result;
  }

  async getServiceHistory(serverName: string, serviceName: string, hours: number): Promise<HealthCheckSelect[]> {
    const db = getDb();
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    return db.select().from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serverName, serverName),
        eq(schema.healthChecks.serviceName, serviceName),
        gt(schema.healthChecks.checkedAt, since),
      ))
      .orderBy(desc(schema.healthChecks.checkedAt));
  }

  async getUptimeStats(serverName: string, serviceName: string, days: number): Promise<ServiceUptimeStats> {
    const db = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const baseFilter = and(
      eq(schema.healthChecks.serverName, serverName),
      eq(schema.healthChecks.serviceName, serviceName),
      gt(schema.healthChecks.checkedAt, since),
    );

    const [totalRow] = await db.select({ total: count() }).from(schema.healthChecks).where(baseFilter);
    const [upRow] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(and(baseFilter, eq(schema.healthChecks.status, 'up')));
    const [avgRow] = await db.select({ avgMs: avg(schema.healthChecks.responseTimeMs) }).from(schema.healthChecks).where(baseFilter);
    const [incRow] = await db.select({ total: count() }).from(schema.healthChecks)
      .where(and(baseFilter, eq(schema.healthChecks.status, 'down')));
    const [lastDownRow] = await db.select({ checkedAt: schema.healthChecks.checkedAt }).from(schema.healthChecks)
      .where(and(
        eq(schema.healthChecks.serverName, serverName),
        eq(schema.healthChecks.serviceName, serviceName),
        eq(schema.healthChecks.status, 'down'),
      ))
      .orderBy(desc(schema.healthChecks.checkedAt))
      .limit(1);

    const totalCount = totalRow?.total ?? 0;
    const upCount = upRow?.total ?? 0;

    return {
      serviceName: `${serverName}/${serviceName}`,
      uptimePercent: totalCount > 0 ? Math.round((upCount / totalCount) * 10000) / 100 : 100,
      avgResponseMs: Math.round(Number(avgRow?.avgMs) || 0),
      incidents: incRow?.total ?? 0,
      lastDown: lastDownRow?.checkedAt ?? null,
    };
  }

  /**
   * Uptime для всех (server, service) за period.
   */
  async getAllUptimeStats(days: number): Promise<ServiceUptimeStats[]> {
    const latest = await this.getLatestStatuses();
    const out: ServiceUptimeStats[] = [];
    for (const [server, services] of Object.entries(latest)) {
      for (const service of Object.keys(services)) {
        out.push(await this.getUptimeStats(server, service, days));
      }
    }
    return out;
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
