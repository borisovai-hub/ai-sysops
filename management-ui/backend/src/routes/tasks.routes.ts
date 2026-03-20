import type { FastifyInstance } from 'fastify';
import * as tasksService from '../services/tasks.service.js';

export async function tasksRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await tasksService.getTasksStatus();
  });
}
