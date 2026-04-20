import type { FastifyInstance } from 'fastify';
import {
  publishPayloadSchema, createReleaseRequestSchema,
  uploadInitRequestSchema, rollbackRequestSchema,
} from '@management-ui/shared';
import { AppError } from '@management-ui/shared';
import * as orchestrator from '../services/publish/orchestrator.js';
import * as releasesService from '../services/publish/releases.js';
import * as uploadsService from '../services/publish/uploads.js';
import { verifyBySlug } from '../services/publish/verify.js';
import { readFileSync } from 'node:fs';

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

  // GET /api/publish/schema — JSON Schema всех payload'ов (для UI и внешних LLM)
  fastify.get('/schema', { preHandler: [fastify.requireAuth] }, async () => {
    // Возвращаем структуру с названиями; zod-to-json-schema можно подключить позже.
    return {
      publishPayload: 'see management-ui/shared/src/validation/publish-schemas.ts#publishPayloadSchema',
      publishRun: 'see publishRunSchema',
      publishAiRequest: 'see publishAiRequestSchema',
      verifyResult: 'see verifyResultSchema',
      note: 'Запуск zod-to-json-schema будет добавлен в Фазе 3 LLM-агента.',
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

  // --- AI (stub until Phase 3) ---
  fastify.post('/ai', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    reply.code(501);
    return {
      error: 'NOT_IMPLEMENTED',
      message: 'LLM-оркестратор /api/publish/ai будет реализован в Phase 3. ' +
               'Используйте POST /api/publish/service|project с payload напрямую.',
      contract: 'docs/agents/AGENT_PUBLISH_AI.md',
    };
  });
}
