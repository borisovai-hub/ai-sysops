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

export async function publishRoutes(fastify: FastifyInstance) {
  // POST /api/publish/service — инфрасервис
  fastify.post('/service', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const body = publishPayloadSchema.parse(req.body);
    if (body.type !== 'service') {
      throw new AppError('Endpoint /service требует type=service');
    }
    const run = await orchestrator.execute(body);
    reply.code(run.status === 'ok' ? 201 : run.status === 'partial' ? 207 : 500);
    return run;
  });

  // POST /api/publish/project — пользовательский проект
  fastify.post('/project', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const body = publishPayloadSchema.parse(req.body);
    if (body.type === 'service') {
      throw new AppError('Endpoint /project не принимает type=service, используйте /service');
    }
    const run = await orchestrator.execute(body);
    reply.code(run.status === 'ok' ? 201 : run.status === 'partial' ? 207 : 500);
    return run;
  });

  // POST /api/publish/verify/:slug
  fastify.post('/verify/:slug', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    return verifyBySlug(slug);
  });

  // POST /api/publish/rollback/:publishId
  fastify.post('/rollback/:publishId', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { publishId } = req.params as { publishId: string };
    const body = rollbackRequestSchema.parse(req.body || {});
    return orchestrator.rollback(publishId, body);
  });

  // GET /api/publish/runs
  fastify.get('/runs', { preHandler: [fastify.requireAuth] }, async (req) => {
    const q = req.query as { slug?: string; status?: string; limit?: string; offset?: string };
    return orchestrator.listRuns({
      slug: q.slug, status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  // GET /api/publish/runs/:id
  fastify.get('/runs/:id', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return orchestrator.getRun(id);
  });

  // GET /api/publish/schema — JSON Schema всех payload'ов
  fastify.get('/schema', { preHandler: [fastify.requireAuth] }, async () => {
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

  fastify.post('/releases/:slug', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = createReleaseRequestSchema.parse(req.body);
    const info = await releasesService.createRelease(slug, body);
    reply.code(201);
    return info;
  });

  fastify.get('/releases/:slug', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    return releasesService.listReleases(slug);
  });

  fastify.get('/releases/:slug/:version', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    return releasesService.getRelease(slug, version);
  });

  fastify.patch('/releases/:slug/:version', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    const body = req.body as { action?: 'publish' | 'unpublish'; changelog?: string };
    return releasesService.patchRelease(slug, version, body || {});
  });

  fastify.delete('/releases/:slug/:version', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug, version } = req.params as { slug: string; version: string };
    const body = req.body as { confirmDestructive?: boolean; removeArtifacts?: boolean; removeStrapi?: boolean };
    return releasesService.deleteRelease(slug, version, body || {});
  });

  // --- Uploads (chunked resumable) ---

  fastify.post('/uploads/init', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const body = uploadInitRequestSchema.parse(req.body);
    const info = await uploadsService.initUpload(body);
    reply.code(201);
    return info;
  });

  fastify.put('/uploads/:handle/chunk', { preHandler: [fastify.requireAuth] }, async (req) => {
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

  fastify.post('/uploads/:handle/complete', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { handle } = req.params as { handle: string };
    return uploadsService.completeUpload(handle);
  });

  // --- AI (SSE) ---
  fastify.post('/ai', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
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
  fastify.post('/ai/approve/:sessionId', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { approvalId, decision } = req.body as { approvalId?: string; decision?: 'approve' | 'reject' };
    if (!approvalId || !decision) throw new AppError('approvalId и decision обязательны');
    const ok = resolveApproval(approvalId, decision);
    return { ok };
  });

  // POST /api/publish/ai/answer/:sessionId — ответ на LLM question
  fastify.post('/ai/answer/:sessionId', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    const { answer } = req.body as { answer?: string };
    const ok = answerQuestion(sessionId, String(answer ?? ''));
    return { ok };
  });

  // POST /api/publish/ai/invalidate-cache — перечитать AGENT_PUBLISH.md
  fastify.post('/ai/invalidate-cache', { preHandler: [fastify.requireAuth] }, async () => {
    invalidateCache();
    return { ok: true, cache: getCacheInfo() };
  });
}
