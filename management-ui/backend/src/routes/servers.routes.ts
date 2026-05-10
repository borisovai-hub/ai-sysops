import type { FastifyInstance } from 'fastify';
import {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
} from '../services/servers.service.js';
import {
  isStepCaAvailable,
  issueBootstrapToken,
  getRootFingerprint,
  getIntermediatePem,
  getCaUrlExternal,
  buildBootstrapCommand,
} from '../services/step-ca.service.js';
import { nodeAgentClient } from '../lib/node-agent-client.js';
import type {
  CreateServerRequest,
  UpdateServerRequest,
  CreateServerResponse,
  ServerHealthSnapshot,
} from '@management-ui/shared';
import { AppError } from '@management-ui/shared';

export async function serversRoutes(fastify: FastifyInstance) {
  // GET /api/servers — список + health для каждого
  fastify.get('/', { preHandler: [fastify.requireAuth] }, async () => {
    const servers = listServers();
    const healths = await Promise.all(
      servers.map(async (s) => {
        try {
          const client = nodeAgentClient(s);
          const h = await client.health();
          return [s.name, h] as const;
        } catch (err) {
          return [
            s.name,
            { reachable: false, error: (err as Error).message, checked_at: new Date().toISOString() } as ServerHealthSnapshot,
          ] as const;
        }
      }),
    );
    const healthMap = Object.fromEntries(healths);
    return {
      servers: servers.map((s) => ({ ...s, health: healthMap[s.name] })),
      step_ca_available: isStepCaAvailable(),
    };
  });

  // GET /api/servers/:name
  fastify.get<{ Params: { name: string } }>('/:name', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { name } = req.params;
    const server = getServer(name);
    const client = nodeAgentClient(server);
    const [health, services] = await Promise.all([client.health(), client.getServicesStatus()]);
    return { server, health, services };
  });

  // POST /api/servers — добавить сервер + сгенерировать bootstrap-токен
  fastify.post<{ Body: CreateServerRequest }>('/', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    if (!isStepCaAvailable()) {
      throw new AppError('step-ca недоступен — невозможно выдать bootstrap-токен. Установите step-ca на primary.', 500);
    }
    const created = createServer(req.body);

    let bootstrapToken: string;
    try {
      bootstrapToken = issueBootstrapToken(created.agent_san, 60);
    } catch (err) {
      // rollback
      try { deleteServer(created.name); } catch { /* ignore */ }
      throw err;
    }

    const fingerprint = getRootFingerprint();
    const caUrlExternal = getCaUrlExternal();
    const response: CreateServerResponse = {
      server: created,
      bootstrap_token: bootstrapToken,
      bootstrap_command: buildBootstrapCommand(created.name, created.agent_san, bootstrapToken, caUrlExternal, fingerprint),
      ca_url: caUrlExternal,
      ca_root_fingerprint: fingerprint,
      intermediate_pem: getIntermediatePem(),
    };
    return reply.code(201).send(response);
  });

  // PUT /api/servers/:name
  fastify.put<{ Params: { name: string }; Body: UpdateServerRequest }>(
    '/:name',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      return { server: updateServer(req.params.name, req.body) };
    },
  );

  // DELETE /api/servers/:name
  fastify.delete<{ Params: { name: string } }>(
    '/:name',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      deleteServer(req.params.name);
      return { success: true };
    },
  );

  // POST /api/servers/:name/test — пинг агента через mTLS
  fastify.post<{ Params: { name: string } }>(
    '/:name/test',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      const server = getServer(req.params.name);
      const client = nodeAgentClient(server);
      const health = await client.health();
      return { server: server.name, health };
    },
  );

  // POST /api/servers/:name/sync — git pull в config-репе на агенте
  fastify.post<{ Params: { name: string } }>(
    '/:name/sync',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      const server = getServer(req.params.name);
      const client = nodeAgentClient(server);
      const r = await client.syncConfig();
      return { server: server.name, ...r };
    },
  );

  // POST /api/servers/:name/reload/:service
  fastify.post<{ Params: { name: string; service: string } }>(
    '/:name/reload/:service',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      const server = getServer(req.params.name);
      const client = nodeAgentClient(server);
      const r = await client.reloadService(req.params.service);
      return { server: server.name, service: req.params.service, ...r };
    },
  );

  // POST /api/servers/:name/rotate-token — выдать новый bootstrap-токен
  // (например, если сервер недоступен и нужно переустановить агент)
  fastify.post<{ Params: { name: string } }>(
    '/:name/rotate-token',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      const server = getServer(req.params.name);
      if (!isStepCaAvailable()) {
        throw new AppError('step-ca недоступен', 500);
      }
      const token = issueBootstrapToken(server.agent_san, 60);
      const fingerprint = getRootFingerprint();
      const caUrlExternal = getCaUrlExternal();
      const response: CreateServerResponse = {
        server,
        bootstrap_token: token,
        bootstrap_command: buildBootstrapCommand(server.name, server.agent_san, token, caUrlExternal, fingerprint),
        ca_url: caUrlExternal,
        ca_root_fingerprint: fingerprint,
        intermediate_pem: getIntermediatePem(),
      };
      return response;
    },
  );
}
