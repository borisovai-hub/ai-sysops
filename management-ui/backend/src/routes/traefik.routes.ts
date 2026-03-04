import type { FastifyInstance } from 'fastify';
import * as servicesService from '../services/services.service.js';

export async function traefikRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async (_req, reply) => {
    try {
      return await servicesService.getTraefikStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ status: 'error', error: message });
    }
  });
}
