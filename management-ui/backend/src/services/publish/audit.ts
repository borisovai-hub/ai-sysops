import type { FastifyRequest } from 'fastify';
import { getDb } from '../../db/index.js';
import { auditLog } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';

/**
 * Записать событие публикации в audit_log.
 * Не блокирует запрос: ошибки логируются как warn.
 */
export async function writePublishAudit(
  req: FastifyRequest,
  action: string,
  details: Record<string, unknown>,
  entityId?: string,
): Promise<void> {
  try {
    const user = req.tokenName
      ? `token:${req.tokenName}`
      : req.authUser
        ? `user:${req.authUser}`
        : 'anonymous';
    await getDb().insert(auditLog).values({
      action,
      entity: 'publish',
      entityId: entityId ?? null,
      user,
      authMethod: req.authMethod ?? null,
      details: JSON.stringify(details).slice(0, 8000),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn('audit log write failed:', (err as Error).message);
  }
}
