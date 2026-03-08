/**
 * Cross-domain Authelia session sync routes.
 *
 * Two endpoints:
 * 1. POST /api/auth/cross-sync (protected) — generates one-time token
 * 2. GET /auth/cross-sync-accept (UNPROTECTED) — sets cookie on target domain
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  parseCookie,
  getBaseDomain,
  getOtherDomain,
  generateSyncToken,
  consumeSyncToken,
} from '../lib/cross-sync.js';

/**
 * Protected endpoint: generate sync token.
 * Register under /api/auth prefix.
 */
export async function crossSyncApiRoute(fastify: FastifyInstance) {
  fastify.post('/cross-sync', async (req: FastifyRequest, reply: FastifyReply) => {
    const remoteUser = req.headers['remote-user'] as string | undefined;

    // Also accept Bearer auth (frontend sends Authorization header)
    if (!remoteUser) {
      return reply.status(403).send({ error: 'Not authenticated via Authelia' });
    }

    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = parseCookie(cookieHeader, 'authelia_session');
    if (!sessionCookie) {
      return reply.status(400).send({ error: 'No Authelia session cookie' });
    }

    const hostname = req.hostname;
    const currentDomain = getBaseDomain(hostname);
    const otherDomain = getOtherDomain(hostname);
    if (!currentDomain || !otherDomain) {
      return reply.status(400).send({ error: 'Unknown domain' });
    }

    const token = generateSyncToken(sessionCookie, otherDomain, remoteUser);

    // Build the prefix on the other domain (same subdomain structure)
    const prefix = hostname.replace(currentDomain, '');
    const targetHost = prefix + otherDomain;
    const rd = req.headers.referer || `https://${hostname}/`;
    const syncUrl = `https://${targetHost}/auth/cross-sync-accept?token=${token}&rd=${encodeURIComponent(rd)}`;

    return { syncUrl, targetDomain: otherDomain };
  });
}

/**
 * Unprotected endpoint: accept sync token and set cookie.
 * Register at top level (NOT under /api/, NOT behind Authelia).
 */
export async function crossSyncAcceptRoute(fastify: FastifyInstance) {
  fastify.get('/auth/cross-sync-accept', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { token?: string; rd?: string };
    if (!query.token) {
      return reply.status(400).send('Missing token');
    }

    const data = consumeSyncToken(query.token);
    if (!data) {
      return reply.status(403).send('Invalid or expired sync token');
    }

    // Set the Authelia session cookie for the target domain
    const cookieValue = `authelia_session=${data.sessionCookie}; Domain=${data.targetDomain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
    reply.header('Set-Cookie', cookieValue);

    const rd = query.rd || `https://admin.${data.targetDomain}/`;
    return reply.redirect(rd);
  });
}
