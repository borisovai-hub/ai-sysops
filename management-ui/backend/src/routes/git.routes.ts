import type { FastifyInstance } from 'fastify';
import { commitSchema, pushSchema, revertSchema } from '@management-ui/shared';
import * as gitService from '../services/git.service.js';

export async function gitRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await gitService.status();
  });

  fastify.get('/diff', { preHandler: [fastify.requireAuth] }, async (req) => {
    const query = req.query as { file?: string };
    const diff = await gitService.diff(query.file);
    return { diff };
  });

  fastify.get('/log', { preHandler: [fastify.requireAuth] }, async (req) => {
    const query = req.query as { maxCount?: string };
    const maxCount = query.maxCount ? parseInt(query.maxCount, 10) : undefined;
    const log = await gitService.log(maxCount);
    return { log };
  });

  fastify.post('/commit', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { files, message } = commitSchema.parse(req.body);
    const result = await gitService.commit(files, message);
    return { success: true, ...result };
  });

  fastify.post('/push', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { remote, branch } = pushSchema.parse(req.body || {});
    const result = await gitService.push(remote, branch);
    return result;
  });

  fastify.post('/revert', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { hash } = revertSchema.parse(req.body);
    const result = await gitService.revert(hash);
    return { success: true, ...result };
  });
}
