import type { FastifyInstance } from 'fastify';
import * as casdoorService from '../services/casdoor.service.js';

export async function casdoorRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await casdoorService.getCasdoorStatus();
  });
}
