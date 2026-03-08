import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { authPlugin } from './plugins/auth.js';
import { errorHandler } from './plugins/error-handler.js';
import { authRoutes } from './routes/auth.routes.js';
import { dnsRoutes } from './routes/dns.routes.js';
import { servicesRoutes } from './routes/services.routes.js';
import { traefikRoutes } from './routes/traefik.routes.js';
import { projectsRoutes } from './routes/projects.routes.js';
import { gitlabRoutes } from './routes/gitlab.routes.js';
import { contentRoutes } from './routes/content.routes.js';
import { usersRoutes } from './routes/users.routes.js';
import { mailuRoutes } from './routes/mailu.routes.js';
import { tunnelsRoutes } from './routes/tunnels.routes.js';
import { analyticsRoutes, analyticsSsoBridgeRoute } from './routes/analytics.routes.js';
import { ruProxyRoutes } from './routes/ru-proxy.routes.js';
import { filesRoutes } from './routes/files.routes.js';
import { gitRoutes } from './routes/git.routes.js';
import { logoutRoutes } from './routes/logout.routes.js';
import { agentRoutes } from './routes/agent.routes.js';
import { monitoringRoutes } from './routes/monitoring.routes.js';

export interface AppOptions {
  logger?: boolean;
  dbPath?: string;
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
  });

  // Error handler
  app.setErrorHandler(errorHandler);

  // CORS: permissive in dev, same-origin in production.
  const isDev = process.env.NODE_ENV !== 'production';
  await app.register(cors, {
    origin: isDev ? true : false,
    credentials: true,
  });

  // Multipart (file uploads)
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  });

  // Auth plugin (decorates request with auth info)
  await app.register(authPlugin, { dbPath: opts.dbPath });

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dnsRoutes, { prefix: '/api/dns' });
  await app.register(servicesRoutes, { prefix: '/api/services' });
  await app.register(traefikRoutes, { prefix: '/api/traefik' });
  await app.register(projectsRoutes, { prefix: '/api/publish' });
  await app.register(gitlabRoutes, { prefix: '/api/gitlab' });
  await app.register(contentRoutes, { prefix: '/api/content' });
  await app.register(usersRoutes, { prefix: '/api/authelia' });
  await app.register(mailuRoutes, { prefix: '/api/mailu' });
  await app.register(tunnelsRoutes, { prefix: '/api/tunnels' });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.register(analyticsSsoBridgeRoute); // Top-level: Traefik routes /sso-bridge here
  await app.register(ruProxyRoutes, { prefix: '/api/ru-proxy' });
  await app.register(filesRoutes, { prefix: '/api/files' });
  await app.register(gitRoutes, { prefix: '/api/git' });
  await app.register(logoutRoutes);
  await app.register(agentRoutes, { prefix: '/api/agent' });
  await app.register(monitoringRoutes, { prefix: '/api/monitoring' });

  // Health check
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Static frontend (React SPA)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const frontendDist = join(__dirname, '../../frontend/dist');
  if (existsSync(frontendDist)) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback: non-API routes → index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not Found', message: `Route ${request.method}:${request.url} not found`, statusCode: 404 });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
