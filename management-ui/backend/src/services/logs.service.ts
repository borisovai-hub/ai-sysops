import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { logger } from '../lib/logger.js';

/**
 * Whitelist источников логов. Ни один другой sys-unit или container НЕ доступен.
 * Это защищает от чтения чужих логов (напр. auth.log с токенами) через API.
 */
export type LogSourceType = 'systemd' | 'docker';

export interface LogSource {
  id: string;               // публичный идентификатор (grafana, frps, ...)
  label: string;            // человекочитаемый
  type: LogSourceType;
  target: string;           // unit name или docker container name
  description?: string;
  group?: string;           // для группировки в UI (infra/auth/content/ai)
}

const SOURCES: LogSource[] = [
  // --- Infra / core ---
  { id: 'management-ui', label: 'Management UI', type: 'systemd', target: 'management-ui', group: 'core' },
  { id: 'dns-api', label: 'DNS API', type: 'systemd', target: 'dns-api', group: 'core' },
  { id: 'traefik', label: 'Traefik', type: 'systemd', target: 'traefik', group: 'core' },

  // --- Auth / security ---
  { id: 'authelia', label: 'Authelia SSO', type: 'systemd', target: 'authelia', group: 'auth' },

  // --- Tunneling ---
  { id: 'frps', label: 'frp server', type: 'systemd', target: 'frps', group: 'tunnels' },

  // --- Docker-сервисы ---
  { id: 'umami', label: 'Umami Analytics', type: 'docker', target: 'umami', group: 'services' },
  { id: 'vikunja', label: 'Vikunja Tasks', type: 'docker', target: 'vikunja', group: 'services' },

  // --- Mail (docker-compose v2 имена с суффиксом -1) ---
  { id: 'mailu-admin', label: 'Mailu admin', type: 'docker', target: 'mailu-admin-1', group: 'mail' },
  { id: 'mailu-front', label: 'Mailu front', type: 'docker', target: 'mailu-front-1', group: 'mail' },
  { id: 'mailu-imap', label: 'Mailu imap', type: 'docker', target: 'mailu-imap-1', group: 'mail' },
  { id: 'mailu-smtp', label: 'Mailu smtp', type: 'docker', target: 'mailu-smtp-1', group: 'mail' },
  { id: 'mailu-webmail', label: 'Mailu webmail', type: 'docker', target: 'mailu-webmail-1', group: 'mail' },
  { id: 'mailu-antispam', label: 'Mailu antispam', type: 'docker', target: 'mailu-antispam-1', group: 'mail' },
  { id: 'mailu-redis', label: 'Mailu redis', type: 'docker', target: 'mailu-redis-1', group: 'mail' },

  // --- Mgmt UI runners ---
  { id: 'gitlab-runner', label: 'GitLab Runner (prod)', type: 'systemd', target: 'gitlab-runner', group: 'ci' },
  { id: 'gitlab-runner-deploy', label: 'GitLab Runner (root)', type: 'systemd', target: 'gitlab-runner-deploy', group: 'ci' },
];

export function listSources(): LogSource[] {
  return SOURCES;
}

export function findSource(id: string): LogSource | null {
  return SOURCES.find(s => s.id === id) ?? null;
}

/**
 * Запускает дочерний процесс для чтения логов. Возвращает функции для управления
 * стримом. Построчно эмитит в onLine; при завершении — onClose.
 */
export interface StreamHandle {
  close(): void;
  pid: number | null;
}

export interface StreamOptions {
  lines: number;            // tail N строк перед follow
  follow: boolean;          // продолжать стрим после tail
  onLine(line: string, ts: string): void;
  onClose(code: number | null, reason?: string): void;
  onError?(msg: string): void;
}

function sanitizeTarget(name: string): boolean {
  return /^[a-zA-Z0-9._-]{1,64}$/.test(name);
}

export function streamLogs(source: LogSource, opts: StreamOptions): StreamHandle {
  if (!sanitizeTarget(source.target)) {
    opts.onError?.('invalid target');
    opts.onClose(1, 'invalid target');
    return { close() {}, pid: null };
  }
  const lines = Math.max(1, Math.min(5000, opts.lines | 0));

  let child: ChildProcess;
  if (source.type === 'systemd') {
    const args = [
      '--no-pager',
      '--output=short-iso',
      '-u', source.target,
      '-n', String(lines),
    ];
    if (opts.follow) args.push('-f');
    child = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    // docker logs <container>
    const args = ['logs', '--tail', String(lines), '--timestamps'];
    if (opts.follow) args.push('--follow');
    args.push(source.target);
    child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  let stdoutBuf = '';
  let stderrBuf = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    let idx: number;
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.length > 0) opts.onLine(line, new Date().toISOString());
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
  });
  child.on('error', (err) => {
    opts.onError?.(err.message);
  });
  child.on('close', (code) => {
    // flush last partial line
    if (stdoutBuf.length > 0) opts.onLine(stdoutBuf, new Date().toISOString());
    const reason = code !== 0 ? (stderrBuf.slice(0, 500) || `exit ${code}`) : undefined;
    if (reason) opts.onError?.(reason);
    opts.onClose(code, reason);
  });

  return {
    pid: child.pid ?? null,
    close() {
      try {
        if (!child.killed) child.kill('SIGTERM');
        // жёсткий kill через 1 сек если не закрылся
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 1000);
      } catch (err) {
        logger.warn('streamLogs close error:', (err as Error).message);
      }
    },
  };
}

/**
 * Sanity check: journalctl и docker доступны.
 */
export function diagnostics(): { journalctl: boolean; docker: boolean } {
  return {
    journalctl: existsSync('/usr/bin/journalctl') || existsSync('/bin/journalctl'),
    docker: existsSync('/usr/bin/docker') || existsSync('/bin/docker'),
  };
}
