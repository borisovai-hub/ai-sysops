import type { FastifyInstance } from 'fastify';
import * as analyticsService from '../services/analytics.service.js';

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await analyticsService.getAnalyticsStatus();
  });
}
