import { eq } from 'drizzle-orm';
import { AppError, NotFoundError, ConflictError } from '@management-ui/shared';
import { getDb } from '../db/index.js';
import { autheliaUsers } from '../db/schema.js';
import {
  readAutheliaUsers,
  writeAutheliaUsers,
  hashAutheliaPassword,
  restartAuthelia,
  readUserMailboxes,
  writeUserMailboxes,
  readNotifications,
  readNotifierConfig,
  updateNotifierConfig,
  type AutheliaUserEntry,
  type ParsedNotification,
  type NotifierConfig,
  type UpdateNotifierRequest,
} from '../lib/authelia.js';
import { isAutheliaGitOps } from '../config/env.js';
import { commitConfigChange, pushConfigChanges } from '../lib/gitops.js';
import { sanitizeString, isValidAutheliaUsername } from '../lib/sanitize.js';
import { syncMailuMailboxes, isMailuConfigured } from '../lib/mailu-api.js';
import { syncUmamiUsers, isUmamiConfigured } from '../lib/umami-api.js';
import { logger } from '../lib/logger.js';

export interface UserListItem {
  username: string;
  displayname: string;
  email: string;
  externalEmail: string;
  mailbox: string;
  groups: string[];
  disabled: boolean;
  authPolicy: 'one_factor' | 'two_factor';
}

/**
 * List all users from the DB (staging layer).
 */
export async function listUsers(): Promise<UserListItem[]> {
  const db = getDb();
  const rows = await db.select().from(autheliaUsers);
  return rows.map(r => ({
    username: r.username,
    displayname: r.displayname,
    email: r.email,
    externalEmail: r.externalEmail || '',
    mailbox: r.mailbox || `${r.username}@borisovai.ru`,
    groups: JSON.parse(r.groups || '[]'),
    disabled: r.disabled,
    authPolicy: (r.authPolicy as 'one_factor' | 'two_factor') || 'two_factor',
  }));
}

/**
 * Create a user in the DB (staging — not applied to Authelia yet).
 */
