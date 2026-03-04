import type { FastifyInstance } from 'fastify';
import * as contentService from '../services/content.service.js';

export async function contentRoutes(fastify: FastifyInstance) {
  fastify.get('/drafts', { preHandler: [fastify.requireAuth] }, async () => {
    const drafts = await contentService.listDrafts();
    return { success: true, drafts };
  });

  fastify.put('/:contentType/:id/publish', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { contentType, id } = req.params as { contentType: string; id: string };
    await contentService.publishContent(contentType, parseInt(id, 10));
    return { success: true, message: `Опубликовано: ${contentType}/${id}` };
  });

  fastify.put('/:contentType/:id/unpublish', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { contentType, id } = req.params as { contentType: string; id: string };
    await contentService.unpublishContent(contentType, parseInt(id, 10));
    return { success: true, message: `Снято с публикации: ${contentType}/${id}` };
  });
}
