import { randomBytes } from 'node:crypto';

/**
 * Compact ULID-ish id: <prefix>_<12 hex>_<4 hex random>
 * Достаточно уникально для логов; не требует внешних зависимостей.
 */
export function newId(prefix: string): string {
  const ts = Date.now().toString(16).padStart(12, '0');
  const rand = randomBytes(4).toString('hex');
  return `${prefix}_${ts}${rand}`;
}
