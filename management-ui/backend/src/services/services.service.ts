import { unlinkSync } from 'node:fs';
import { AppError, NotFoundError } from '@management-ui/shared';
import axios from 'axios';
import {
  listTraefikServices,
  findServiceConfig,
  createTraefikConfig,
  deleteTraefikConfig,
  readTraefikYaml,
  writeTraefikYaml,
  type ParsedService,
} from '../lib/traefik.js';
import { getExternalIp } from '../lib/dns-api.js';
import { addDnsRecordsForService, removeDnsRecordsForService } from './dns.service.js';
import { sanitizeString, isSafeServiceName, buildHostRule } from '../lib/sanitize.js';
import { getBaseDomains, buildDomainsString } from '../config/env.js';
import { loadDnsConfig } from '../lib/dns-api.js';

/**
 * List all services from Traefik dynamic configs.
 */
export function listServices(): ParsedService[] {
  return listTraefikServices();
}

/**
 * Create a new service.
 * Writes Traefik config to repo + adds DNS records to records.json.
 * Changes are applied only after commit + push via GitOps.
 */
export async function createService(params: {
  name: string;
  internalIp: string;
  port: string;
  domain?: string;
  authelia?: boolean;
}): Promise<{ service: ParsedService; gitops: true }> {
  const name = sanitizeString(params.name);
  const internalIp = sanitizeString(params.internalIp);
  const port = sanitizeString(params.port);
  let domain = sanitizeString(params.domain || '');

  if (!name || !internalIp || !port) {
    throw new AppError('Необходимы параметры: name, internalIp, port');
  }

  if (!domain) {
    const dnsConfig = loadDnsConfig();
    domain = buildDomainsString(name) || (dnsConfig.domain ? `${name}.${dnsConfig.domain}` : '');
  }
  if (!domain) {
    throw new AppError('Домен не указан и не может быть определен');
  }

  // Write Traefik config to repo directory
  createTraefikConfig(name, domain, internalIp, port, { authelia: params.authelia });

  // Add DNS records to project config (records.json)
  const externalIp = await getExternalIp();
  const baseDomains = getBaseDomains();
  addDnsRecordsForService(name, externalIp, baseDomains);

  return {
    service: { name, domain, internalIp, port, configFile: `${name}.yml` },
    gitops: true,
  };
}

/**
 * Update a service (modify Traefik YAML in repo).
 * Changes are applied only after commit + push via GitOps.
 */
export function updateService(
  name: string,
  params: { internalIp: string; port: string; domain?: string },
): { service: { name: string; domain: string; internalIp: string; port: string }; gitops: true } {
  const cleanName = sanitizeString(name);
  if (!isSafeServiceName(cleanName)) {
    throw new AppError('Недопустимое имя сервиса');
  }

  const internalIp = sanitizeString(params.internalIp);
  const port = sanitizeString(params.port);
  const domain = sanitizeString(params.domain || '');

  if (!internalIp || !port) {
    throw new AppError('Необходимы internalIp и port');
  }

  const found = findServiceConfig(cleanName);
  if (!found) {
    throw new NotFoundError('Сервис не найден');
  }

  const data = readTraefikYaml(found.configPath);
  const targetRouter = found.routerName || (data.http?.routers && Object.keys(data.http.routers)[0]);
  const serviceName = data.http?.services && Object.keys(data.http.services)[0];

  if (!targetRouter || !serviceName || !data.http?.routers || !data.http?.services) {
    throw new AppError('Некорректный формат конфигурации', 500);
  }

  const hostRule = domain ? buildHostRule(domain) : data.http.routers[targetRouter].rule;
  data.http.routers[targetRouter].rule = hostRule;
  data.http.services[serviceName].loadBalancer.servers[0].url = `http://${internalIp}:${port}`;

  writeTraefikYaml(found.configPath, data);

  return { service: { name: cleanName, domain: domain || '', internalIp, port }, gitops: true };
}

/**
 * Delete a service (remove Traefik config from repo + remove DNS records from records.json).
 * Changes are applied only after commit + push via GitOps.
 */
export function deleteService(name: string): { gitops: true } {
  const cleanName = sanitizeString(name);
  if (!isSafeServiceName(cleanName)) {
    throw new AppError('Недопустимое имя сервиса');
  }

  const found = findServiceConfig(cleanName);
  if (!found) {
    throw new NotFoundError('Сервис не найден');
  }

  if (found.routerName) {
    const data = readTraefikYaml(found.configPath);
    if (data.http?.routers) {
      delete data.http.routers[found.routerName];
      const remaining = Object.keys(data.http.routers);
      if (remaining.length === 0) {
        unlinkSync(found.configPath);
      } else {
        writeTraefikYaml(found.configPath, data);
      }
    }
  } else {
    deleteTraefikConfig(cleanName);
  }

  // Remove DNS records from project config
  removeDnsRecordsForService(cleanName);

  return { gitops: true };
}

/**
 * Get Traefik API raw data (status).
 */
export async function getTraefikStatus(): Promise<unknown> {
  const response = await axios.get('http://localhost:8080/api/rawdata', { timeout: 2000 });
  return { status: 'running', data: response.data };
}
