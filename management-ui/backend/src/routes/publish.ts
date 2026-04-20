import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  publishPayloadSchema, createReleaseRequestSchema,
  uploadInitRequestSchema, rollbackRequestSchema,
  publishAiRequestSchema,
} from '@management-ui/shared';
import { AppError } from '@management-ui/shared';
import * as orchestrator from '../services/publish/orchestrator.js';
import * as releasesService from '../services/publish/releases.js';
import * as uploadsService from '../services/publish/uploads.js';
import { verifyBySlug } from '../services/publish/verify.js';
import {
  runAiPublisher, resolveApproval, answerQuestion, type SseEvent,
} from '../services/publish/ai/agent.js';
import { invalidateCache, getCacheInfo } from '../services/publish/ai/prompt.js';
import { listToolDefs } from '../services/publish/ai/tools-registry.js';
import { writePublishAudit } from '../services/publish/audit.js';

export async function publishRoutes(fastify: FastifyInstance) {
  const writeScope = fastify.requireScope('publish:write');
  const readAuth = fastify.requireAuth;

  // POST /api/publish/service — инфрасервис
  fastify.post('/service', { preHandler: [writeScope] }, async (req, reply) => {
    const body = publishPayloadSchema.parse(req.body);
    if (body.type !== 'service') {
      throw new AppError('Endpoint /service требует type=service');
    }
    const run = await orchestrator.execute(body);
    await writePublishAudit(req, 'publish.service', { slug: body.slug, dryRun: body.dryRun, status: run.status }, run.id);
    reply.code(run.status === 'ok' ? 201 : run.status === 'partial' ? 207 : 500);
    return run;
  });

  // POST /api/publish/project — пользовательский проект
  fastify.post('/project', { preHandler: [writeScope] }, async (req, reply) => {
    const body = publishPayloadSchema.parse(req.body);
    if (body.type === 'service') {
      throw new AppError('Endpoint /project не принимает type=service, используйте /service');
    }
    const run = await orchestrator.execute(body);
    await writePublishAudit(req, 'publish.project', { slug: body.slug, type: body.type, dryRun: body.dryRun, status: run.status }, run.id);
    reply.code(run.status === 'ok' ? 201 : run.status === 'partial' ? 207 : 500);
    return run;
  });

  // POST /api/publish/verify/:slug
  fastify.post('/verify/:slug', { preHandler: [readAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    return verifyBySlug(slug);
  });

  // POST /api/publish/rollback/:publishId
  fastify.post('/rollback/:publishId', { preHandler: [writeScope] }, async (req) => {
    const { publishId } = req.params as { publishId: string };
    const body = rollbackRequestSchema.parse(req.body || {});
    const run = await orchestrator.rollback(publishId, body);
    await writePublishAudit(req, 'publish.rollback', { publishId, onlyKinds: body.onlyKinds }, publishId);
    return run;
  });

  // GET /api/publish/runs
  fastify.get('/runs', { preHandler: [readAuth] }, async (req) => {
    const q = req.query as { slug?: string; status?: string; limit?: string; offset?: string };
    return orchestrator.listRuns({
      slug: q.slug, status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  // GET /api/publish/runs/:id
  fastify.get('/runs/:id', { preHandler: [readAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return orchestrator.getRun(id);
  });

  // GET /api/publish/schema — JSON Schema всех payload'ов
  fastify.get('/schema', { preHandler: [readAuth] }, async () => {
    try {
      const mod = (await import('zod-to-json-schema').catch(() => null)) as unknown as {
        zodToJsonSchema?: (schema: unknown, name?: string) => unknown;
      } | null;
      if (mod && typeof mod.zodToJsonSchema === 'function') {
        const to = mod.zodToJsonSchema;
        const shared = await import('@management-ui/shared');
        return {
          publishPayload: to(shared.publishPayloadSchema, 'PublishPayload'),
          publishRun: to(shared.publishRunSchema, 'PublishRun'),
          createReleaseRequest: to(shared.createReleaseRequestSchema, 'CreateReleaseRequest'),
          uploadInitRequest: to(shared.uploadInitRequestSchema, 'UploadInitRequest'),
          publishAiRequest: to(shared.publishAiRequestSchema, 'PublishAiRequest'),
          verifyResult: to(shared.verifyResultSchema, 'VerifyResult'),
          tools: listToolDefs(),
        };
      }
    } catch { /* fallback below */ }
    return {
      note: 'zod-to-json-schema не установлен. См. management-ui/shared/src/validation/publish-schemas.ts.',
      tools: listToolDefs(),
    };
  });

  // --- Releases ---

  fastify.post('/releases/:slug', { preHandler: [writeScope] }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = createReleaseRequestSchema.parse(req.body);
    const info = await releasesService.createRelease(slug, body);
    await writePublishAudit(req, 'release.create', { slug, version: body.release.version, publishToSite: body.publishToSite }, slug);
    reply.code(201);
    return info;
  });

  fastify.get('/releases/:slug', { preHandler: [readAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    return releasesService.listReleases(slug);
  });

  fastify.get('/releases/:slug/:version', { preHandler: [readAuth] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    return releasesService.getRelease(slug, version);
  });

  fastify.patch('/releases/:slug/:version', { preHandler: [writeScope] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    const body = req.body as { action?: 'publish' | 'unpublish'; changelog?: string };
    const r = await releasesService.patchRelease(slug, version, body || {});
    await writePublishAudit(req, 'release.patch', { slug, version, action: body?.action }, slug);
    return r;
  });

  fastify.delete('/releases/:slug/:version', { preHandler: [writeScope] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    const body = req.body as { confirmDestructive?: boolean; removeArtifacts?: boolean; removeStrapi?: boolean };
    const r = await releasesService.deleteRelease(slug, version, body || {});
    await writePublishAudit(req, 'release.delete', { slug, version, ...(body ?? {}) }, slug);
    return r;
  });

  // --- Uploads (chunked resumable) ---

  fastify.post('/uploads/init', { preHandler: [writeScope] }, async (req, reply) => {
    const body = uploadInitRequestSchema.parse(req.body);
    const info = await uploadsService.initUpload(body);
    await writePublishAudit(req, 'upload.init', { slug: body.slug, filename: body.filename, sizeBytes: body.sizeBytes }, info.handle);
    reply.code(201);
    return info;
  });

  fastify.put('/uploads/:handle/chunk', { preHandler: [writeScope] }, async (req) => {
    const { handle } = req.params as { handle: string };
    const offset = Number((req.query as { offset?: string }).offset || '0');
    // Принимаем raw binary через getBuffer
    const buf = await (req as unknown as { body: Buffer }).body;
    // fastify по умолчанию парсит application/octet-stream как Buffer через addContentTypeParser в auth.ts
    // Если не распарсен — читаем из raw
    const chunk: Buffer = Buffer.isBuffer(buf) ? buf : await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.raw.on('data', (c: Buffer) => chunks.push(c));
      req.raw.on('end', () => resolve(Buffer.concat(chunks)));
      req.raw.on('error', reject);
    });
    return uploadsService.writeChunk(handle, offset, chunk);
  });

  fastify.post('/uploads/:handle/complete', { preHandler: [writeScope] }, async (req) => {
    const { handle } = req.params as { handle: string };
    const r = await uploadsService.completeUpload(handle);
    await writePublishAudit(req, 'upload.complete', { handle, storagePath: r.storagePath, sizeBytes: r.sizeBytes }, handle);
    return r;
  });

  // --- AI (SSE) ---
  fastify.post('/ai', { preHandler: [writeScope] }, async (req, reply) => {
    const body = publishAiRequestSchema.parse(req.body);
    const sessionId = `sess_${randomUUID().slice(0, 12)}`;

    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders?.();

    const emit = (e: SseEvent) => {
      raw.write(`event: ${e.event}\n`);
      raw.write(`data: ${JSON.stringify(e.data)}\n\n`);
    };

    // Heartbeat, чтобы прокси не резали соединение
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000);

    await writePublishAudit(req, 'ai.start', { sessionId, approvals: body.approvals, promptPreview: body.prompt.slice(0, 200) }, sessionId);
    try {
      await runAiPublisher({
        sessionId,
        prompt: body.prompt,
        approvals: body.approvals,
        context: body.context,
      }, emit);
    } catch (err) {
      emit({ event: 'error', data: { code: 'INTERNAL', message: (err as Error).message } });
    } finally {
      clearInterval(heartbeat);
      raw.end();
    }
  });

  // POST /api/publish/ai/approve/:sessionId — клиент подтверждает destructive tool
  fastify.post('/ai/approve/:sessionId', { preHandler: [writeScope] }, async (req) => {
    const { approvalId, decision } = req.body as { approvalId?: string; decision?: 'approve' | 'reject' };
    if (!approvalId || !decision) throw new AppError('approvalId и decision обязательны');
    const ok = resolveApproval(approvalId, decision);
    await writePublishAudit(req, 'ai.approve', { approvalId, decision }, approvalId);
    return { ok };
  });

  // POST /api/publish/ai/answer/:sessionId — ответ на LLM question
  fastify.post('/ai/answer/:sessionId', { preHandler: [writeScope] }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    const { answer } = req.body as { answer?: string };
    const ok = answerQuestion(sessionId, String(answer ?? ''));
    return { ok };
  });

  // POST /api/publish/ai/invalidate-cache — перечитать AGENT_PUBLISH.md
  fastify.post('/ai/invalidate-cache', { preHandler: [writeScope] }, async () => {
    invalidateCache();
    return { ok: true, cache: getCacheInfo() };
  });
}
