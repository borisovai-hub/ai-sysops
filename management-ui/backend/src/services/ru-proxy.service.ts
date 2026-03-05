import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ruProxyApi, getRuProxyConfig } from '../lib/ru-proxy-api.js';
import { sanitizeString } from '../lib/sanitize.js';
import { getRuProxyDomainsPath, isRuProxyGitOps } from '../config/env.js';
import { AppError, NotFoundError, ConflictError } from '@management-ui/shared';
import type { RuProxyDomain } from '@management-ui/shared';

// --- GitOps helpers ---

function readDomainsFile(): RuProxyDomain[] {
  const path = getRuProxyDomainsPath();
  if (!path || !existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function writeDomainsFile(domains: RuProxyDomain[]): void {
  const path = getRuProxyDomainsPath();
  if (!path) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(domains, null, 2), 'utf-8');
}

// --- Service functions ---

/**
 * Get RU Proxy status (Caddy health check).
 */
export async function getRuProxyStatus(): Promise<Record<string, unknown>> {
  const cfg = getRuProxyConfig();
  if (!cfg.url) return { configured: false };
  try {
    const data = await ruProxyApi('get', '/api/health');
    return { configured: true, reachable: true, ...(data as Record<string, unknown>) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, reachable: false, error: message };
  }
}

/**
 * List RU Proxy domains.
 * GitOps: read from repo JSON. Direct: proxy to RU Proxy API.
 */
export async function listDomains(): Promise<unknown> {
  if (isRuProxyGitOps()) {
    const domains = readDomainsFile();
    if (domains.length > 0) return domains;
    // GitOps файл пуст — фолбэк на прямой API
  }
  try {
    return await ruProxyApi('get', '/api/domains');
  } catch {
    return [];
  }
}

/**
 * Add a domain to RU Proxy.
 * GitOps: add to repo JSON + commit. Direct: proxy to RU Proxy API.
 */
export async function addDomain(domain: string, backend?: string): Promise<{ data: unknown; gitops?: boolean }> {
  if (!domain) throw new AppError('Домен обязателен');

  if (isRuProxyGitOps() && readDomainsFile().length > 0) {
    const domains = readDomainsFile();
    const sanitized = sanitizeString(domain);
    if (domains.some((d) => d.domain === sanitized)) {
      throw new ConflictError(`Домен "${sanitized}" уже существует`);
    }
    const entry: RuProxyDomain = {
      domain: sanitized,
      backend: backend ? sanitizeString(backend) : `https://admin.borisovai.tech`,
      enabled: true,
    };
    domains.push(entry);
    writeDomainsFile(domains);
    return { data: entry, gitops: true };
  }

  const data = await ruProxyApi('post', '/api/domains', {
    domain: sanitizeString(domain),
    backend: backend ? sanitizeString(backend) : undefined,
  });
  return { data };
}

/**
 * Update a domain in RU Proxy.
 * GitOps: update in repo JSON + commit. Direct: proxy to RU Proxy API.
 */
export async function updateDomain(
  domain: string,
  body: Record<string, unknown>,
): Promise<{ data: unknown; gitops?: boolean }> {
  if (isRuProxyGitOps() && readDomainsFile().length > 0) {
    const domains = readDomainsFile();
    const idx = domains.findIndex((d) => d.domain === domain);
    if (idx === -1) {
      throw new NotFoundError(`Домен "${domain}" не найден`);
    }
    if (body.backend !== undefined) domains[idx].backend = String(body.backend);
    if (body.enabled !== undefined) domains[idx].enabled = !!body.enabled;
    writeDomainsFile(domains);
    return { data: domains[idx], gitops: true };
  }

  const data = await ruProxyApi('put', `/api/domains/${encodeURIComponent(domain)}`, body);
  return { data };
}

/**
 * Delete a domain from RU Proxy.
 * GitOps: remove from repo JSON + commit. Direct: proxy to RU Proxy API.
 */
export async function deleteDomain(domain: string): Promise<{ data: unknown; gitops?: boolean }> {
  if (isRuProxyGitOps() && readDomainsFile().length > 0) {
    const domains = readDomainsFile();
    const idx = domains.findIndex((d) => d.domain === domain);
    if (idx === -1) {
      throw new NotFoundError(`Домен "${domain}" не найден`);
    }
    domains.splice(idx, 1);
    writeDomainsFile(domains);
    return { data: { ok: true }, gitops: true };
  }

  const data = await ruProxyApi('delete', `/api/domains/${encodeURIComponent(domain)}`);
  return { data };
}

/**
 * Reload Caddy on RU Proxy.
 */
export async function reloadProxy(): Promise<unknown> {
  return await ruProxyApi('post', '/api/reload');
}
