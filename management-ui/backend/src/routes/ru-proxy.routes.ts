import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { addDomainSchema, updateDomainSchema } from '@management-ui/shared';
import * as ruProxyService from '../services/ru-proxy.service.js';

export async function ruProxyRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await ruProxyService.getRuProxyStatus();
  });

  fastify.get('/domains', { preHandler: [fastify.requireAuth] }, async () => {
    return await ruProxyService.listDomains();
  });

  fastify.post('/domains', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    try {
      const { domain, backend } = addDomainSchema.parse(req.body);
      const result = await ruProxyService.addDomain(domain, backend);
      return { ...(result.data as object), gitops: result.gitops };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        return reply.status(err.response?.status || 500).send({ error: err.response?.data?.error || err.message });
      }
      throw err;
    }
  });

  fastify.put('/domains/:domain', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    try {
      const { domain } = req.params as { domain: string };
      const body = updateDomainSchema.parse(req.body);
      const result = await ruProxyService.updateDomain(domain, body);
      return { ...(result.data as object), gitops: result.gitops };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        return reply.status(err.response?.status || 500).send({ error: err.response?.data?.error || err.message });
      }
      throw err;
    }
  });

  fastify.delete('/domains/:domain', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    try {
      const { domain } = req.params as { domain: string };
      const result = await ruProxyService.deleteDomain(domain);
      return { ...(result.data as object), gitops: result.gitops };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        return reply.status(err.response?.status || 500).send({ error: err.response?.data?.error || err.message });
      }
      throw err;
    }
  });

  fastify.post('/reload', { preHandler: [fastify.requireAuth] }, async () => {
    return await ruProxyService.reloadProxy();
  });
}
