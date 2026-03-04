import type { FastifyInstance } from 'fastify';
import { createServiceSchema, updateServiceSchema } from '@management-ui/shared';
import * as servicesService from '../services/services.service.js';

export async function servicesRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.requireAuth] }, async () => {
    const services = servicesService.listServices();
    return { services };
  });

  fastify.post('/', { preHandler: [fastify.requireAuth] }, async (req) => {
    const body = createServiceSchema.parse(req.body);
    const result = await servicesService.createService(body);
    return { success: true, message: 'Сервис создан успешно', service: result.service, gitops: result.gitops };
  });

  fastify.put('/:name', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { name } = req.params as { name: string };
    const body = updateServiceSchema.parse(req.body);
    const decodedName = decodeURIComponent(name);
    const result = servicesService.updateService(decodedName, body);
    return { success: true, message: 'Сервис обновлён', service: result.service, gitops: result.gitops };
  });

  fastify.delete('/:name', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { name } = req.params as { name: string };
    const decodedName = decodeURIComponent(name);
    const result = servicesService.deleteService(decodedName);
    return { success: true, message: 'Сервис удален', gitops: result.gitops };
  });
}
