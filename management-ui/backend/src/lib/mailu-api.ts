import { loadInstallConfig } from '../config/env.js';
import { logger } from './logger.js';

const MAILU_API_TIMEOUT = 10000;

interface MailuConfig {
  url: string;
  token: string;
  domain: string;
}

interface MailuUser {
  email: string;
  enabled: boolean;
  displayed_name: string;
}

/**
 * Get Mailu API config from install-config.json.
 * Falls back to defaults for single-machine setup.
 */
export function getMailuConfig(): MailuConfig {
  const installConfig = loadInstallConfig();
  return {
    url: (installConfig.mailu_api_url || 'http://127.0.0.1:6555').replace(/\/+$/, ''),
    token: installConfig.mailu_api_token || '',
    domain: installConfig.mailu_domain || 'borisovai.ru',
  };
}

/**
 * Check if Mailu integration is configured.
 */
export function isMailuConfigured(): boolean {
  const cfg = getMailuConfig();
  return !!cfg.token;
}

async function mailuFetch(method: string, path: string, body?: unknown): Promise<Response> {
  const cfg = getMailuConfig();
  if (!cfg.token) throw new Error('Mailu API не настроен (mailu_api_token в install-config.json)');

  const resp = await fetch(`${cfg.url}/api/v1${path}`, {
    method,
    headers: {
      'Authorization': cfg.token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(MAILU_API_TIMEOUT),
  });
  return resp;
}

/**
 * Get existing Mailu user (or null if not found).
 */
export async function getMailuUser(email: string): Promise<MailuUser | null> {
  try {
    const resp = await mailuFetch('GET', `/user/${encodeURIComponent(email)}`);
    if (resp.status === 404) return null;
    if (!resp.ok) return null;
    return await resp.json() as MailuUser;
  } catch {
    return null;
  }
}

/**
 * Create a mailbox in Mailu for the given username.
 * Uses a random password — user authenticates via Authelia SSO, not Mailu directly.
 */
export async function ensureMailuMailbox(
  username: string,
  displayname: string,
  enabled: boolean,
): Promise<void> {
  const cfg = getMailuConfig();
  const email = `${username}@${cfg.domain}`;

  const existing = await getMailuUser(email);
  if (existing) {
    // Update enabled status and display name if changed
    if (existing.enabled !== enabled || existing.displayed_name !== displayname) {
      const resp = await mailuFetch('PATCH', `/user/${encodeURIComponent(email)}`, {
        enabled,
        displayed_name: displayname,
      });
      if (resp.ok) {
        logger.info(`Mailu: updated ${email} (enabled=${enabled})`);
      } else {
        logger.warn(`Mailu: failed to update ${email}: ${resp.status}`);
      }
    }
    return;
  }

  // Create new mailbox with random password (SSO auth, not password auth)
  const randomPass = crypto.randomUUID() + crypto.randomUUID();
  const resp = await mailuFetch('POST', '/user', {
    email,
    raw_password: randomPass,
    displayed_name: displayname,
    enabled,
  });

  if (resp.ok || resp.status === 409) {
    logger.info(`Mailu: mailbox ${email} created`);
  } else {
    const text = await resp.text().catch(() => '');
    logger.warn(`Mailu: failed to create ${email}: ${resp.status} ${text}`);
  }
}

/**
 * Delete a mailbox from Mailu.
 */
export async function deleteMailuMailbox(username: string): Promise<void> {
  const cfg = getMailuConfig();
  const email = `${username}@${cfg.domain}`;

  const resp = await mailuFetch('DELETE', `/user/${encodeURIComponent(email)}`);
  if (resp.ok || resp.status === 404) {
    logger.info(`Mailu: mailbox ${email} deleted`);
  } else {
    logger.warn(`Mailu: failed to delete ${email}: ${resp.status}`);
  }
}

/**
 * Sync all Mailu mailboxes with the given user list.
 * Creates missing mailboxes, updates enabled status, removes orphaned ones.
 */
export async function syncMailuMailboxes(
  users: Array<{ username: string; displayname: string; disabled: boolean }>,
): Promise<{ created: number; updated: number; deleted: number }> {
  const cfg = getMailuConfig();
  if (!cfg.token) {
    logger.debug('Mailu: API not configured, skipping sync');
    return { created: 0, updated: 0, deleted: 0 };
  }

  const stats = { created: 0, updated: 0, deleted: 0 };

  // Get existing Mailu users
  let existingEmails: Set<string>;
  try {
    const resp = await mailuFetch('GET', `/user`);
    if (!resp.ok) {
      logger.warn(`Mailu: failed to list users: ${resp.status}`);
      return stats;
    }
    const list = await resp.json() as MailuUser[];
    existingEmails = new Set(list.map(u => u.email));
  } catch (err) {
    logger.warn(`Mailu: API not available, skipping sync: ${err}`);
    return stats;
  }

  const expectedEmails = new Set(users.map(u => `${u.username}@${cfg.domain}`));

  // Create/update mailboxes for all Authelia users
  for (const user of users) {
    const email = `${user.username}@${cfg.domain}`;
    const existing = existingEmails.has(email);

    if (!existing) {
      await ensureMailuMailbox(user.username, user.displayname, !user.disabled);
      stats.created++;
    } else {
      // Check if update needed (just ensure enabled status)
      const mailu = await getMailuUser(email);
      if (mailu && (mailu.enabled !== !user.disabled || mailu.displayed_name !== user.displayname)) {
        await ensureMailuMailbox(user.username, user.displayname, !user.disabled);
        stats.updated++;
      }
    }
  }

  // Don't delete mailboxes that aren't in Authelia — they may be manual/service accounts
  // Only log orphans for awareness
  for (const email of existingEmails) {
    if (!expectedEmails.has(email)) {
      logger.debug(`Mailu: mailbox ${email} exists but not in Authelia users`);
    }
  }

  logger.info(`Mailu sync: ${stats.created} created, ${stats.updated} updated`);
  return stats;
}
