import { loadInstallConfig } from '../config/env.js';
import { logger } from './logger.js';

const UMAMI_API_TIMEOUT = 10000;

interface UmamiConfig {
  url: string;
  adminUser: string;
  adminPassword: string;
}

interface UmamiUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Get Umami config from install-config.json.
 */
export function getUmamiConfig(): UmamiConfig {
  const installConfig = loadInstallConfig();
  const port = installConfig.umami_port || 3001;
  return {
    url: `http://127.0.0.1:${port}`,
    adminUser: (installConfig as Record<string, unknown>).umami_admin_user as string || 'admin',
    adminPassword: (installConfig as Record<string, unknown>).umami_admin_password as string || 'umami',
  };
}

/**
 * Check if Umami is available.
 */
export function isUmamiConfigured(): boolean {
  const cfg = getUmamiConfig();
  return !!cfg.adminPassword;
}

/**
 * Get admin auth token (cached for 10 min).
 */
async function getAdminToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const cfg = getUmamiConfig();
  const resp = await fetch(`${cfg.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.adminUser, password: cfg.adminPassword }),
    signal: AbortSignal.timeout(UMAMI_API_TIMEOUT),
  });

  if (!resp.ok) throw new Error(`Umami auth failed: ${resp.status}`);
  const data = await resp.json() as { token: string };
  cachedToken = { token: data.token, expiresAt: Date.now() + 10 * 60 * 1000 };
  return data.token;
}

async function umamiFetch(method: string, path: string, body?: unknown): Promise<Response> {
  const cfg = getUmamiConfig();
  const token = await getAdminToken();

  return fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(UMAMI_API_TIMEOUT),
  });
}

/**
 * List all Umami users.
 */
async function listUmamiUsers(): Promise<UmamiUser[]> {
  const resp = await umamiFetch('GET', '/api/admin/users');
  if (!resp.ok) return [];
  const data = await resp.json() as { data: UmamiUser[] };
  return data.data || [];
}

/**
 * Create a user in Umami.
 * Password is random — users access via SSO bridge, not direct login.
 */
export async function ensureUmamiUser(
  username: string,
  role: 'user' | 'admin' = 'user',
): Promise<void> {
  const users = await listUmamiUsers();
  const existing = users.find(u => u.username === username);
  if (existing) return;

  const randomPass = crypto.randomUUID() + crypto.randomUUID();
  const resp = await umamiFetch('POST', '/api/users', {
    username,
    password: randomPass,
    role,
  });

  if (resp.ok) {
    logger.info(`Umami: user ${username} created (role=${role})`);
  } else if (resp.status === 409) {
    // Already exists
  } else {
    const text = await resp.text().catch(() => '');
    logger.warn(`Umami: failed to create ${username}: ${resp.status} ${text}`);
  }
}

/**
 * Delete a user from Umami.
 */
export async function deleteUmamiUser(username: string): Promise<void> {
  const users = await listUmamiUsers();
  const existing = users.find(u => u.username === username);
  if (!existing) return;

  if (existing.username === 'admin') {
    logger.debug('Umami: skipping delete of admin user');
    return;
  }

  const resp = await umamiFetch('DELETE', `/api/users/${existing.id}`);
  if (resp.ok) {
    logger.info(`Umami: user ${username} deleted`);
  } else {
    logger.warn(`Umami: failed to delete ${username}: ${resp.status}`);
  }
}

/**
 * Sync Umami users with Authelia user list.
 * Creates missing users, skips existing ones.
 */
export async function syncUmamiUsers(
  users: Array<{ username: string; groups: string[]; disabled: boolean }>,
): Promise<{ created: number }> {
  if (!isUmamiConfigured()) {
    logger.debug('Umami: not configured, skipping sync');
    return { created: 0 };
  }

  let stats = { created: 0 };

  let existingUsers: UmamiUser[];
  try {
    existingUsers = await listUmamiUsers();
  } catch (err) {
    logger.warn(`Umami: API not available, skipping sync: ${err}`);
    return stats;
  }

  const existingNames = new Set(existingUsers.map(u => u.username));

  for (const user of users) {
    if (user.disabled) continue;
    if (existingNames.has(user.username)) continue;

    const role = user.groups.includes('admins') ? 'admin' : 'user';
    await ensureUmamiUser(user.username, role);
    stats.created++;
  }

  logger.info(`Umami sync: ${stats.created} created`);
  return stats;
}

/**
 * Get auth token for a specific user (for personalized SSO bridge).
 * Falls back to admin token if user doesn't exist in Umami.
 */
export async function getUserAuthToken(username: string): Promise<string> {
  // Umami doesn't support impersonation via API.
  // We ensure user exists, then return admin token for SSO bridge.
  // The SSO bridge provides access to the dashboard.
  await ensureUmamiUser(username);
  return getAdminToken();
}
