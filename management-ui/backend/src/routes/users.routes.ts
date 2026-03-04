import type { FastifyInstance } from 'fastify';
import { createUserSchema, updateUserSchema, changePasswordSchema, updateNotifierSchema } from '@management-ui/shared';
import * as usersService from '../services/users.service.js';

export async function usersRoutes(fastify: FastifyInstance) {
  fastify.get('/users', { preHandler: [fastify.requireSessionAuth] }, async () => {
    const users = await usersService.listUsers();
    return { users };
  });

  fastify.post('/users', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const body = createUserSchema.parse(req.body);
    await usersService.createUser(body);
    return { success: true, message: `Пользователь "${body.username}" создан` };
  });

  fastify.put('/users/:username', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { username } = req.params as { username: string };
    const body = updateUserSchema.parse(req.body);
    await usersService.updateUser(username, body);
    return { success: true, message: `Пользователь "${username}" обновлён` };
  });

  fastify.post('/users/:username/password', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { username } = req.params as { username: string };
    const { password } = changePasswordSchema.parse(req.body);
    await usersService.changePassword(username, password);
    return { success: true, message: `Пароль пользователя "${username}" изменён` };
  });

  fastify.delete('/users/:username', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const { username } = req.params as { username: string };
    await usersService.deleteUser(username);
    return { success: true, message: `Пользователь "${username}" удалён` };
  });

  // Apply staged users to Authelia config (users_database.yml)
  fastify.post('/users/apply', { preHandler: [fastify.requireSessionAuth] }, async () => {
    const result = await usersService.applyToConfig();
    return { success: true, message: `Применено ${result.applied} пользователей в конфиг Authelia` };
  });

  // Sync users from Authelia config into DB
  fastify.post('/users/sync', { preHandler: [fastify.requireSessionAuth] }, async () => {
    const result = await usersService.syncFromConfig();
    return { success: true, message: `Импортировано ${result.imported} пользователей из конфига`, imported: result.imported };
  });

  fastify.get('/notifications', { preHandler: [fastify.requireSessionAuth] }, async () => {
    const notifications = usersService.getNotifications();
    return { notifications };
  });

  fastify.get('/notifier', { preHandler: [fastify.requireSessionAuth] }, async (_req, reply) => {
    const config = usersService.getNotifier();
    if (!config) return reply.status(404).send({ error: 'Конфигурация Authelia не найдена' });
    return config;
  });

  fastify.put('/notifier', { preHandler: [fastify.requireSessionAuth] }, async (req) => {
    const body = updateNotifierSchema.parse(req.body);
    usersService.updateNotifier(body);
    return { success: true, message: `Notifier переключён на ${body.type}. Authelia перезапущена.` };
  });
}
