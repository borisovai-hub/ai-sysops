import type { FastifyInstance } from 'fastify';
import * as projectsService from '../services/projects.service.js';

export async function gitlabRoutes(fastify: FastifyInstance) {
  fastify.get('/projects', { preHandler: [fastify.requireAuth] }, async () => {
    const projects = await projectsService.listGitlabProjects();
    return { projects };
  });
}
