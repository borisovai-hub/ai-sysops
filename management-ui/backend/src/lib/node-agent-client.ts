import { Agent as HttpsAgent } from 'node:https';
import { existsSync, readFileSync, statSync } from 'node:fs';
import axios, { type AxiosInstance } from 'axios';
import type { ServerRecord, ServerHealthSnapshot } from '@management-ui/shared';
import { PATHS } from '@management-ui/shared';

const ADMIN_CERT = process.env.ADMIN_CERT_FILE || `${PATHS.ADMIN_CERTS_DIR}/admin.crt`;
const ADMIN_KEY = process.env.ADMIN_KEY_FILE || `${PATHS.ADMIN_CERTS_DIR}/admin.key`;
const CA_BUNDLE = process.env.ADMIN_CA_FILE || `${PATHS.ADMIN_CERTS_DIR}/ca.crt`;

const DEFAULT_TIMEOUT = 5000;

interface CachedAgent {
  agent: HttpsAgent;
  certMtime: number;
}

const agentCache = new Map<string, CachedAgent>();

function adminCertsAvailable(): boolean {
  return existsSync(ADMIN_CERT) && existsSync(ADMIN_KEY) && existsSync(CA_BUNDLE);
}

/**
 * Создаёт HttpsAgent с mTLS. Servername = agent_san для корректной SNI/cert-проверки
 * (agent_url часто указывает на 127.0.0.1, но cert агента выдан на SAN agent-<name>.internal).
 */
function getOrCreateAgent(server: ServerRecord): HttpsAgent | null {
  if (!adminCertsAvailable()) return null;

  const certStat = statSync(ADMIN_CERT);
  const cached = agentCache.get(server.name);
  if (cached && cached.certMtime === certStat.mtimeMs) return cached.agent;

  const agent = new HttpsAgent({
    cert: readFileSync(ADMIN_CERT),
    key: readFileSync(ADMIN_KEY),
    ca: readFileSync(CA_BUNDLE),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    servername: server.agent_san,
  });

  agentCache.set(server.name, { agent, certMtime: certStat.mtimeMs });
  return agent;
}

export class NodeAgentClient {
  private http: AxiosInstance | null = null;
  private serverName: string;
  private agentSan: string;

  constructor(server: ServerRecord) {
    this.serverName = server.name;
    this.agentSan = server.agent_san;

    const httpsAgent = getOrCreateAgent(server);
    if (!httpsAgent) return;

    this.http = axios.create({
      baseURL: server.agent_url,
      timeout: DEFAULT_TIMEOUT,
      httpsAgent,
      proxy: false,
      // SNI берётся из httpsAgent.options.servername. Проверка сертификата
      // тоже идёт по servername, поэтому agent-X.internal валидируется корректно.
      headers: { Host: server.agent_san },
    });
  }

  isAvailable(): boolean {
    return this.http !== null;
  }

  getName(): string {
    return this.serverName;
  }

  async health(): Promise<ServerHealthSnapshot> {
    const checkedAt = new Date().toISOString();
    if (!this.http) {
      return { reachable: false, error: 'admin client cert не настроен на management-ui', checked_at: checkedAt };
    }
    try {
      const resp = await this.http.get<{
        status: string;
        version?: string;
        uptime_seconds?: number;
        cert_expiry_days?: number | null;
        enabled_checkers?: string[];
      }>('/health');
      return {
        reachable: true,
        agent_version: resp.data.version,
        agent_uptime_seconds: resp.data.uptime_seconds,
        cert_expiry_days: resp.data.cert_expiry_days ?? null,
        enabled_checkers: resp.data.enabled_checkers,
        checked_at: checkedAt,
      };
    } catch (err) {
      return { reachable: false, error: extractError(err), checked_at: checkedAt };
    }
  }

  async getServicesStatus(): Promise<{
    reachable: boolean;
    server?: string;
    checked_at?: string;
    services?: Record<string, { status: string; responseTimeMs: number; statusCode?: number; error?: string }>;
    error?: string;
  }> {
    if (!this.http) {
      return { reachable: false, error: 'admin client cert не настроен' };
    }
    try {
      const resp = await this.http.get('/services/status');
      return { reachable: true, ...resp.data };
    } catch (err) {
      return { reachable: false, error: extractError(err) };
    }
  }

  async getSystemInfo(): Promise<{ reachable: boolean; data?: Record<string, unknown>; error?: string }> {
    if (!this.http) {
      return { reachable: false, error: 'admin client cert не настроен' };
    }
    try {
      const resp = await this.http.get<Record<string, unknown>>('/system/info');
      return { reachable: true, data: resp.data };
    } catch (err) {
      return { reachable: false, error: extractError(err) };
    }
  }

  async syncConfig(): Promise<{ reachable: boolean; data?: Record<string, unknown>; error?: string }> {
    if (!this.http) return { reachable: false, error: 'admin client cert не настроен' };
    try {
      // Sync может быть медленным (git pull через сеть + reload Traefik)
      const resp = await this.http.post<Record<string, unknown>>('/config/sync', {}, { timeout: 60_000 });
      return { reachable: true, data: resp.data };
    } catch (err) {
      return { reachable: false, error: extractError(err) };
    }
  }

  async reloadService(name: string): Promise<{ reachable: boolean; reloaded?: boolean; error?: string }> {
    if (!this.http) return { reachable: false, error: 'admin client cert не настроен' };
    try {
      // systemctl reload может занять до 30с (Traefik делает restart fallback)
      const resp = await this.http.post<{ reloaded: boolean }>(`/services/${encodeURIComponent(name)}/reload`, {}, { timeout: 30_000 });
      return { reachable: true, reloaded: resp.data.reloaded };
    } catch (err) {
      return { reachable: false, error: extractError(err) };
    }
  }
}

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.code ? `${err.code}: ${err.message}` : err.message;
  }
  return (err as Error).message;
}

export function nodeAgentClient(server: ServerRecord): NodeAgentClient {
  return new NodeAgentClient(server);
}

export function adminCertsConfigured(): boolean {
  return adminCertsAvailable();
}
