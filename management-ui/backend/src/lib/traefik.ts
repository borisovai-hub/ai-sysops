import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { buildHostRule, sanitizeString } from './sanitize.js';
import { execCommandSafe } from './exec.js';
import { getTraefikConfigDir, isGitOpsMode } from '../config/env.js';
import { logger } from './logger.js';

interface CreateTraefikOptions {
  authelia?: boolean;
}

interface TraefikRouter {
  rule: string;
  service: string;
  entryPoints: string[];
  tls: { certResolver: string };
  middlewares?: string[];
}

interface TraefikYaml {
  http?: {
    routers?: Record<string, TraefikRouter>;
    services?: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }>;
  };
}

/**
 * Create a Traefik dynamic config YAML file for a service.
 * Returns the config file path for gitops commit tracking.
 */
export function createTraefikConfig(
  name: string,
  domain: string,
  internalIp: string,
  port: number | string,
  options: CreateTraefikOptions = {},
): { done: boolean; detail: string; configPath: string } {
  const dir = getTraefikConfigDir();
  const hostRule = buildHostRule(domain) || `Host(\`${domain}\`)`;
  const router: TraefikRouter = {
    rule: hostRule,
    service: name,
    entryPoints: ['websecure'],
    tls: { certResolver: 'letsencrypt' },
  };
  if (options.authelia) {
    router.middlewares = ['authelia@file'];
  }
  const configContent: TraefikYaml = {
    http: {
      routers: { [name]: router },
      services: {
        [name]: {
          loadBalancer: { servers: [{ url: `http://${internalIp}:${port}` }] },
        },
      },
    },
  };
  const configPath = join(dir, `${name}.yml`);
  writeFileSync(configPath, yaml.stringify(configContent), 'utf-8');
  return { done: true, detail: `${name}.yml`, configPath };
}

/**
 * Delete a Traefik dynamic config YAML file.
 */
export function deleteTraefikConfig(name: string): void {
  const dir = getTraefikConfigDir();
  const configPath = join(dir, `${name}.yml`);
  if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
}

/**
 * Reload Traefik (systemctl reload) — only in direct mode.
 * In GitOps mode, reload happens via CI after push.
 */
export function reloadTraefik(): { mode: 'direct' | 'gitops' } {
  if (isGitOpsMode()) {
    return { mode: 'gitops' };
  }
  const result = execCommandSafe('systemctl reload traefik');
  if (!result.success) {
    logger.warn('Ошибка перезагрузки Traefik:', result.error);
  }
  return { mode: 'direct' };
}

export interface FindServiceResult {
  configPath: string;
  configFile: string;
  routerName: string | null;
}

/**
 * Find a service's Traefik config by name (supports multi-router YAML files).
 */
export function findServiceConfig(name: string): FindServiceResult | null {
  const dir = getTraefikConfigDir();
  const directPath = join(dir, `${name}.yml`);
  if (existsSync(directPath)) {
    return { configPath: directPath, configFile: `${name}.yml`, routerName: null };
  }
  // Scan all YAML files for a router with this name
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.endsWith('.yml')) continue;
    const filePath = join(dir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = yaml.parse(content) as TraefikYaml;
      if (data.http?.routers?.[name]) {
        return { configPath: filePath, configFile: file, routerName: name };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export interface ParsedService {
  name: string;
  domain: string;
  internalIp: string;
  port: string;
  configFile: string;
}

/**
 * Parse all Traefik dynamic configs into a service list.
 */
export function listTraefikServices(): ParsedService[] {
  const dir = getTraefikConfigDir();
  const services: ParsedService[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return services;
  }

  for (const file of files) {
    if (!file.endsWith('.yml') || file === 'gitlab.yml') continue;
    const filePath = join(dir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = yaml.parse(content) as TraefikYaml;
      if (!data.http?.routers) continue;

      const routerNames = Object.keys(data.http.routers);
      for (const routerName of routerNames) {
        const router: TraefikRouter = data.http.routers[routerName];
        const serviceName = router.service;
        const service = data.http.services?.[serviceName];
        if (!router.rule || !service) continue;

        const ruleClean = sanitizeString(router.rule);
        const domains: string[] = [];
        const hostRegex = /Host\([`']([a-zA-Z0-9._-]+)[`']\)/g;
        let m: RegExpExecArray | null;
        while ((m = hostRegex.exec(ruleClean)) !== null) {
          const d = sanitizeString(m[1]);
          if (d && !domains.includes(d)) domains.push(d);
        }

        const server = service.loadBalancer?.servers?.[0];
        const urlMatch = server?.url?.match(/http:\/\/(.+):(\d+)/);

        services.push({
          name: sanitizeString(routerNames.length > 1 ? routerName : file.replace('.yml', '')),
          domain: domains.join(', '),
          internalIp: urlMatch ? sanitizeString(urlMatch[1]) : '',
          port: urlMatch ? sanitizeString(urlMatch[2]) : '',
          configFile: file,
        });
      }
    } catch {
      continue;
    }
  }
  return services;
}

/**
 * Read and parse a specific Traefik YAML config file.
 */
export function readTraefikYaml(configPath: string): TraefikYaml {
  const content = readFileSync(configPath, 'utf-8');
  return yaml.parse(content) as TraefikYaml;
}

/**
 * Write a Traefik YAML config file.
 */
export function writeTraefikYaml(configPath: string, data: TraefikYaml): void {
  writeFileSync(configPath, yaml.stringify(data), 'utf-8');
}
