import type { FastifyInstance } from 'fastify';
import { publishProjectSchema, releaseProjectSchema } from '@management-ui/shared';
import * as projectsService from '../services/projects.service.js';
import * as configService from '../services/config.service.js';

export async function projectsRoutes(fastify: FastifyInstance) {
  // GET /api/publish/config
  fastify.get('/config', { preHandler: [fastify.requireAuth] }, async () => {
    return configService.getPublishConfig();
  });

  // GET /api/publish/projects
  fastify.get('/projects', { preHandler: [fastify.requireAuth] }, async () => {
    const projects = projectsService.listProjects();
    return { projects };
  });

  // POST /api/publish/projects
  fastify.post('/projects', { preHandler: [fastify.requireAuth] }, async (req) => {
    const body = publishProjectSchema.parse(req.body);
    // Normalize: frontend sends type/gitlabProject, service expects projectType/gitlabProjectId
    const projectType = body.projectType ?? body.type!;
    let gitlabProjectId = body.gitlabProjectId;
    if (!gitlabProjectId && body.gitlabProject != null) {
      gitlabProjectId = typeof body.gitlabProject === 'number'
        ? body.gitlabProject
        : parseInt(body.gitlabProject, 10) || 0;
      // If not a numeric string (e.g. "group/name"), resolve via GitLab API
      if (!gitlabProjectId && typeof body.gitlabProject === 'string') {
        const normalized = body.gitlabProject.replace(/\\/g, '/');
        const encoded = encodeURIComponent(normalized);
        const project = await projectsService.resolveGitlabProject(encoded);
        gitlabProjectId = project.id as number;
      }
    }
    const result = await projectsService.publishProject({
      ...body,
      gitlabProjectId: gitlabProjectId!,
      projectType,
    });
    return { success: true, project: result.project };
  });

  // DELETE /api/publish/projects/:slug
  fastify.delete('/projects/:slug', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    await projectsService.deleteProject(slug);
    return { success: true, message: 'Проект удалён из реестра' };
  });

  // PUT /api/publish/projects/:slug/retry
  fastify.put('/projects/:slug/retry', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    const result = await projectsService.retryProject(slug);
    return { success: true, retried: result.retried, project: result.project };
  });

  // PUT /api/publish/projects/:slug/update-ci
  fastify.put('/projects/:slug/update-ci', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    await projectsService.updateCi(slug);
    return { success: true, message: 'CI файлы обновлены' };
  });

  // POST /api/publish/projects/:slug/release
  fastify.post('/projects/:slug/release', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    const body = releaseProjectSchema.parse(req.body);
    const result = await projectsService.recordRelease(slug, body);
    return { success: true, release: result.release, strapiResult: result.strapiResult };
  });

  // GET /api/publish/projects/:slug/releases
  fastify.get('/projects/:slug/releases', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { slug } = req.params as { slug: string };
    const releases = projectsService.getReleases(slug);
    return { releases };
  });
}
