import { eq, desc } from 'drizzle-orm';
import { AppError, ConflictError, NotFoundError } from '@management-ui/shared';
import type { PublishPayload, PublishRun, PublishStep } from '@management-ui/shared';
import { getDb } from '../../db/index.js';
import { publishRuns, publishSteps } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { newId } from './id.js';
import type { PublishTool, ToolContext } from './types.js';

// Tools
import { dnsTool } from './tools/dns.tool.js';
import { traefikTool } from './tools/traefik.tool.js';
import { autheliaTool } from './tools/authelia.tool.js';
import { ruProxyTool } from './tools/ru-proxy.tool.js';
import { dockerVolumeTool } from './tools/docker.tool.js';
import { directoriesTool } from './tools/directories.tool.js';
import { gitlabCiTool, gitlabVariablesTool } from './tools/gitlab.tool.js';
import { strapiTool } from './tools/strapi.tool.js';
import { installTool } from './tools/install.tool.js';
import { releaseTool } from './tools/release.tool.js';

export function planSteps(payload: PublishPayload): PublishTool[] {
  const tools: PublishTool[] = [];
  // Общие инфра-шаги
  tools.push(dnsTool);
  tools.push(traefikTool);
  tools.push(autheliaTool);
  tools.push(ruProxyTool);
  // Docker
  if (payload.docker?.volumeName) tools.push(dockerVolumeTool);
  // Директории для пользовательских типов
  if (['deploy', 'docs', 'product'].includes(payload.type)) tools.push(directoriesTool);
  // GitLab CI (для типов с GitLab)
  if (payload.gitlab) {
    tools.push(gitlabCiTool);
    tools.push(gitlabVariablesTool);
  }
  // Strapi — для docs/product/infra с Strapi блоком
  if (payload.strapi) tools.push(strapiTool);
  // Install script
  if (payload.install?.scriptName) tools.push(installTool);
  // Release (последним — требует готовой инфры и Strapi)
  if (payload.release) tools.push(releaseTool);
  return tools;
}

async function loadRun(runId: string): Promise<PublishRun> {
  const db = getDb();
  const rows = await db.select().from(publishRuns).where(eq(publishRuns.id, runId));
  if (rows.length === 0) throw new NotFoundError(`publish run ${runId} не найден`);
  const r = rows[0];
  const steps = await db.select().from(publishSteps)
    .where(eq(publishSteps.runId, runId)).orderBy(publishSteps.orderIndex);
  return {
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    slug: r.slug,
    type: r.type as PublishRun['type'],
    status: r.status as PublishRun['status'],
    dryRun: r.dryRun,
    steps: steps.map(s => ({
      kind: s.kind as PublishStep['kind'],
      status: s.status as PublishStep['status'],
      startedAt: s.startedAt ?? undefined,
      finishedAt: s.finishedAt ?? undefined,
      detail: s.detail ?? undefined,
      error: s.error ?? undefined,
      before: s.before ? JSON.parse(s.before) : undefined,
      after: s.after ? JSON.parse(s.after) : undefined,
      requiresApproval: s.requiresApproval,
    })),
    errors: JSON.parse(r.errors || '[]'),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    payload: JSON.parse(r.payload) as PublishPayload,
  };
}

async function createRun(payload: PublishPayload, tools: PublishTool[]): Promise<string> {
  const db = getDb();
  const existing = await db.select().from(publishRuns)
    .where(eq(publishRuns.idempotencyKey, payload.idempotencyKey));
  if (existing.length > 0) {
    const r = existing[0];
    if (r.status === 'ok' && !payload.force) {
      return r.id; // idempotent return — orchestrator поймёт и не выполнит
    }
    if (r.status === 'running') {
      throw new ConflictError(`RUN_IN_PROGRESS: ${r.id}`);
    }
    // resume: возвращаем тот же runId, шаги уже есть
    return r.id;
  }
  const now = new Date().toISOString();
  const runId = newId('pub');
  await db.insert(publishRuns).values({
    id: runId, idempotencyKey: payload.idempotencyKey, slug: payload.slug,
    type: payload.type, status: payload.dryRun ? 'planning' : 'running',
    dryRun: !!payload.dryRun, payload: JSON.stringify(payload),
    errors: '[]', createdAt: now, updatedAt: now,
  });
  for (let i = 0; i < tools.length; i++) {
    await db.insert(publishSteps).values({
      runId, orderIndex: i, kind: tools[i].kind, status: 'pending',
      requiresApproval: false,
    });
  }
  return runId;
}

async function markStep(
  runId: string, kind: PublishStep['kind'],
  patch: Partial<typeof publishSteps.$inferInsert>,
): Promise<void> {
  const db = getDb();
  const existing = await db.select().from(publishSteps)
    .where(eq(publishSteps.runId, runId));
  const target = existing.find(s => s.kind === kind);
  if (!target) return;
  await db.update(publishSteps).set(patch).where(eq(publishSteps.id, target.id));
}