export async function createUser(params: {
  username: string;
  password: string;
  displayname?: string;
  email?: string;
  externalEmail?: string;
  groups?: string[];
  authPolicy?: 'one_factor' | 'two_factor';
  mailbox?: string;
}): Promise<void> {
  const username = sanitizeString(params.username);
  if (!isValidAutheliaUsername(username)) {
    throw new AppError('Недопустимое имя пользователя (a-z, 0-9, ._- до 64 символов)');
  }
  if (!params.password || params.password.length < 8) {
    throw new AppError('Пароль должен быть не менее 8 символов');
  }

  const db = getDb();
  const existing = await db.select().from(autheliaUsers).where(eq(autheliaUsers.username, username));
  if (existing.length > 0) {
    throw new ConflictError(`Пользователь "${username}" уже существует`);
  }

  const passwordHash = await hashAutheliaPassword(params.password);
  const now = new Date().toISOString();

  await db.insert(autheliaUsers).values({
    username,
    displayname: sanitizeString(params.displayname) || username,
    email: sanitizeString(params.email) || '',
    externalEmail: sanitizeString(params.externalEmail) || null,
    passwordHash,
    groups: JSON.stringify(Array.isArray(params.groups) ? params.groups.map(sanitizeString).filter(Boolean) : []),
    disabled: false,
    authPolicy: params.authPolicy || 'two_factor',
    mailbox: sanitizeString(params.mailbox) || null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Update a user in the DB (staging — not applied to Authelia yet).
 */
export async function updateUser(
  username: string,
  params: { displayname?: string; email?: string; externalEmail?: string; groups?: string[]; disabled?: boolean; authPolicy?: 'one_factor' | 'two_factor'; mailbox?: string },
): Promise<void> {
  const db = getDb();
  const existing = await db.select().from(autheliaUsers).where(eq(autheliaUsers.username, username));
  if (existing.length === 0) {
    throw new NotFoundError(`Пользователь "${username}" не найден`);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (params.displayname !== undefined) updates.displayname = sanitizeString(params.displayname);
  if (params.email !== undefined) updates.email = sanitizeString(params.email);
  if (params.groups !== undefined) {
    updates.groups = JSON.stringify(Array.isArray(params.groups) ? params.groups.map(sanitizeString).filter(Boolean) : []);
  }
  if (params.externalEmail !== undefined) updates.externalEmail = sanitizeString(params.externalEmail) || null;
  if (params.disabled !== undefined) updates.disabled = !!params.disabled;
  if (params.authPolicy !== undefined) updates.authPolicy = params.authPolicy;
  if (params.mailbox !== undefined) updates.mailbox = sanitizeString(params.mailbox) || null;

  await db.update(autheliaUsers).set(updates).where(eq(autheliaUsers.username, username));
}

/**
 * Change a user's password in the DB (staging — not applied to Authelia yet).
 */
export async function changePassword(username: string, password: string): Promise<void> {
  if (!password || password.length < 8) {
    throw new AppError('Пароль должен быть не менее 8 символов');
  }
  const db = getDb();
  const existing = await db.select().from(autheliaUsers).where(eq(autheliaUsers.username, username));
  if (existing.length === 0) {
    throw new NotFoundError(`Пользователь "${username}" не найден`);
  }
  const passwordHash = await hashAutheliaPassword(password);
  await db.update(autheliaUsers)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(eq(autheliaUsers.username, username));
}

/**
 * Delete a user from the DB (staging — not applied to Authelia yet).
 */
export async function deleteUser(username: string): Promise<void> {
  const db = getDb();
  const existing = await db.select().from(autheliaUsers).where(eq(autheliaUsers.username, username));
  if (existing.length === 0) {
    throw new NotFoundError(`Пользователь "${username}" не найден`);
  }

  const isAdmin = JSON.parse(existing[0].groups || '[]').includes('admins');
  if (isAdmin) {
    const all = await db.select().from(autheliaUsers);
    const otherAdmins = all.filter(
      u => u.username !== username && JSON.parse(u.groups || '[]').includes('admins') && !u.disabled,
    );
    if (otherAdmins.length === 0) {
      throw new AppError('Нельзя удалить последнего активного администратора');
    }
  }

  await db.delete(autheliaUsers).where(eq(autheliaUsers.username, username));
}

/**
 * Apply: write all users from DB to Authelia config (users_database.yml + mailboxes.json).
 * Then restart Authelia (or no-op in GitOps mode — CI does it).
 */
export async function applyToConfig(): Promise<{ applied: number }> {
  const db = getDb();
  const rows = await db.select().from(autheliaUsers);

  const users: Record<string, AutheliaUserEntry> = {};
  const mailboxes: Record<string, string> = {};

  for (const r of rows) {
    // Если задан внешний email — Authelia шлёт TOTP-ссылку на него
    const autheliaEmail = r.externalEmail || r.email;
    users[r.username] = {
      disabled: r.disabled,
      displayname: r.displayname,
      email: autheliaEmail,
      password: r.passwordHash,
      groups: JSON.parse(r.groups || '[]'),
    };
    const mailbox = r.mailbox;
    if (mailbox && mailbox !== `${r.username}@borisovai.ru`) {
      mailboxes[r.username] = mailbox;
    }
  }

  const usersPath = writeAutheliaUsers(users);
  const mailboxesPath = writeUserMailboxes(mailboxes);

  if (isAutheliaGitOps()) {
    // GitOps: commit + push changes to config repo
    await commitConfigChange(
      [usersPath, mailboxesPath],
      `authelia: update ${rows.length} user(s)`,
    );
    await pushConfigChanges(usersPath);
  } else {
    restartAuthelia();
  }

  // Sync users to downstream services (non-critical — Apply succeeds even if sync fails)
  const userList = rows.map(r => ({
    username: r.username,
    displayname: r.displayname,
    disabled: r.disabled,
    groups: JSON.parse(r.groups || '[]') as string[],
  }));

  // Mailu: create/update mailboxes
  if (isMailuConfigured()) {
    try {
      await syncMailuMailboxes(userList);
    } catch (err) {
      logger.warn(`Mailu sync failed (non-critical): ${err}`);
    }
  }

  // Umami Analytics: create user accounts
  if (isUmamiConfigured()) {
    try {
      await syncUmamiUsers(userList);
    } catch (err) {
      logger.warn(`Umami sync failed (non-critical): ${err}`);
    }
  }

  return { applied: rows.length };
}

/**
 * Sync: import users from Authelia config (users_database.yml) into DB.
 * Used for initial import or re-sync.
 */
export async function syncFromConfig(): Promise<{ imported: number }> {
  const configUsers = readAutheliaUsers();
  const configMailboxes = readUserMailboxes();
  const db = getDb();

  let imported = 0;
  const now = new Date().toISOString();

  for (const [username, data] of Object.entries(configUsers)) {
    const existing = await db.select().from(autheliaUsers).where(eq(autheliaUsers.username, username));
    if (existing.length === 0) {
      await db.insert(autheliaUsers).values({
        username,
        displayname: data.displayname || username,
        email: data.email || '',
        passwordHash: data.password,
        groups: JSON.stringify(data.groups || []),
        disabled: !!data.disabled,
        authPolicy: 'two_factor',
        mailbox: configMailboxes[username] || null,
        createdAt: now,
        updatedAt: now,
      });
      imported++;
    } else {
      // Preserve externalEmail and authPolicy from DB (not in Authelia config)
      await db.update(autheliaUsers).set({
        displayname: data.displayname || username,
        email: data.email || '',
        passwordHash: data.password,
        groups: JSON.stringify(data.groups || []),
        disabled: !!data.disabled,
        mailbox: configMailboxes[username] || null,
        updatedAt: now,
      }).where(eq(autheliaUsers.username, username));
    }
  }

  return { imported };
}

/**
 * Get Authelia notifications.
 */
export function getNotifications(): ParsedNotification[] {
  return readNotifications();
}

/**
 * Get Authelia notifier config.
 */
export function getNotifier(): NotifierConfig | null {
  return readNotifierConfig();
}

/**
 * Update Authelia notifier config.
 */
export function updateNotifier(req: UpdateNotifierRequest): void {
  updateNotifierConfig(req);
  restartAuthelia();
}
