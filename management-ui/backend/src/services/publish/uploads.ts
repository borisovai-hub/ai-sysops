import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, renameSync, unlinkSync, createReadStream, createWriteStream, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError, NotFoundError } from '@management-ui/shared';
import { getDb } from '../../db/index.js';
import { publishUploads } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { newId } from './id.js';
import { logger } from '../../lib/logger.js';
import { getBaseDomains } from '../../config/env.js';

const UPLOAD_TEMP_DIR = process.env.PUBLISH_UPLOAD_TMP || '/var/lib/management-ui/uploads';
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const HANDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

const STORAGE_BASES: Record<string, string> = {
  downloads: '/var/www/downloads',
  docs: '/var/www/docs',
  media: '/var/www/media',
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolveStoragePath(kind: string, slug: string, filename: string, version?: string, basePath?: string): string {
  if (kind === 'custom') {
    if (!basePath) throw new AppError('storage.basePath обязателен для kind=custom');
    const allowedPrefixes = Object.values(STORAGE_BASES).concat('/var/www', '/srv');
    if (!allowedPrefixes.some(p => basePath.startsWith(p))) {
      throw new AppError(`STORAGE_PATH_FORBIDDEN: basePath=${basePath} вне разрешённых баз`);
    }
    return version ? join(basePath, slug, version, filename) : join(basePath, slug, filename);
  }
  const base = STORAGE_BASES[kind];
  if (!base) throw new AppError(`unknown storage.kind=${kind}`);
  return version ? join(base, slug, version, filename) : join(base, slug, filename);
}

function buildDownloadUrl(kind: string, slug: string, version: string | undefined, filename: string): string {
  const baseDomains = getBaseDomains();
  const baseDomain = baseDomains.find(d => d.endsWith('.tech')) || baseDomains[0] || 'borisovai.tech';
  const host = `${slug}.${baseDomain}`;
  const path = kind === 'custom' ? `/files/${filename}` : `/${kind}${version ? `/${version}` : ''}/${filename}`;
  return `https://${host}${path}`;
}

export interface UploadInitInput {
  slug: string;
  filename: string;
  sizeBytes: number;
  contentType?: string;
  checksumSha256?: string;
  storage: { kind: string; visibility: string; basePath?: string };
  version?: string;
}

export interface UploadHandleInfo {
  handle: string;
  chunkSize: number;
  expiresAt: string;
}

export async function initUpload(input: UploadInitInput): Promise<UploadHandleInfo> {
  ensureDir(UPLOAD_TEMP_DIR);
  const handle = newId('upl');
  const tempPath = join(UPLOAD_TEMP_DIR, handle + '.part');
  writeFileSync(tempPath, Buffer.alloc(0));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HANDLE_TTL_MS).toISOString();
  await getDb().insert(publishUploads).values({
    handle, slug: input.slug, filename: input.filename, sizeBytes: input.sizeBytes,
    receivedBytes: 0, contentType: input.contentType,
    checksumSha256: input.checksumSha256 ?? null,
    storageKind: input.storage.kind, storageVisibility: input.storage.visibility,
    storageBasePath: input.storage.basePath ?? null,
    version: input.version ?? null, tempPath, status: 'active',
    expiresAt, createdAt: now.toISOString(),
  });
  return { handle, chunkSize: DEFAULT_CHUNK, expiresAt };
}

export async function writeChunk(handle: string, offset: number, buf: Buffer): Promise<{ offset: number; received: number; remaining: number }> {
  const db = getDb();
  const rows = await db.select().from(publishUploads).where(eq(publishUploads.handle, handle));
  const row = rows[0];
  if (!row) throw new NotFoundError('upload handle не найден');
  if (row.status !== 'active') throw new AppError(`upload status=${row.status}`);
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.update(publishUploads).set({ status: 'expired' }).where(eq(publishUploads.handle, handle));
    throw new AppError('UPLOAD_EXPIRED');
  }
  if (offset !== row.receivedBytes) {
    throw new AppError(`chunk offset mismatch: got=${offset}, expected=${row.receivedBytes}`);
  }
  appendFileSync(row.tempPath, buf);
  const received = row.receivedBytes + buf.length;
  await db.update(publishUploads).set({ receivedBytes: received }).where(eq(publishUploads.handle, handle));
  return { offset: received, received: buf.length, remaining: row.sizeBytes - received };
}

export interface UploadCompleteResult {
  uploadHandle: string;
  storagePath: string;
  downloadUrl: string;
  checksumSha256: string;
  sizeBytes: number;
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), async function *(src) {
    for await (const chunk of src) h.update(chunk as Buffer);
  });
  return h.digest('hex');
}

export async function completeUpload(handle: string): Promise<UploadCompleteResult> {
  const db = getDb();
  const rows = await db.select().from(publishUploads).where(eq(publishUploads.handle, handle));
  const row = rows[0];
  if (!row) throw new NotFoundError('upload handle не найден');
  if (row.status === 'completed') {
    // idempotent — вернём сохранённое
    const sp = resolveStoragePath(row.storageKind, row.slug, row.filename, row.version ?? undefined, row.storageBasePath ?? undefined);
    return {
      uploadHandle: handle, storagePath: sp,
      downloadUrl: buildDownloadUrl(row.storageKind, row.slug, row.version ?? undefined, row.filename),
      checksumSha256: row.checksumSha256 || '', sizeBytes: row.sizeBytes,
    };
  }
  const st = statSync(row.tempPath);
  if (st.size !== row.sizeBytes) {
    await db.update(publishUploads).set({ status: 'failed' }).where(eq(publishUploads.handle, handle));
    throw new AppError(`SIZE_MISMATCH: received=${st.size}, expected=${row.sizeBytes}`);
  }
  const sha = await sha256File(row.tempPath);
  if (row.checksumSha256 && row.checksumSha256.toLowerCase() !== sha.toLowerCase()) {
    try { unlinkSync(row.tempPath); } catch { /* ignore */ }
    await db.update(publishUploads).set({ status: 'failed' }).where(eq(publishUploads.handle, handle));
    throw new AppError(`CHECKSUM_MISMATCH: got=${sha}, expected=${row.checksumSha256}`);
  }
  const storagePath = resolveStoragePath(
    row.storageKind, row.slug, row.filename, row.version ?? undefined, row.storageBasePath ?? undefined,
  );
  ensureDir(dirname(storagePath));
  renameSync(row.tempPath, storagePath);
  const downloadUrl = buildDownloadUrl(row.storageKind, row.slug, row.version ?? undefined, row.filename);
  await db.update(publishUploads).set({
    status: 'completed', checksumSha256: sha, completedAt: new Date().toISOString(),
  }).where(eq(publishUploads.handle, handle));
  return { uploadHandle: handle, storagePath, downloadUrl, checksumSha256: sha, sizeBytes: row.sizeBytes };
}

export async function downloadFromUrl(sourceUrl: string, destPath: string): Promise<{ sizeBytes: number; sha256: string }> {
  ensureDir(dirname(destPath));
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new AppError(`downloadFromUrl failed: ${res.status}`);
  const h = createHash('sha256');
  let size = 0;
  const out = createWriteStream(destPath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      h.update(buf);
      size += buf.length;
      if (!out.write(buf)) await new Promise<void>(resolve => out.once('drain', () => resolve()));
    }
  } finally {
    out.end();
  }
  return { sizeBytes: size, sha256: h.digest('hex') };
}

export function getUploadRow(handle: string) {
  return getDb().select().from(publishUploads).where(eq(publishUploads.handle, handle)).then(r => r[0] || null);
}

export { resolveStoragePath, buildDownloadUrl };
