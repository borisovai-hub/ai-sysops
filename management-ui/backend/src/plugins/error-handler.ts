import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '@management-ui/shared';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Ошибка валидации',
      details: error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Fastify validation errors
  if (error.validation) {
    return reply.status(400).send({
      error: 'Ошибка валидации',
      details: error.validation,
    });
  }

  // AppError hierarchy (typed statusCode)
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  // Known HTTP errors (statusCode set by Fastify)
  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500) {
    return reply.status(statusCode).send({
      error: error.message,
    });
  }

  // Unexpected 500 errors — log and return message in dev
  request.log.error(error);
  const isDev = process.env.NODE_ENV !== 'production';
  return reply.status(500).send({
    error: isDev ? error.message : 'Внутренняя ошибка сервера',
  });
}
