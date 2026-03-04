import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { renameSync, existsSync } from 'node:fs';
import { AppError, NotFoundError, deleteFileSchema, createDirSchema, renameSchema } from '@management-ui/shared';
import * as filesService from '../services/files.service.js';

export async function filesRoutes(fastify: FastifyInstance) {
  fastify.get('/status', { preHandler: [fastify.requireAuth] }, async () => {
    return await filesService.getFileStatus();
  });

  fastify.get('/browse', { preHandler: [fastify.requireAuth] }, async (req) => {
    const query = req.query as { path?: string };
    return filesService.browseFiles(query.path || '/');
  });

  fastify.post('/upload', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const data = await req.file();
    if (!data) {
      throw new AppError('Файл не получен');
    }

    const filesRoot = filesService.getFilesRoot();
    const destDir = req.query && (req.query as Record<string, unknown>).path
      ? join(filesRoot, (req.query as Record<string, unknown>).path as string)
      : filesRoot;

    if (!destDir.startsWith(filesRoot)) {
      throw new AppError('Недопустимый путь');
    }
    if (!existsSync(destDir)) {
      throw new NotFoundError('Директория не найдена');
    }

    // Stream file to destination
    const destFile = join(destDir, data.filename);
    if (!destFile.startsWith(filesRoot)) {
      throw new AppError('Недопустимое имя файла');
    }

    const { writeFileSync } = await import('node:fs');
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    writeFileSync(destFile, Buffer.concat(chunks));

    return { ok: true, name: data.filename, size: chunks.reduce((s, c) => s + c.length, 0) };
  });

  fastify.delete('/delete', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { path } = deleteFileSchema.parse(req.body);
    filesService.deleteFile(path);
    return { ok: true };
  });

  fastify.post('/mkdir', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { path } = createDirSchema.parse(req.body);
    filesService.createDirectory(path);
    return { ok: true };
  });

  fastify.post('/rename', { preHandler: [fastify.requireAuth] }, async (req) => {
    const { from, to } = renameSchema.parse(req.body);
    filesService.renameFile(from, to);
    return { ok: true };
  });
}
