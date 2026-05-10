import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { TLSSocket, PeerCertificate } from 'node:tls';
import { loadConfig } from './config.js';
import { runAllChecks, runCheck, CHECKERS } from './checkers.js';
import { audit, hashBody } from './audit.js';

const VERSION = '0.1.0';
const STARTED_AT = Date.now();

function getClientSan(req: FastifyRequest): string | null {
  const sock = req.socket as TLSSocket;
  if (!sock || typeof sock.getPeerCertificate !== 'function') return null;
  const cert = sock.getPeerCertificate(true) as PeerCertificate & { subjectaltname?: string };
  if (!cert || !cert.subject) return null;
  // SAN строка в формате "DNS:foo, DNS:bar, IP Address:1.2.3.4"
  if (cert.subjectaltname) {
    const dns = cert.subjectaltname.split(',').map((s) => s.trim()).find((s) => s.startsWith('DNS:'));
    if (dns) return dns.slice(4);
  }
  const cn = cert.subject.CN;
  return typeof cn === 'string' ? cn : null;
}

function certExpiryDays(cert: string): number | null {
  try {
    // Simple parse: read cert via node-forge or openssl ext call. Skip — return null for MVP.
    // Fastify https initialised cert is the one we present, expiry tracked externally by step ca renew timer.
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const cfg = loadConfig();

  const [host, portStr] = cfg.listen.split(':');
  const port = parseInt(portStr, 10);
  if (!host || !port) throw new Error(`invalid listen address: ${cfg.listen}`);

  const fastify = Fastify({
    logger: { level: cfg.log_level },
    https: {
      cert: readFileSync(cfg.tls.cert),
      key: readFileSync(cfg.tls.key),
      ca: readFileSync(cfg.tls.ca),
      requestCert: cfg.tls.require_client_cert,
      rejectUnauthorized: cfg.tls.require_client_cert,
      minVersion: 'TLSv1.2',
    },
  });

  // Hook: проверка allowed_client_sans + audit
  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const san = getClientSan(req);
    (req as FastifyRequest & { _clientSan: string | null })._clientSan = san;

    if (cfg.tls.require_client_cert && cfg.tls.allowed_client_sans.length > 0) {
      if (!san || !cfg.tls.allowed_client_sans.includes(san)) {
        audit({
          clientSan: san,
          method: req.method,
          path: req.url,
          statusCode: 403,
        });
        await reply.code(403).send({ error: 'client SAN not in allowed_client_sans', san });
        return;
      }
    }
  });

  fastify.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      const san = (req as FastifyRequest & { _clientSan: string | null })._clientSan;
      const body = req.body ? JSON.stringify(req.body) : undefined;
      audit({
        clientSan: san,
        method: req.method,
        path: req.url,
        bodyHash: hashBody(body),
        statusCode: reply.statusCode,
      });
    }
  });

  // GET /health
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      server: cfg.server_name,
      version: VERSION,
      uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      enabled_checkers: cfg.enabled_checkers,
      cert_expiry_days: certExpiryDays(cfg.tls.cert),
    };
  });

  // GET /services/status
  fastify.get('/services/status', async () => {
    const results = await runAllChecks(cfg.enabled_checkers);
    return {
      server: cfg.server_name,
      checked_at: new Date().toISOString(),
      services: results,
    };
  });

  // GET /services/:name/status
  fastify.get<{ Params: { name: string } }>('/services/:name/status', async (req, reply) => {
    const { name } = req.params;
    if (!CHECKERS[name]) {
      return reply.code(404).send({ error: `unknown checker: ${name}` });
    }
    if (!cfg.enabled_checkers.includes(name)) {
      return reply.code(404).send({ error: `checker not enabled: ${name}` });
    }
    const result = await runCheck(name);
    return {
      server: cfg.server_name,
      service: name,
      checked_at: new Date().toISOString(),
      ...result,
    };
  });

  // GET /system/info — базовая информация об ОС и ресурсах
  fastify.get('/system/info', async () => {
    const os = await import('node:os');
    return {
      server: cfg.server_name,
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      load_avg: os.loadavg(),
      mem_total_mb: Math.round(os.totalmem() / 1024 / 1024),
      mem_free_mb: Math.round(os.freemem() / 1024 / 1024),
      uptime_seconds: Math.floor(os.uptime()),
    };
  });

  // SIGHUP → graceful reload (для cert renewal)
  process.on('SIGHUP', () => {
    fastify.log.info('SIGHUP received — exiting for systemd restart with fresh cert');
    fastify.close().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => fastify.close().then(() => process.exit(0)));
  process.on('SIGINT', () => fastify.close().then(() => process.exit(0)));

  try {
    await fastify.listen({ host, port });
    fastify.log.info(`node-agent ${VERSION} listening on https://${host}:${port} (server: ${cfg.server_name})`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
