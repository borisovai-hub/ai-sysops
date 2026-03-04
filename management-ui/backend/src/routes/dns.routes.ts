import type { FastifyInstance } from 'fastify';
import { createDnsRecordSchema, updateDnsRecordSchema } from '@management-ui/shared';
import * as dnsService from '../services/dns.service.js';

export async function dnsRoutes(fastify: FastifyInstance) {
  fastify.get('/records', { preHandler: [fastify.requireAuth] }, async () => {
    return dnsService.listDnsRecords();
  });

  fastify.post('/records', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const result = dnsService.createDnsRecord(createDnsRecordSchema.parse(req.body));
    return reply.status(result.status).send({ ...(result.data as object), gitops: result.gitops });
  });

  fastify.put('/records/:id', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const result = dnsService.updateDnsRecord(id, updateDnsRecordSchema.parse(req.body));
    return { ...(result.data as object), gitops: result.gitops };
  });

  fastify.delete('/records/:id', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    const result = dnsService.deleteDnsRecordById(id);
    return { ...(result.data as object), gitops: result.gitops };
  });
}
