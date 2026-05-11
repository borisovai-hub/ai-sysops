import { randomBytes } from 'node:crypto';
import { eq, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { authTokens } from '../db/schema.js';
import { hashToken } from '../plugins/auth.js';
import { TOKEN_LENGTH, TOKEN_ID_LENGTH } from '@management-ui/shared';
import { ConflictError } from '@management-ui/shared';
import type { AuthToken, CreateTokenResponse } from '@management-ui/shared';

function generateId(): string {
  return randomBytes(TOKEN_ID_LENGTH / 2).toString('hex');
}

function generateToken(): string {
  return randomBytes(TOKEN_LENGTH / 2).toString('hex');
}

export async function listTokens(): Promise<AuthToken[]> {
  const db = getDb();
  const rows = await db.select({
    id: authTokens.id,
    name: authTokens.name,
    tokenPrefix: authTokens.tokenPrefix,
    createdAt: authTokens.createdAt,
  }).from(authTokens);
  return rows;
}

export async function createToken(name: string): Promise<CreateTokenResponse> {
  const db = getDb();

  // Check unique name
  const existing = await db.select().from(authTokens).where(eq(authTokens.name, name));
  if (existing.length > 0) {
    throw new ConflictError(`Токен с именем "${name}" уже существует`);
  }

  const id = generateId();
  const token = generateToken();
  const now = new Date().toISOString();

  await db.insert(authTokens).values({
    id,
    name,
    tokenHash: hashToken(token),
    tokenPrefix: token.substring(0, 8),
    createdAt: now,
  });

  return { id, name, token, createdAt: now };
}

/**
 * Регистрирует одноразовый install-токен в auth_tokens с заданным scope.
 * Используется для bootstrap нового сервера: токен живёт ~1ч, потом
 * можно удалить через cleanup или deleteToken после первого использования.
 */
export async function createInstallToken(serverName: string, token: string): Promise<void> {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(authTokens).values({
    id,
    name: `install-${serverName}-${id}`,
    tokenHash: hashToken(token),
    tokenPrefix: token.substring(0, 8),
    createdAt: now,
    scopes: JSON.stringify([`install:${serverName}`]),
  });
}

export async function deleteToken(id: string): Promise<boolean> {
  const db = getDb();
  // Check existence first (libsql doesn't return changes count via drizzle)
  const existing = await db.select({ id: authTokens.id }).from(authTokens).where(eq(authTokens.id, id));
  if (existing.length === 0) return false;
  await db.delete(authTokens).where(eq(authTokens.id, id));
  return true;
}

export async function getTokenCount(): Promise<number> {
  const db = getDb();
  const [result] = await db.select({ total: count() }).from(authTokens);
  return result?.total ?? 0;
}
