import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '@management-ui/shared';
import {
  listSources, findSource, streamLogs, diagnostics,
} from '../services/logs.service.js';

export async function logsRoutes(fastify: FastifyInstance) {
  // GET /api/logs/sources — список whitelisted источников логов
  fastify.get('/sources', { preHandler: [fastify.requireAuth] }, async () => {
    return { sources: listSources(), diagnostics: diagnostics() };
  });

  // GET /api/logs/:source/snapshot?lines=200 — одномоментный tail (JSON)
  fastify.get('/:source/snapshot', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { source } = req.params as { source: string };
    const q = req.query as { lines?: string };
    const src = findSource(source);
    if (!src) throw new NotFoundError(`log source ${source} не найден`);
    const linesN = q.lines ? Number(q.lines) : 200;

    const linesOut: Array<{ ts: string; text: string }> = [];
    await new Promise<void>((resolve) => {
      streamLogs(src, {
        lines: linesN, follow: false,
        onLine: (text, ts) => linesOut.push({ ts, text }),
        onClose: () => resolve(),
        onError: (msg) => linesOut.push({ ts: new Date().toISOString(), text: `[stream error] ${msg}` }),
      });
    });
    return { source: src.id, lines: linesOut };
  });

  // GET /api/logs/:source/stream?lines=200&follow=true — SSE tail -f
  fastify.get('/:source/stream', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const { source } = req.params as { source: string };
    const q = req.query as { lines?: string; follow?: string };
    const src = findSource(source);
    if (!src) throw new NotFoundError(`log source ${source} не найден`);

    const linesN = q.lines ? Number(q.lines) : 200;
    const follow = q.follow !== 'false';

    reply.hijack();
    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no');
    raw.flushHeaders?.();

    const emit = (event: string, data: unknown) => {
      if (raw.writableEnded) return;
      raw.write(`event: ${event}\n`);
      raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    emit('meta', { source: src.id, label: src.label, type: src.type, follow });

    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) raw.write(': heartbeat\n\n');
    }, 20_000);

    const handle = streamLogs(src, {
      lines: linesN, follow,
      onLine: (text, ts) => emit('line', { ts, text }),
      onClose: (code, reason) => {
        emit('done', { code, reason });
        clearInterval(heartbeat);
        if (!raw.writableEnded) raw.end();
      },
      onError: (msg) => emit('error', { message: msg }),
    });

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      handle.close();
    });
  });
}
