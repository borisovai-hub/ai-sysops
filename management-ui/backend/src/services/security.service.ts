import { promisify } from 'node:util';
import childProcess from 'node:child_process';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import type { SecurityEventRow } from '@management-ui/shared';
import { getDb } from '../db/index.js';
import { securityEvents } from '../db/schema.js';
import { createAlert } from './alert.service.js';

const exec = promisify(childProcess.exec);

// --- Helpers ---

type SecurityEventInsert = typeof securityEvents.$inferInsert;

function nowISO(): string {
  return new Date().toISOString();
}

async function insertEvent(event: Omit<SecurityEventInsert, 'createdAt'>): Promise<SecurityEventRow> {
  const db = getDb();
  const [row] = await db.insert(securityEvents).values({
    ...event,
    createdAt: nowISO(),
  }).returning();
  return row as SecurityEventRow;
}

// Suspicious path patterns (scanners, bots)
const SUSPICIOUS_PATHS = [
  '.env', '.git', 'wp-admin', 'wp-login', 'phpmyadmin',
];

// System Traefik configs that intentionally have no Authelia middleware
const SYSTEM_CONFIGS = ['authelia.yml', 'site.yml', 'tunnels.yml'];

// --- Authelia Log Analysis ---

export async function analyzeAutheliaLogs(hours: number): Promise<SecurityEventRow[]> {
  const events: SecurityEventRow[] = [];

  try {
    const { stdout } = await exec(
      `journalctl -u authelia --since "${hours} hours ago" -o json --no-pager 2>/dev/null`,
      { maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout.trim()) return events;

    // Parse JSON lines
    interface AutheliaLogEntry {
      level?: string;
      MESSAGE?: string;
      msg?: string;
      _HOSTNAME?: string;
      remote_ip?: string;
      username?: string;
    }

    const failedByIp = new Map<string, { count: number; usernames: Set<string> }>();
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      let entry: AutheliaLogEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const level = entry.level ?? '';
      const message = entry.MESSAGE ?? entry.msg ?? '';

      if (level !== 'error' && level !== 'warning') continue;

      // Detect failed logins
      const isFailedLogin = /unsuccessful|failed/i.test(message);
      if (!isFailedLogin) continue;

      // Extract IP and username from log entry
      const ipMatch = message.match(/(?:remote_ip|client)[:=]\s*["']?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
      const usernameMatch = message.match(/(?:username|user)[:=]\s*["']?(\S+?)["',\s}]/i);

      const sourceIp = ipMatch?.[1] ?? entry.remote_ip ?? null;
      const username = usernameMatch?.[1] ?? entry.username ?? null;

      const ev = await insertEvent({
        eventType: 'failed_login',
        severity: 'medium',
        sourceIp,
        username,
        serviceName: 'authelia',
        description: `Failed login attempt: ${message.substring(0, 200)}`,
        details: JSON.stringify({ level, message }),
        resolved: false,
      });
      events.push(ev);

      // Track for brute force detection
      if (sourceIp) {
        const entry = failedByIp.get(sourceIp) ?? { count: 0, usernames: new Set<string>() };
        entry.count++;
        if (username) entry.usernames.add(username);
        failedByIp.set(sourceIp, entry);
      }
    }

    // Brute force detection: threshold defaults to 5
    const BRUTE_FORCE_THRESHOLD = 5;
    for (const [ip, data] of failedByIp) {
      if (data.count < BRUTE_FORCE_THRESHOLD) continue;

      const usernames = [...data.usernames].join(', ') || 'unknown';
      const ev = await insertEvent({
        eventType: 'brute_force',
        severity: 'high',
        sourceIp: ip,
        username: usernames,
        serviceName: 'authelia',
        description: `Brute force detected: ${data.count} failed attempts from ${ip} (users: ${usernames})`,
        details: JSON.stringify({ attemptCount: data.count, usernames: [...data.usernames] }),
        resolved: false,
      });
      events.push(ev);

      await createAlert({
        severity: 'critical',
        category: 'security',
        source: `security:brute_force:${ip}`,
        title: `Brute force: ${ip}`,
        message: `${data.count} failed login attempts from ${ip} targeting: ${usernames}`,
        metadata: JSON.stringify({ ip, count: data.count, usernames: [...data.usernames] }),
      });
    }
  } catch {
    // journalctl not available (dev/non-Linux) -- graceful degradation
  }

  return events;
}

// --- Traefik Traffic Analysis ---

export async function analyzeTraefikTraffic(minutes: number): Promise<SecurityEventRow[]> {
  const events: SecurityEventRow[] = [];

  try {
    const { stdout } = await exec(
      'tail -n 5000 /var/log/traefik/access.log 2>/dev/null',
      { maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout.trim()) return events;

    const cutoff = Date.now() - minutes * 60 * 1000;
    const requestsByIp = new Map<string, number>();
    const errorsByIp = new Map<string, number>();

    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      // Parse timestamp and filter by timeframe
      const ts = entry.time ?? entry.StartUTC ?? entry.StartLocal;
      if (ts && typeof ts === 'string') {
        const entryTime = new Date(ts).getTime();
        if (entryTime < cutoff) continue;
      }

      const clientAddr = String(entry.ClientAddr ?? entry.ClientHost ?? '');
      const ip = clientAddr.replace(/:\d+$/, ''); // strip port
      const requestPath = String(entry.RequestPath ?? entry.request ?? '');
      const status = Number(entry.OriginStatus ?? entry.downstream_status ?? 0);

      if (!ip) continue;

      // Count requests per IP
      requestsByIp.set(ip, (requestsByIp.get(ip) ?? 0) + 1);

      // Count 4xx errors per IP
      if (status >= 400 && status < 500) {
        errorsByIp.set(ip, (errorsByIp.get(ip) ?? 0) + 1);
      }

      // Detect suspicious path access
      const pathLower = requestPath.toLowerCase();
      const isSuspicious = SUSPICIOUS_PATHS.some(p => pathLower.includes(p))
        || (pathLower.includes('/.well-known/') && !pathLower.includes('acme'));

      if (isSuspicious) {
        const ev = await insertEvent({
          eventType: 'unusual_traffic',
          severity: 'low',
          sourceIp: ip,
          username: null,
          serviceName: 'traefik',
          description: `Suspicious path access: ${requestPath}`,
          details: JSON.stringify({ path: requestPath, status, clientAddr }),
          resolved: false,
        });
        events.push(ev);
      }
    }

    // High-rate IP detection (> 100 requests per minute window)
    const rateThreshold = 100 * (minutes || 1);
    for (const [ip, reqCount] of requestsByIp) {
      if (reqCount <= rateThreshold) continue;

      const ev = await insertEvent({
        eventType: 'unusual_traffic',
        severity: 'high',
        sourceIp: ip,
        username: null,
        serviceName: 'traefik',
        description: `High request rate: ${reqCount} requests from ${ip} in ${minutes} min`,
        details: JSON.stringify({ requestCount: reqCount, minutes }),
        resolved: false,
      });
      events.push(ev);
    }

    // Excessive 4xx errors (> 50 from same IP)
    for (const [ip, errCount] of errorsByIp) {
      if (errCount <= 50) continue;

      const ev = await insertEvent({
        eventType: 'unusual_traffic',
        severity: 'medium',
        sourceIp: ip,
        username: null,
        serviceName: 'traefik',
        description: `Excessive 4xx errors: ${errCount} from ${ip} in ${minutes} min`,
        details: JSON.stringify({ errorCount: errCount, minutes }),
        resolved: false,
      });
      events.push(ev);
    }
  } catch {
    // Traefik access log not available -- graceful degradation
  }

  return events;
}

// --- Configuration Scan ---

export async function scanConfiguration(): Promise<SecurityEventRow[]> {
  const events: SecurityEventRow[] = [];

  try {
    const { stdout: fileList } = await exec('ls /etc/traefik/dynamic/*.yml 2>/dev/null');
    if (!fileList.trim()) return events;

    const files = fileList.trim().split('\n');

    for (const filePath of files) {
      const fileName = filePath.split('/').pop() ?? '';
      if (SYSTEM_CONFIGS.includes(fileName)) continue;

      // Check if file contains authelia middleware
      try {
        const { stdout: grepResult } = await exec(
          `grep -l 'authelia@file' "${filePath}" 2>/dev/null`,
        );
        if (grepResult.trim()) continue; // has authelia middleware -- OK
      } catch {
        // grep exit code 1 = not found -- this is expected, means no authelia
      }

      const serviceName = fileName.replace('.yml', '');
      const ev = await insertEvent({
        eventType: 'config_anomaly',
        severity: 'medium',
        sourceIp: null,
        username: null,
        serviceName,
        description: `Service "${serviceName}" has no Authelia middleware (${filePath})`,
        details: JSON.stringify({ filePath, fileName }),
        resolved: false,
      });
      events.push(ev);
    }
  } catch {
    // Traefik config dir not available -- graceful degradation
  }

  return events;
}

// --- Query functions ---

export async function getSecurityEvents(params: {
  eventType?: string;
  severity?: string;
  limit?: number;
}): Promise<SecurityEventRow[]> {
  const db = getDb();
  const conditions = [];

  if (params.eventType) {
    conditions.push(eq(securityEvents.eventType, params.eventType));
  }
  if (params.severity) {
    conditions.push(eq(securityEvents.severity, params.severity));
  }

  let query = db.select().from(securityEvents);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query
    .orderBy(desc(securityEvents.createdAt))
    .limit(params.limit ?? 100);
}

export async function getRecentEventCount(hours: number): Promise<number> {
  const db = getDb();
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const [row] = await db.select({ total: count() }).from(securityEvents)
    .where(sql`${securityEvents.createdAt} >= ${since}`);

  return row?.total ?? 0;
}

export async function cleanupOldEvents(days: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const [before] = await db.select({ total: count() }).from(securityEvents)
    .where(sql`${securityEvents.createdAt} < ${cutoff}`);
  const toDelete = before?.total ?? 0;

  if (toDelete > 0) {
    await db.delete(securityEvents)
      .where(sql`${securityEvents.createdAt} < ${cutoff}`);
  }

  return toDelete;
}
