import type { FastifyInstance } from 'fastify';
import { getUserMailbox } from '../lib/authelia.js';

export async function mailuRoutes(fastify: FastifyInstance) {
  // ForwardAuth endpoint: maps Remote-User → Remote-Email for Mailu
  // Called by Traefik as ForwardAuth middleware (no session auth)
  fastify.get('/auth', async (req, reply) => {
    const remoteUser = req.headers['remote-user'] as string | undefined;
    if (!remoteUser) {
      return reply.status(401).send();
    }
    const mailbox = getUserMailbox(remoteUser);
    reply.header('Remote-Email', mailbox);
    return reply.status(200).send();
  });
}
