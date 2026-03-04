import type { FastifyInstance } from 'fastify';
import { getBaseDomains } from '../config/env.js';

export async function logoutRoutes(fastify: FastifyInstance) {
  fastify.get('/logout', async (_req, reply) => {
    const baseDomains = getBaseDomains();
    const firstBase = baseDomains[0] || 'borisovai.ru';
    return reply.redirect(`https://auth.${firstBase}/logout`);
  });

  fastify.post('/logout', async () => {
    const baseDomains = getBaseDomains();
    const firstBase = baseDomains[0] || 'borisovai.ru';
    return { success: true, redirect: `https://auth.${firstBase}/logout` };
  });
}
