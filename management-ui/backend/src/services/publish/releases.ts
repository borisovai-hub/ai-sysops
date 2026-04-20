import { mkdirSync, existsSync, unlinkSync, copyFileSync, statSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, eq, desc } from 'drizzle-orm';
import { AppError, NotFoundError, ConflictError } from '@management-ui/shared';
import type {
  ReleasePayload, ReleaseInfo, CreateReleaseRequest,
} from '@management-ui/shared';
import { getDb } from '../../db/index.js';
import { publishReleases, publishArtifacts } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { newId } from './id.js';
import {
  completeUpload, getUploadRow, downloadFromUrl,
  resolveStoragePath, buildDownloadUrl,
} from './uploads.js';

async function materializeArtifact(
  slug: string,
  version: string,
  item: ReleasePayload['artifacts'][number],
  runId?: string,
): Promise<{
  storagePath: string; downloadUrl: string; checksumSha256: string; sizeBytes: number; filename: string;
}> {
  const { artifact, storage } = item;
  const targetPath = resolveStoragePath(
    storage.kind || 'downloads', slug, artifact.filename,
    version, storage.basePath,
  );
  // 1) uploadHandle: проверяем completed, перемещаем
  if (artifact.uploadHandle) {
    const row = await getUploadRow(artifact.uploadHandle);
    if (!row) throw new NotFoundError('uploadHandle не найден');
    if (row.status !== 'completed') {
      // auto-complete если chunks полные
      await completeUpload(artifact.uploadHandle);
    }
    // completeUpload уже переместил в storage
    const st = statSync(targetPath);
    return {
      storagePath: targetPath,
      downloadUrl: buildDownloadUrl(storage.kind, slug, version, artifact.filename),
      checksumSha256: row.checksumSha256 || '',
      sizeBytes: st.size,
      filename: artifact.filename,
    };
  }
  // 2) sourceUrl: скачать во временный путь → проверить → переместить
  if (artifact.sourceUrl) {
    if (existsSync(targetPath) && !storage.overwrite) {
      throw new ConflictError(`artifact exists: ${targetPath} (use storage.overwrite:true)`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    const { sizeBytes, sha256 } = await downloadFromUrl(artifact.sourceUrl, targetPath);
    if (artifact.checksumSha256 && artifact.checksumSha256.toLowerCase() !== sha256.toLowerCase()) {
      try { unlinkSync(targetPath); } catch { /* ignore */ }
      throw new AppError(`CHECKSUM_MISMATCH for ${artifact.filename}`);
    }
    return {
      storagePath: targetPath,
      downloadUrl: buildDownloadUrl(storage.kind, slug, version, artifact.filename),
      checksumSha256: sha256,
      sizeBytes,
      filename: artifact.filename,
    };
  }
  // 3) sourcePath: локальный файл — copy
  if (artifact.sourcePath) {
    if (!existsSync(artifact.sourcePath)) throw new NotFoundError(`sourcePath не найден: ${artifact.sourcePath}`);
    if (existsSync(targetPath) && !storage.overwrite) {
      throw new ConflictError(`artifact exists: ${targetPath}`);
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(artifact.sourcePath, targetPath);
    const st = statSync(targetPath);
    return {
      storagePath: targetPath,
      downloadUrl: buildDownloadUrl(storage.kind, slug, version, artifact.filename),
      checksumSha256: artifact.checksumSha256 || '',
      sizeBytes: st.size,
      filename: artifact.filename,
    };
  }
  throw new AppError('artifact: нужен sourceUrl, sourcePath или uploadHandle');
}

export async function createRelease(
  slug: string, req: CreateReleaseRequest, runId?: string,
): Promise<ReleaseInfo> {
  const db = getDb();
  const { release } = req;

  // Проверить что нет дубля (slug+version)
  const existing = await db.select().from(publishReleases)
    .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, release.version)));
  if (existing.length > 0 && req.dryRun !== true) {
    throw new ConflictError(`RELEASE_VERSION_EXISTS: ${slug}@${release.version}`);
  }

  const releaseId = newId('rel');
  const releasedAt = release.releasedAt || new Date().toISOString();

  // Dry-run — только план
  if (req.dryRun) {
    return {
      slug, version: release.version, action: release.action,
      source: release.source, changelog: release.changelog,
      releasedAt, strapiStatus: req.updateStrapi ? (req.publishToSite ? 'published' : 'draft') : 'skipped',
      artifacts: release.artifacts.map(a => ({
        filename: a.artifact.filename, label: a.label, platform: a.platform,
        sizeBytes: a.artifact.sizeBytes || 0, checksumSha256: a.artifact.checksumSha256,
        storagePath: resolveStoragePath(a.storage.kind, slug, a.artifact.filename, release.version, a.storage.basePath),
        downloadUrl: buildDownloadUrl(a.storage.kind, slug, release.version, a.artifact.filename),
        visibility: a.storage.visibility,
      })),
      createdAt: new Date().toISOString(),
    };
  }

  // Materialize все артефакты (storage_upload шаг)
  const matArtifacts: Array<{
    storagePath: string; downloadUrl: string; checksumSha256: string;
    sizeBytes: number; filename: string;
    storageKind: string; visibility: string; label?: string; platform?: string;
    contentType?: string;
  }> = [];
  for (const item of release.artifacts) {
    const mat = await materializeArtifact(slug, release.version, item, runId);
    matArtifacts.push({
      ...mat,
      storageKind: item.storage.kind,
      visibility: item.storage.visibility,
      label: item.label,
      platform: item.platform,
      contentType: item.artifact.contentType,
    });
  }

  // Strapi обновление (strapi_release)
  let strapiDocumentId: string | undefined;
  let strapiStatus: 'draft' | 'published' | 'unpublished' | 'skipped' = 'skipped';
  if (req.updateStrapi) {
    try {
      const { createOrUpdateStrapiProject } = await import('../../lib/strapi-api.js');
      const result = await createOrUpdateStrapiProject(slug, {
        title: slug,
        version: release.version,
        changelog: release.changelog,
        downloads: matArtifacts.map(a => ({
          filename: a.filename, url: a.downloadUrl, label: a.label, platform: a.platform,
          sizeBytes: a.sizeBytes, sha256: a.checksumSha256,
        })),
      }, { draft: !req.publishToSite });
      if (result.id != null) strapiDocumentId = String(result.id);
      strapiStatus = req.publishToSite ? 'published' : 'draft';
    } catch (err) {
      logger.warn('release: Strapi update failed:', (err as Error).message);
      strapiStatus = 'skipped';
    }
  }

  await db.insert(publishReleases).values({
    id: releaseId, slug, version: release.version, action: release.action,
    source: release.source, changelog: release.changelog,
    setAsCurrent: release.setAsCurrent, strapiDocumentId, strapiStatus,
    runId: runId ?? null, releasedAt, createdAt: new Date().toISOString(),
  });
  for (const a of matArtifacts) {
    await db.insert(publishArtifacts).values({
      releaseId, filename: a.filename, label: a.label ?? null, platform: a.platform ?? null,
      sizeBytes: a.sizeBytes, checksumSha256: a.checksumSha256 || null,
      storageKind: a.storageKind, storagePath: a.storagePath, downloadUrl: a.downloadUrl,
      visibility: a.visibility, contentType: a.contentType ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    slug, version: release.version, action: release.action, source: release.source,
    changelog: release.changelog, releasedAt,
    strapiDocumentId, strapiStatus,
    artifacts: matArtifacts.map(a => ({
      filename: a.filename, label: a.label, platform: a.platform,
      sizeBytes: a.sizeBytes, checksumSha256: a.checksumSha256,
      storagePath: a.storagePath, downloadUrl: a.downloadUrl, visibility: a.visibility as 'public' | 'authelia' | 'token',
    })),
    createdAt: new Date().toISOString(),
  };
}

export async function listReleases(slug: string): Promise<{ releases: unknown[]; current: string | null }> {
  const db = getDb();
  const rows = await db.select().from(publishReleases)
    .where(eq(publishReleases.slug, slug)).orderBy(desc(publishReleases.releasedAt));
  const current = rows.find(r => r.setAsCurrent)?.version || null;
  const releases = await Promise.all(rows.map(async r => {
    const arts = await db.select().from(publishArtifacts).where(eq(publishArtifacts.releaseId, r.id));
    return {
      version: r.version, action: r.action, source: r.source, changelog: r.changelog,
      setAsCurrent: r.setAsCurrent, strapiStatus: r.strapiStatus, releasedAt: r.releasedAt,
      artifactsCount: arts.length,
    };
  }));
  return { releases, current };
}

export async function getRelease(slug: string, version: string): Promise<ReleaseInfo> {
  const db = getDb();
  const rows = await db.select().from(publishReleases)
    .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, version)));
  if (rows.length === 0) throw new NotFoundError(`RELEASE_NOT_FOUND: ${slug}@${version}`);
  const r = rows[0];
  const arts = await db.select().from(publishArtifacts).where(eq(publishArtifacts.releaseId, r.id));
  return {
    slug: r.slug, version: r.version,
    action: r.action as ReleaseInfo['action'],
    source: r.source as ReleaseInfo['source'],
    changelog: r.changelog, releasedAt: r.releasedAt,
    strapiDocumentId: r.strapiDocumentId ?? undefined,
    strapiStatus: (r.strapiStatus as ReleaseInfo['strapiStatus']) ?? undefined,
    artifacts: arts.map(a => ({
      filename: a.filename, label: a.label ?? undefined, platform: a.platform ?? undefined,
      sizeBytes: a.sizeBytes, checksumSha256: a.checksumSha256 ?? undefined,
      storagePath: a.storagePath, downloadUrl: a.downloadUrl,
      visibility: a.visibility as 'public' | 'authelia' | 'token',
    })),
    createdAt: r.createdAt,
  };
}

