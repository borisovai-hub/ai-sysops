import type { FastifyInstance } from 'fastify';
import {
  monitoringService,
  monitoringEmitter,
  loadMonitoringConfig,
  saveMonitoringConfig,
} from '../services/monitoring.service.js';
import * as alertService from '../services/alert.service.js';

export async function monitoringRoutes(fastify: FastifyInstance) {
  // GET /config
  fastify.get('/config', { preHandler: [fastify.requireAuth] }, async () => {
    return await loadMonitoringConfig();
  });

  // PUT /config
  fastify.put('/config', { preHandler: [fastify.requireAuth] }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const current = await loadMonitoringConfig();
    const updated = { ...current, ...body } as typeof current;
    await saveMonitoringConfig(updated);
    await monitoringService.reconfigure(updated);
    return { success: true, config: updated };
  });

  // GET /status
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    const config = await loadMonitoringConfig();
    if (!config.enabled) {
      return { enabled: false, services: {}, activeAlerts: 0, overallUptime: 0 };
    }
    const services = await monitoringService.getLatestStatuses();
    const alertStats = await alertService.getAlertStats();
    return {
      enabled: true,
      services,
      activeAlerts: alertStats.active,
      overallUptime: await monitoringService.getOverallUptime(1),
    };
  });

  // GET /status/:name
  fastify.get('/status/:name', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { name } = req.params as { name: string };
    const history = await monitoringService.getServiceHistory(name, 24);
    const stats = await monitoringService.getUptimeStats(name, 7);
    return { history, stats };
  });

  // GET /uptime
  fastify.get('/uptime', { preHandler: [fastify.requireAuth] }, async (req) => {
    const query = req.query as { days?: string };
    const days = parseInt(query.days || '7', 10);
    return { stats: await monitoringService.getAllUptimeStats(days) };
  });

  // POST /check
  fastify.post('/check', { preHandler: [fastify.requireAuth] }, async () => {
    await monitoringService.runAllChecks();
    return { success: true };
  });

  // POST /check/:name
  fastify.post('/check/:name', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { name } = req.params as { name: string };
    const result = await monitoringService.runSingleCheck(name);
    return { success: true, result };
  });

  // GET /alerts
  fastify.get('/alerts', { preHandler: [fastify.requireAuth] }, async (req) => {
    const query = req.query as { status?: string; severity?: string; limit?: string };
    return {
      alerts: await alertService.getAlerts({
        status: query.status,
        severity: query.severity,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      }),
    };
  });

  // POST /alerts/:id/ack
  fastify.post('/alerts/:id/ack', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const user = (req as any).authUser || 'system';
    const alert = await alertService.acknowledgeAlert(parseInt(id, 10), user);
    return { success: true, alert };
  });

  // POST /alerts/:id/resolve
  fastify.post('/alerts/:id/resolve', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const alert = await alertService.resolveAlert(parseInt(id, 10));
    return { success: true, alert };
  });

  // GET /sse
  fastify.get('/sse', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const config = await loadMonitoringConfig();
    if (!config.sse.enabled) {
      return reply.status(400).send({ error: 'SSE disabled' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial status
    const statuses = await monitoringService.getLatestStatuses();
    send({ type: 'status_update', services: statuses });

    // Subscribe
    const onStatusChange = (event: unknown) => send({ type: 'status_change', ...(event as Record<string, unknown>) });
    const onAlert = (alert: unknown) => send({ type: 'new_alert', alert });

    monitoringEmitter.on('status_change', onStatusChange);
    monitoringEmitter.on('alert', onAlert);

    // Heartbeat
    const heartbeat = setInterval(() => {
      send({ type: 'heartbeat', timestamp: new Date().toISOString() });
    }, 30000);

    req.raw.on('close', () => {
      monitoringEmitter.off('status_change', onStatusChange);
      monitoringEmitter.off('alert', onAlert);
      clearInterval(heartbeat);
    });
  });
}
