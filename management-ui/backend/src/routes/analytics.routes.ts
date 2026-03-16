import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as analyticsService from '../services/analytics.service.js';

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await analyticsService.getAnalyticsStatus();
  });
}

/**
 * SSO bridge for Umami Analytics — auto-login via Authelia.
 * Traefik routes analytics.dev.* /sso-bridge → management-ui (port 3000).
 * Must be registered at top level (not under /api/).
 */
export async function analyticsSsoBridgeRoute(fastify: FastifyInstance) {
  fastify.get('/sso-bridge', async (req: FastifyRequest, reply: FastifyReply) => {
    const remoteUser = req.headers['remote-user'] as string | undefined;
    if (!remoteUser) {
      return reply.status(403).send('Доступ запрещён (требуется аутентификация через Authelia)');
    }

    try {
      const token = await analyticsService.getUmamiAuthToken(remoteUser);
      const tokenJson = JSON.stringify(token);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Вход...</title></head>
<body><p>Выполняется вход в Umami Analytics...</p>
<script>
try {
  localStorage.setItem("umami.auth", ${JSON.stringify(tokenJson)});
} catch(e) { console.error("SSO storage error:", e); }
window.location.replace("/");
</script></body></html>`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send('SSO вход не удался: ' + msg);
    }
  });
}
