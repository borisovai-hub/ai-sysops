import { readFrpsConfig, frpsDashboardRequest } from '../lib/frp-api.js';
import { getBaseDomains } from '../config/env.js';
import { NotFoundError } from '@management-ui/shared';
import { sanitizeString } from '../lib/sanitize.js';

/**
 * Get frp tunnel status (installed, running, server info).
 */
export async function getTunnelStatus(): Promise<Record<string, unknown>> {
  const cfg = readFrpsConfig();
  if (!cfg) return { installed: false };
  try {
    const info = await frpsDashboardRequest('/api/serverinfo');
    return { installed: true, running: true, ...(info as Record<string, unknown>) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { installed: true, running: false, error: message };
  }
}

/**
 * Get active tunnel proxies (HTTP + TCP).
 */
export async function getTunnelProxies(): Promise<{ proxies: unknown[] }> {
  const cfg = readFrpsConfig();
  if (!cfg) return { proxies: [] };
  try {
    const [httpRes, tcpRes] = await Promise.all([
      frpsDashboardRequest('/api/proxy/http').catch(() => ({ proxies: [] })),
      frpsDashboardRequest('/api/proxy/tcp').catch(() => ({ proxies: [] })),
    ]);
    const httpProxies = ((httpRes as Record<string, unknown>).proxies || []) as unknown[];
    const tcpProxies = ((tcpRes as Record<string, unknown>).proxies || []) as unknown[];
    const proxies = [
      ...httpProxies.map((p: unknown) => ({ ...(p as Record<string, unknown>), tunnelType: 'http' })),
      ...tcpProxies.map((p: unknown) => ({ ...(p as Record<string, unknown>), tunnelType: 'tcp' })),
    ];
    return { proxies };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}

/**
 * Get tunnel server config (for admin display).
 */
export function getTunnelConfig(): Record<string, unknown> {
  const cfg = readFrpsConfig();
  if (!cfg) return { installed: false };
  const baseDomains = getBaseDomains();
  return {
    installed: true,
    serverAddr: baseDomains[0] || '',
    controlPort: cfg['bindPort'] || '17420',
    subdomainHost: cfg['subdomainHost'] || '',
    authToken: cfg['auth.token'] || '',
  };
}

/**
 * Generate frpc client config TOML.
 */
export function generateClientConfig(subdomain: string, localPort: number): string {
  const cfg = readFrpsConfig();
  if (!cfg) throw new NotFoundError('frps не установлен');

  const cleanSubdomain = sanitizeString(subdomain || 'my-project').replace(/[^a-zA-Z0-9-]/g, '');
  const baseDomains = getBaseDomains();
  const serverAddr = baseDomains[0] || '';

  return [
    `serverAddr = "${serverAddr}"`,
    `serverPort = ${cfg['bindPort'] || '17420'}`,
    `auth.token = "${cfg['auth.token'] || ''}"`,
    '',
    '[[proxies]]',
    `name = "${cleanSubdomain}"`,
    'type = "http"',
    `localPort = ${localPort}`,
    `subdomain = "${cleanSubdomain}"`,
  ].join('\n');
}
