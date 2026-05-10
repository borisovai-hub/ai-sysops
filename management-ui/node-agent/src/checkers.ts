import axios from 'axios';
import { execSync } from 'node:child_process';

export interface CheckResult {
  status: 'up' | 'down' | 'degraded';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  details?: Record<string, unknown>;
}

type Checker = () => Promise<CheckResult>;

async function checkTraefik(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await axios.get('http://localhost:8080/api/rawdata', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

async function checkFrps(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // frps dashboard на 17490 (localhost), basic auth — token берём из /etc/frp/frps.toml
    // Для упрощения чекера: проверяем что control-порт 17420 открыт и dashboard отвечает 401 (значит жив)
    const resp = await axios.get('http://localhost:17490/api/serverinfo', {
      timeout: 3000,
      validateStatus: () => true,
    });
    if (resp.status === 401 || resp.status === 200) {
      return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
    }
    return { status: 'degraded', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

async function checkDnsApi(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const resp = await axios.get('http://localhost:5353/api/health', { timeout: 3000 });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

async function checkStepCa(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // step-ca: HTTPS, self-signed (свой CA) — игнорируем cert-валидацию для health
    const https = await import('node:https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const resp = await axios.get('https://localhost:9000/health', { timeout: 3000, httpsAgent: agent });
    return { status: 'up', responseTimeMs: Date.now() - start, statusCode: resp.status };
  } catch (err) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

async function checkSystemd(unit: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    execSync(`systemctl is-active --quiet ${unit}`, { timeout: 2000 });
    return { status: 'up', responseTimeMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', responseTimeMs: Date.now() - start, error: `${unit} not active` };
  }
}

export const CHECKERS: Record<string, Checker> = {
  traefik: checkTraefik,
  frps: checkFrps,
  'dns-api': checkDnsApi,
  'step-ca': checkStepCa,
  // Systemd-only чекеры — без HTTP, факт активности юнита
  authelia: () => checkSystemd('authelia.service'),
  vikunja: () => checkSystemd('vikunja.service'),
  umami: () => checkSystemd('umami.service'),
  gitlab: () => checkSystemd('gitlab-runsvdir.service'),
  mailu: () => checkSystemd('docker-compose@mailu.service'),
};

export async function runCheck(name: string): Promise<CheckResult> {
  const checker = CHECKERS[name];
  if (!checker) {
    return {
      status: 'down',
      responseTimeMs: 0,
      error: `unknown checker: ${name}`,
    };
  }
  return checker();
}

export async function runAllChecks(enabled: string[]): Promise<Record<string, CheckResult>> {
  const entries = await Promise.all(
    enabled.map(async (name) => [name, await runCheck(name)] as const),
  );
  return Object.fromEntries(entries);
}
