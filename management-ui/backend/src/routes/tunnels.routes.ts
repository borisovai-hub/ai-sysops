import type { FastifyInstance } from 'fastify';
import * as tunnelsService from '../services/tunnels.service.js';

export async function tunnelsRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await tunnelsService.getTunnelStatus();
  });

  fastify.get('/proxies', { preHandler: [fastify.requireAuth] }, async () => {
    return await tunnelsService.getTunnelProxies();
  });

  fastify.get('/config', { preHandler: [fastify.requireSessionAuth] }, async () => {
    return tunnelsService.getTunnelConfig();
  });

  fastify.get('/client-config', { preHandler: [fastify.requireSessionAuth] }, async (req, reply) => {
    const query = req.query as { subdomain?: string; localPort?: string };
    const subdomain = query.subdomain || 'my-project';
    const localPort = parseInt(query.localPort || '3000', 10);
    const toml = tunnelsService.generateClientConfig(subdomain, localPort);
    reply.header('Content-Type', 'application/toml');
    reply.header('Content-Disposition', 'attachment; filename="frpc.toml"');
    return toml;
  });
}
