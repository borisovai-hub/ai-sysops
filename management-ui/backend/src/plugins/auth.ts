import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getDb } from '../db/index.js';
import { authTokens } from '../db/schema.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    authMethod?: 'bearer' | 'authelia';
    authUser?: string;
    tokenName?: string;
  }
}

export interface AuthPluginOptions {
  dbPath?: string;
}

/**
 * Hash a token with SHA-256 for storage and comparison.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Timing-safe comparison of token hashes.
 */
function compareTokenHash(providedToken: string, storedHash: string): boolean {
  const providedHash = hashToken(providedToken);
  const a = Buffer.from(providedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validate a Bearer token against the database.
 * Returns the matching token entry or null.
 */
export async function validateBearerToken(token: string): Promise<{ id: string; name: string } | null> {
  const db = getDb();
  const allTokens = await db.select().from(authTokens);
  for (const entry of allTokens) {
    if (compareTokenHash(token, entry.tokenHash)) {
      return { id: entry.id, name: entry.name };
    }
  }
  return null;
}

async function authPluginFn(fastify: FastifyInstance, _opts: AuthPluginOptions) {
  /**
   * requireAuth: Bearer token OR Authelia ForwardAuth (Remote-User header).
   */
  fastify.decorate('requireAuth', async function (request: FastifyRequest, reply: FastifyReply) {
    // 1. Bearer token
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const entry = await validateBearerToken(token);
      if (entry) {
        request.authMethod = 'bearer';
        request.tokenName = entry.name;
        return;
      }
      return reply.status(401).send({ error: 'Недействительный токен' });
    }

    // 2. Authelia ForwardAuth (Remote-User header from Traefik)
    const remoteUser = request.headers['remote-user'] as string | undefined;
    if (remoteUser) {
      request.authMethod = 'authelia';
      request.authUser = remoteUser;
      return;
    }

    // 3. Dev mode — auto-auth as "dev"
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === '1') {
      request.authMethod = 'authelia';
      request.authUser = 'dev';
      return;
    }

    // Not authenticated
    return reply.status(401).send({ error: 'Требуется авторизация' });
  });

  /**
   * requireSessionAuth: Only Authelia (for managing tokens, users).
   */
  fastify.decorate('requireSessionAuth', async function (request: FastifyRequest, reply: FastifyReply) {
    const remoteUser = request.headers['remote-user'] as string | undefined;
    if (remoteUser) {
      request.authMethod = 'authelia';
      request.authUser = remoteUser;
      return;
    }

    if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === '1') {
      request.authMethod = 'authelia';
      request.authUser = 'dev';
      return;
    }

    return reply.status(401).send({ error: 'Требуется авторизация через сессию' });
  });
}

export const authPlugin = fp(authPluginFn, {
  name: 'auth',
});

// Extend Fastify instance
declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSessionAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
