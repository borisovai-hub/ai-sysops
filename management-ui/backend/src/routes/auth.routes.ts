import type { FastifyInstance } from 'fastify';
import { createTokenSchema } from '@management-ui/shared';
import * as authService from '../services/auth.service.js';
import { validateBearerToken } from '../plugins/auth.js';

export async function authRoutes(fastify: FastifyInstance) {
  // GET /api/auth/check — проверка авторизации (для фронтенда)
  fastify.get('/check', async (request) => {
    // 1. Bearer token
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const entry = await validateBearerToken(token);
      if (entry) {
        return { authenticated: true, method: 'bearer', user: entry.name };
      }
      return { authenticated: false };
    }

    // 2. Authelia ForwardAuth
    const remoteUser = request.headers['remote-user'] as string | undefined;
    if (remoteUser) {
      return { authenticated: true, method: 'authelia', user: remoteUser };
    }

    // 3. Dev mode
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === '1') {
      return { authenticated: true, method: 'dev', user: 'dev' };
    }

    return { authenticated: false };
  });

  // GET /api/auth/tokens — список токенов (только Authelia-сессия)
  fastify.get('/tokens', {
    onRequest: [fastify.requireSessionAuth],
  }, async () => {
    return authService.listTokens();
  });

  // POST /api/auth/tokens — создать токен
  fastify.post<{ Body: { name: string } }>('/tokens', {
    onRequest: [fastify.requireSessionAuth],
  }, async (request, reply) => {
    const { name } = createTokenSchema.parse(request.body);
    const result = await authService.createToken(name);
    return reply.status(201).send(result);
  });

  // DELETE /api/auth/tokens/:id — удалить токен
  fastify.delete<{ Params: { id: string } }>('/tokens/:id', {
    onRequest: [fastify.requireSessionAuth],
  }, async (request, reply) => {
    const deleted = await authService.deleteToken(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Токен не найден' });
    }
    return { success: true };
  });
}
