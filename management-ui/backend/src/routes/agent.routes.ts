import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createSessionSchema, chatMessageSchema } from '@management-ui/shared';
import {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  getSessionMessages,
  processMessage,
  getPendingApprovals,
  resolveApproval,
} from '../services/agent.service.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // --- Sessions ---

  // GET /api/agent/sessions — список сессий
  app.get('/sessions', { preHandler: [app.requireAuth] }, async () => {
    return await listSessions();
  });

  // POST /api/agent/sessions — создать сессию
  app.post('/sessions', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const body = createSessionSchema.parse(req.body || {});
    return await createSession(body.title, body.model, body.systemPrompt);
  });

  // GET /api/agent/sessions/:id — получить сессию
  app.get('/sessions/:id', { preHandler: [app.requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const session = await getSession(id);
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' });
    return session;
  });

  // DELETE /api/agent/sessions/:id — удалить сессию
  app.delete('/sessions/:id', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    await deleteSession(id);
    return { ok: true };
  });

  // GET /api/agent/sessions/:id/messages — история сообщений
  app.get('/sessions/:id/messages', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    return await getSessionMessages(id);
  });

  // --- Chat (SSE) ---

  // POST /api/agent/chat — отправить сообщение, получить SSE stream
  app.post('/chat', { preHandler: [app.requireAuth] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = chatMessageSchema.parse(req.body);

    let sessionId = body.sessionId;

    // Автосоздание сессии если не указана
    if (!sessionId) {
      const session = await createSession(body.message.slice(0, 60));
      sessionId = session.id;
    }

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId,
    });

    try {
      for await (const event of processMessage(sessionId, body.message)) {
        const data = JSON.stringify({ type: event.type, ...event.data });
        reply.raw.write(`data: ${data}\n\n`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
    } finally {
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    }
  });

  // --- Approvals ---

  // GET /api/agent/approvals — pending approvals
  app.get('/approvals', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const query = req.query as { sessionId?: string };
    return await getPendingApprovals(query.sessionId);
  });

  // POST /api/agent/approvals/:id/approve — одобрить
  app.post('/approvals/:id/approve', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    await resolveApproval(id, true);
    return { ok: true };
  });

  // POST /api/agent/approvals/:id/deny — отклонить
  app.post('/approvals/:id/deny', { preHandler: [app.requireAuth] }, async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    const body = req.body as { reason?: string } | undefined;
    await resolveApproval(id, false, body?.reason);
    return { ok: true };
  });

  // --- Tools ---

  // GET /api/agent/tools — список доступных инструментов
  app.get('/tools', { preHandler: [app.requireAuth] }, async () => {
    const { AGENT_TOOLS } = await import('../lib/agent/index.js');
    return AGENT_TOOLS;
  });
}
