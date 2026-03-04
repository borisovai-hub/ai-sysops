import { readFileSync, existsSync } from 'node:fs';
import axios from 'axios';
import { DNS_API_PORT, DNS_API_HOST, PATHS } from '@management-ui/shared';
import { getBaseDomains } from '../config/env.js';
import { sanitizeString } from './sanitize.js';
import { execCommandSafe } from './exec.js';
import { logger } from './logger.js';

const DNS_API_BASE = `http://${DNS_API_HOST}:${DNS_API_PORT}`;

interface DnsResult {
  done: boolean;
  detail?: string;
  error?: string;
}

/**
 * Load DNS config from /etc/dns-api/config.json.
 */
export function loadDnsConfig(): { provider?: string; domain?: string; port?: number } {
  try {
    if (!existsSync(PATHS.DNS_CONFIG)) return {};
    return JSON.parse(readFileSync(PATHS.DNS_CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Get external IP of the server.
 */
export async function getExternalIp(): Promise<string> {
  try {
    const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    return response.data.ip;
  } catch {
    return '127.0.0.1';
  }
}

/**
 * Create DNS records for all base domains (e.g., borisovai.ru + borisovai.tech).
 */
export async function createDnsRecordsForAllDomains(subdomain: string, ip: string): Promise<DnsResult> {
  const dnsConfig = loadDnsConfig();
  if (!dnsConfig.provider) return { done: false, detail: 'DNS провайдер не настроен' };

  const domains = getBaseDomains();
  if (domains.length === 0) {
    return { done: false, detail: 'Нет base_domains' };
  }

  const created: string[] = [];
  for (const baseDomain of domains) {
    try {
      await axios.post(
        `${DNS_API_BASE}/api/records`,
        { subdomain: sanitizeString(subdomain), domain: baseDomain, ip: sanitizeString(ip) },
        { timeout: 5000 },
      );
      created.push(`${subdomain}.${baseDomain}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`DNS ошибка для ${subdomain}.${baseDomain}:`, message);
    }
  }

  if (created.length > 0) {
    return { done: true, detail: `A записи: ${created.join(', ')}` };
  }
  return { done: false, error: 'Не удалось создать DNS записи' };
}

/**
 * Delete a DNS record by subdomain using manage-dns CLI.
 */
export async function deleteDnsRecord(subdomain: string): Promise<void> {
  const dnsConfig = loadDnsConfig();
  if (!dnsConfig.provider) return;
  const result = execCommandSafe(`manage-dns delete ${sanitizeString(subdomain)}`);
  if (!result.success) {
    logger.warn('Ошибка удаления DNS записи:', result.error);
  }
}

/**
 * Proxy a request to the local DNS API.
 */
export async function dnsApiProxy(
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; data: unknown }> {
  const response = await axios({ method, url: `${DNS_API_BASE}${path}`, data, timeout: 5000 });
  return { status: response.status, data: response.data };
}