export async function patchRelease(
  slug: string, version: string,
  patch: { action?: 'publish' | 'unpublish'; changelog?: string },
): Promise<ReleaseInfo> {
  const db = getDb();
  const rows = await db.select().from(publishReleases)
    .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, version)));
  if (rows.length === 0) throw new NotFoundError(`RELEASE_NOT_FOUND: ${slug}@${version}`);
  const row = rows[0];
  const updates: Partial<typeof publishReleases.$inferInsert> = {};
  if (patch.changelog != null) updates.changelog = patch.changelog;

  // Sync Strapi publish/unpublish если известен документ
  if (patch.action && row.strapiDocumentId) {
    try {
      const { setStrapiPublishStatus } = await import('../../lib/strapi-api.js');
      const r = await setStrapiPublishStatus('projects', row.strapiDocumentId, patch.action);
      if (r.done) {
        updates.strapiStatus = patch.action === 'publish' ? 'published' : 'unpublished';
      } else {
        logger.warn(`patchRelease: Strapi ${patch.action} failed:`, r.error);
      }
    } catch (err) {
      logger.warn('patchRelease: Strapi import failed:', (err as Error).message);
    }
  } else if (patch.action) {
    // Нет Strapi связи — обновим только статус в нашей базе
    updates.strapiStatus = patch.action === 'publish' ? 'published' : 'unpublished';
  }
  if (Object.keys(updates).length > 0) {
    await db.update(publishReleases).set(updates)
      .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, version)));
  }
  return getRelease(slug, version);
}