async function markRun(runId: string, patch: Partial<typeof publishRuns.$inferInsert>): Promise<void> {
  await getDb().update(publishRuns).set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(publishRuns.id, runId));
}

export async function execute(payload: PublishPayload): Promise<PublishRun> {
  const tools = planSteps(payload);
  const runId = await createRun(payload, tools);
  const run = await loadRun(runId);

  // Если уже ok — idempotent return
  if (run.status === 'ok' && !payload.force) return run;

  const sharedState: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const tool of tools) {
    // Resume: пропускаем шаги уже в статусе ok
    const stepState = run.steps.find(s => s.kind === tool.kind);
    if (stepState?.status === 'ok' && !payload.force) continue;

    const ctx: ToolContext = { payload, runId, dryRun: !!payload.dryRun, sharedState };
    await markStep(runId, tool.kind, { status: 'running', startedAt: new Date().toISOString() });
    try {
      const result = await tool.execute(ctx);
      await markStep(runId, tool.kind, {
        status: result.status,
        finishedAt: new Date().toISOString(),
        detail: result.detail ?? null,
        error: result.error ?? null,
        before: result.before ? JSON.stringify(result.before) : null,
        after: result.after ? JSON.stringify(result.after) : null,
        requiresApproval: result.requiresApproval ?? false,
      });
      if (result.status === 'error') {
        errors.push(`${tool.kind}: ${result.error}`);
        // Не прерываем — идём до конца, но финальный статус будет partial/failed.
        // Критерий: не блокируем последующие независимые шаги.
      }
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${tool.kind}: ${msg}`);
      await markStep(runId, tool.kind, {
        status: 'error', finishedAt: new Date().toISOString(), error: msg,
      });
      logger.error(`publish tool ${tool.kind} throw:`, msg);
    }
  }

  // Финальный статус
  const updated = await loadRun(runId);
  const stepStatuses = updated.steps.map(s => s.status);
  const hasError = stepStatuses.includes('error');
  const anyOk = stepStatuses.includes('ok');
  const finalStatus: PublishRun['status'] = payload.dryRun
    ? 'planning'
    : hasError
      ? (anyOk ? 'partial' : 'failed')
      : 'ok';
  await markRun(runId, { status: finalStatus, errors: JSON.stringify(errors) });
  return loadRun(runId);
}

export async function rollback(
  runId: string,
  opts: { confirmDestructive?: boolean; onlyKinds?: PublishStep['kind'][] },
): Promise<PublishRun> {
  if (!opts.confirmDestructive) throw new AppError('confirmDestructive: true обязателен для rollback');
  const run = await loadRun(runId);

  const allTools: Record<string, PublishTool> = {
    dns: dnsTool, traefik: traefikTool, authelia: autheliaTool, ru_proxy: ruProxyTool,
    docker_volume: dockerVolumeTool, directories: directoriesTool,
    gitlab_ci: gitlabCiTool, gitlab_variables: gitlabVariablesTool,
    strapi: strapiTool, install_script: installTool, strapi_release: releaseTool,
  };

  const reversed = [...run.steps].reverse();
  const errors: string[] = [];
  for (const step of reversed) {
    if (step.status !== 'ok') continue;
    if (opts.onlyKinds && !opts.onlyKinds.includes(step.kind)) continue;
    const tool = allTools[step.kind];
    if (!tool?.rollback) continue;
    try {
      const ctx: ToolContext = { payload: run.payload!, runId, dryRun: false, sharedState: {} };
      const result = await tool.rollback({ before: step.before, after: step.after }, ctx);
      await markStep(runId, step.kind, {
        status: result.status === 'ok' ? 'rolled_back' : step.status,
        detail: result.detail ?? step.detail ?? null,
        error: result.error ?? null,
      });
      if (result.status === 'error') errors.push(`${step.kind}: ${result.error}`);
    } catch (err) {
      errors.push(`${step.kind}: ${(err as Error).message}`);
    }
  }
  await markRun(runId, { status: errors.length > 0 ? 'partial' : 'rolled_back', errors: JSON.stringify(errors) });
  return loadRun(runId);
}

export async function getRun(runId: string): Promise<PublishRun> {
  return loadRun(runId);
}

export async function listRuns(
  filter: { slug?: string; status?: string; limit?: number; offset?: number },
): Promise<{ runs: unknown[]; total: number }> {
  const db = getDb();
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;
  const all = await db.select().from(publishRuns).orderBy(desc(publishRuns.createdAt));
  const filtered = all.filter(r =>
    (!filter.slug || r.slug === filter.slug) &&
    (!filter.status || r.status === filter.status),
  );
  const page = filtered.slice(offset, offset + limit);
  return {
    runs: page.map(r => ({
      id: r.id, slug: r.slug, type: r.type, status: r.status,
      createdAt: r.createdAt, updatedAt: r.updatedAt, dryRun: r.dryRun,
    })),
    total: filtered.length,
  };
}
