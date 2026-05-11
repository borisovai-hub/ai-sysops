import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  generateInstallToken,
} from '../services/servers.service.js';
import { createInstallToken } from '../services/auth.service.js';
import { allocateRemotePort, loadFrpsConfig, isFrpsAvailable } from '../services/frps.service.js';
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

function findInstallScript(): string | null {
  // Production: /opt/borisovai-admin/scripts/single-machine/install-node-agent.sh
  // Dev: from repo root
  const candidates = [
    '/opt/borisovai-admin/scripts/single-machine/install-node-agent.sh',
    process.env.INSTALL_NODE_AGENT_PATH || '',
  ].filter(Boolean);
  // Walk up from this file
  const here = dirname(fileURLToPath(import.meta.url));
  for (let dir = here, i = 0; i < 8; i++, dir = dirname(dir)) {
    candidates.push(join(dir, 'scripts/single-machine/install-node-agent.sh'));
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

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

  // POST /api/servers — добавить сервер + сгенерировать all-in-one install-token
  fastify.post<{ Body: CreateServerRequest }>('/', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    if (!isStepCaAvailable()) {
      throw new AppError('step-ca недоступен — невозможно выдать bootstrap-токен. Установите step-ca на primary.', 500);
    }
    if (req.body.role === 'secondary' && !isFrpsAvailable()) {
      throw new AppError('frps недоступен — невозможно аллоцировать порт для secondary', 500);
    }

    const created = createServer(req.body, {
      allocatePort: req.body.role === 'secondary' ? allocateRemotePort : undefined,
    });

    let bootstrapToken: string;
    let installToken: string;
    try {
      bootstrapToken = issueBootstrapToken(created.agent_san, 60);
      installToken = generateInstallToken();
      await createInstallToken(created.name, installToken);
    } catch (err) {
      try { deleteServer(created.name); } catch { /* ignore */ }
      throw err;
    }

    const fingerprint = getRootFingerprint();
    const caUrlExternal = getCaUrlExternal();
    const adminUrl = process.env.ADMIN_PUBLIC_URL || 'https://admin.borisovai.ru';
    const installUrl = `${adminUrl}/api/servers/install`;
    const oneLiner = `curl -fsSL -H "Authorization: Bearer ${installToken}" ${installUrl} | sudo bash`;

    const response: CreateServerResponse = {
      server: created,
      bootstrap_token: bootstrapToken,
      bootstrap_command: oneLiner,
      ca_url: caUrlExternal,
      ca_root_fingerprint: fingerprint,
      intermediate_pem: getIntermediatePem(),
      install_token: installToken,
      install_url: installUrl,
    };
    return reply.code(201).send(response);
  });

  // GET /api/servers/install — выдаёт самодостаточный bash-скрипт с зашитыми
  // секретами для установки frpc + node-agent. Требует bearer install_token
  // со скоупом install:<server_name>. После использования токен удаляется
  // отдельным cleanup-job (или вручную через DELETE /api/auth/tokens).
  fastify.get('/install', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const scopes = (req as unknown as { tokenScopes?: string[] }).tokenScopes || [];
    const installScope = scopes.find((s) => s.startsWith('install:'));
    if (!installScope) {
      return reply.code(403).send({ error: 'Токен без install:<server> scope' });
    }
    const serverName = installScope.slice('install:'.length);
    const server = getServer(serverName);
    if (server.role !== 'secondary') {
      return reply.code(400).send({ error: 'install endpoint доступен только для secondary серверов' });
    }
    if (!server.frps_remote_port) {
      return reply.code(500).send({ error: 'frps_remote_port не выделен для сервера' });
    }

    const frps = loadFrpsConfig();
    const fingerprint = getRootFingerprint();
    const intermediate = getIntermediatePem();
    const caUrlExternal = getCaUrlExternal();

    const bootstrapToken = issueBootstrapToken(server.agent_san, 60);

    // Читаем install-node-agent.sh с диска (рядом с приложением или в REPO_DIR)
    const installScriptPath = findInstallScript();
    if (!installScriptPath) {
      return reply.code(500).send({ error: 'install-node-agent.sh не найден на сервере' });
    }
    const installScriptBody = readFileSync(installScriptPath, 'utf-8');

    const script = `#!/bin/bash
# Auto-generated install script for ${server.name}
# Generated at: ${new Date().toISOString()}
# Inline-installs frpc tunnel + node-agent with mTLS to ${caUrlExternal}
set -e

# Сохраняем install-node-agent.sh из inline body в /tmp
cat > /tmp/install-node-agent.sh <<'INSTALL_NODE_AGENT_EOF'
${installScriptBody}
INSTALL_NODE_AGENT_EOF
chmod +x /tmp/install-node-agent.sh

# Сохраняем intermediate cert
cat > /tmp/intermediate.crt <<'PEM_EOF'
${intermediate.trim()}
PEM_EOF

# Передаём всё через env + аргументы
STEP_CA_ROOT_FINGERPRINT='${fingerprint}' \\
STEP_CA_INTERMEDIATE_PEM="$(cat /tmp/intermediate.crt)" \\
  /tmp/install-node-agent.sh \\
    --server-name '${server.name}' \\
    --ca-url '${caUrlExternal}' \\
    --bootstrap-token '${bootstrapToken}' \\
    --listen 0.0.0.0:7180 \\
    --frps-server '${frps.serverAddr}' \\
    --frps-control-port '${frps.controlPort}' \\
    --frps-token '${frps.authToken}' \\
    --frps-remote-port '${server.frps_remote_port}'

# Cleanup tmp
shred -u /tmp/intermediate.crt 2>/dev/null || rm -f /tmp/intermediate.crt
rm -f /tmp/install-node-agent.sh

echo
echo "=== ${server.name} bootstrap complete ==="
echo "Verify: curl -sk https://127.0.0.1:7180/health (rejected without client cert — expected)"
echo "В админке нажмите 'Test' на странице Servers."
`;

    reply.type('text/x-shellscript').header('content-disposition', `inline; filename="install-${server.name}.sh"`);
    return script;
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

  // POST /api/servers/:name/rotate-token — выдать новый bootstrap+install токены
  fastify.post<{ Params: { name: string } }>(
    '/:name/rotate-token',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      const server = getServer(req.params.name);
      if (!isStepCaAvailable()) {
        throw new AppError('step-ca недоступен', 500);
      }
      const bootstrapToken = issueBootstrapToken(server.agent_san, 60);
      const installToken = generateInstallToken();
      await createInstallToken(server.name, installToken);

      const fingerprint = getRootFingerprint();
      const caUrlExternal = getCaUrlExternal();
      const adminUrl = process.env.ADMIN_PUBLIC_URL || 'https://admin.borisovai.ru';
      const installUrl = `${adminUrl}/api/servers/install`;
      const oneLiner = `curl -fsSL -H "Authorization: Bearer ${installToken}" ${installUrl} | sudo bash`;

      const response: CreateServerResponse = {
        server,
        bootstrap_token: bootstrapToken,
        bootstrap_command: oneLiner,
        ca_url: caUrlExternal,
        ca_root_fingerprint: fingerprint,
        intermediate_pem: getIntermediatePem(),
        install_token: installToken,
        install_url: installUrl,
      };
      return response;
    },
  );
}