export async function deleteRelease(
  slug: string, version: string,
  opts: { confirmDestructive?: boolean; removeArtifacts?: boolean; removeStrapi?: boolean },
): Promise<{ deleted: boolean; removedFiles: number }> {
  if (!opts.confirmDestructive) throw new AppError('confirmDestructive: true обязателен');
  const db = getDb();
  const rows = await db.select().from(publishReleases)
    .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, version)));
  if (rows.length === 0) throw new NotFoundError(`RELEASE_NOT_FOUND: ${slug}@${version}`);
  const r = rows[0];
  const arts = await db.select().from(publishArtifacts).where(eq(publishArtifacts.releaseId, r.id));
  let removed = 0;
  if (opts.removeArtifacts) {
    for (const a of arts) {
      try {
        if (existsSync(a.storagePath)) {
          unlinkSync(a.storagePath);
          removed++;
          // Попытка удалить пустую версию-папку
          const versionDir = dirname(a.storagePath);
          try { rmdirSync(versionDir); } catch { /* not empty */ }
        }
      } catch (err) {
        logger.warn(`deleteRelease: unlink ${a.storagePath} failed: ${(err as Error).message}`);
      }
    }
  }
  // Strapi cleanup если запрошено
  if (opts.removeStrapi && r.strapiDocumentId) {
    try {
      const { deleteStrapiEntry } = await import('../../lib/strapi-api.js');
      const res = await deleteStrapiEntry('projects', r.strapiDocumentId);
      if (!res.done) logger.warn(`deleteRelease: Strapi delete failed:`, res.error);
    } catch (err) {
      logger.warn('deleteRelease: Strapi import failed:', (err as Error).message);
    }
  }
  await db.delete(publishReleases)
    .where(and(eq(publishReleases.slug, slug), eq(publishReleases.version, version)));
  return { deleted: true, removedFiles: removed };
}
