import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDnsRecordsPath } from '../config/env.js';
import { AppError, NotFoundError } from '@management-ui/shared';
import type { DnsRecord } from '@management-ui/shared';

// --- Records file helpers ---

function readRecordsFile(): DnsRecord[] {
  const path = getDnsRecordsPath();
  if (!path || !existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}

function writeRecordsFile(records: DnsRecord[]): void {
  const path = getDnsRecordsPath();
  if (!path) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8');
}

// --- Service functions ---

/**
 * Get all DNS records from project config (records.json).
 */
export function listDnsRecords(): { records: DnsRecord[] } {
  return { records: readRecordsFile() };
}

/**
 * Create a DNS record in project config.
 * Changes are saved to records.json; deploy via GitOps (commit + push).
 */
export function createDnsRecord(
  body: Record<string, unknown>,
): { status: number; data: DnsRecord; gitops: true } {
  const path = getDnsRecordsPath();
  if (!path) {
    throw new AppError('Не удалось определить путь к records.json. Убедитесь что REPO_DIR настроен.', 500);
  }

  const records = readRecordsFile();
  const record: DnsRecord = {
    id: randomUUID().slice(0, 8),
    subdomain: String(body.subdomain || ''),
    domain: String(body.domain || ''),
    type: String(body.type || 'A'),
    ip: String(body.ip || ''),
  };
  records.push(record);
  writeRecordsFile(records);
  return { status: 201, data: record, gitops: true };
}

/**
 * Update a DNS record in project config.
 */
export function updateDnsRecord(
  id: string,
  body: Record<string, unknown>,
): { data: DnsRecord; gitops: true } {
  const records = readRecordsFile();
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new NotFoundError(`DNS запись "${id}" не найдена`);
  }
  if (body.subdomain !== undefined) records[idx].subdomain = String(body.subdomain);
  if (body.domain !== undefined) records[idx].domain = String(body.domain);
  if (body.type !== undefined) records[idx].type = String(body.type);
  if (body.ip !== undefined) records[idx].ip = String(body.ip);
  writeRecordsFile(records);
  return { data: records[idx], gitops: true };
}

/**
 * Delete a DNS record from project config.
 */
export function deleteDnsRecordById(
  id: string,
): { data: { ok: true }; gitops: true } {
  const records = readRecordsFile();
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new NotFoundError(`DNS запись "${id}" не найдена`);
  }
  records.splice(idx, 1);
  writeRecordsFile(records);
  return { data: { ok: true }, gitops: true };
}

/**
 * Add DNS records to project config for all base domains.
 * Used by services.service when creating a new service.
 */
export function addDnsRecordsForService(subdomain: string, ip: string, baseDomains: string[]): void {
  const records = readRecordsFile();
  for (const domain of baseDomains) {
    const exists = records.some(r => r.subdomain === subdomain && r.domain === domain);
    if (!exists) {
      records.push({
        id: randomUUID().slice(0, 8),
        subdomain,
        domain,
        type: 'A',
        ip,
      });
    }
  }
  writeRecordsFile(records);
}

/**
 * Remove DNS records from project config for a subdomain (all domains).
 * Used by services.service when deleting a service.
 */
export function removeDnsRecordsForService(subdomain: string): void {
  const records = readRecordsFile();
  const filtered = records.filter(r => r.subdomain !== subdomain);
  if (filtered.length !== records.length) {
    writeRecordsFile(filtered);
  }
}
