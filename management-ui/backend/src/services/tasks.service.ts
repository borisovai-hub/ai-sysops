import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import type { TasksStatus } from '@management-ui/shared';
import { loadInstallConfig, buildDomainsList, getBaseDomains, getRepoDir } from '../config/env.js';
import { execCommandSafe } from '../lib/exec.js';

interface VikunjaConfig {
  prefix: string;
  middle: string;
  port: number;
  image: string;
  timezone: string;
  registration: boolean;
  oidc: { enabled: boolean; provider: string; client_id: string; issuer_url: string };
  smtp: { enabled: boolean; host: string; port: number; username: string; from: string; force_ssl: boolean; skip_tls_verify: boolean };
  caldav: { enabled: boolean; path: string };
  traefik: { router_name: string; entrypoint: string; tls_resolver: string; middlewares: string[] };
  volumes: { files: string; db: string };
  healthcheck: { endpoint: string; interval: string; timeout: string; retries: number; start_period: string };
  install_config_keys: Record<string, string | number>;
}

let _vikunjaConfig: VikunjaConfig | null | undefined;

function loadVikunjaConfig(): VikunjaConfig | null {
  if (_vikunjaConfig !== undefined) return _vikunjaConfig;

  const repo = getRepoDir();
  const configPath = repo
    ? join(repo, 'config', 'single-machine', 'vikunja.config.json')
    : '';

  if (configPath && existsSync(configPath)) {
    try {
      _vikunjaConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as VikunjaConfig;
    } catch {
      _vikunjaConfig = null;
    }
  } else {
    _vikunjaConfig = null;
  }

  return _vikunjaConfig;
}

/**
 * Get Vikunja Task Planner status and configuration.
 */
export async function getTasksStatus(): Promise<TasksStatus> {
  const installConfig = loadInstallConfig();
  const vikunjaConfig = loadVikunjaConfig();

  let isRunning = false;
  const result = execCommandSafe('docker ps --filter name=vikunja --format "{{.Names}}"');
  if (result.success) {
    isRunning = result.stdout.trim().includes('vikunja');
  }

  // Приоритет: install-config.json → vikunja.config.json → дефолт
  const vikunjaPort = Number(installConfig.vikunja_port) || vikunjaConfig?.port || 3456;
  const healthEndpoint = vikunjaConfig?.healthcheck?.endpoint || '/api/v1/info';

  let healthy = false;
  if (isRunning) {
    try {
      const response = await axios.get(`http://127.0.0.1:${vikunjaPort}${healthEndpoint}`, { timeout: 3000 });
      healthy = response.status === 200;
    } catch {
      healthy = false;
    }
  }

  const prefix = (installConfig.tasks_prefix as string) || vikunjaConfig?.prefix || 'tasks';
  const middle = (installConfig.tasks_middle as string) || vikunjaConfig?.middle || 'dev';
  const fullPrefix = `${prefix}.${middle}`;
  const domains = buildDomainsList(fullPrefix);
  const baseDomains = getBaseDomains();
  const firstBase = baseDomains[0] || 'borisovai.ru';
  const frontendUrl = `https://${prefix}.${middle}.${firstBase}`;
  const mailuDomain = (installConfig.mailu_domain as string) || 'borisovai.ru';

  // OIDC config из vikunja.config.json с подстановкой {{BASE_DOMAIN}}
  const oidcIssuer = vikunjaConfig?.oidc?.issuer_url?.replace('{{BASE_DOMAIN}}', firstBase)
    || `https://auth.${firstBase}`;
  const smtpFrom = vikunjaConfig?.smtp?.from?.replace('{{MAILU_DOMAIN}}', mailuDomain)
    || `tasks@${mailuDomain}`;

  const status = healthy ? 'running' : isRunning ? 'degraded' : 'stopped';

  return {
    status,
    installed: isRunning,
    running: healthy,
    domains,
    port: vikunjaPort,
    config: {
      prefix,
      middle,
      port: vikunjaPort,
      frontendUrl,
      oidc: {
        enabled: vikunjaConfig?.oidc?.enabled ?? true,
        provider: vikunjaConfig?.oidc?.provider || 'Authelia',
        clientId: vikunjaConfig?.oidc?.client_id || 'vikunja',
        issuerUrl: oidcIssuer,
      },
      smtp: {
        enabled: vikunjaConfig?.smtp?.enabled ?? true,
        host: vikunjaConfig?.smtp?.host || '127.0.0.1',
        port: vikunjaConfig?.smtp?.port || 587,
        from: smtpFrom,
      },
      caldav: {
        enabled: vikunjaConfig?.caldav?.enabled ?? true,
        url: `${frontendUrl}${vikunjaConfig?.caldav?.path || '/dav/'}`,
      },
    },
  };
}
