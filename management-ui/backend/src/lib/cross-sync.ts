/**
 * Cross-domain session sync for Authelia.
 *
 * After login on domain A (.ru), copies the Authelia session cookie
 * to domain B (.tech) via a one-time token + redirect chain.
 * Works because Authelia uses the same session.secret for both cookie domains.
 */
import { randomBytes, createHmac } from 'node:crypto';
import { logger } from './logger.js';

// Server-side secret for signing tokens (regenerated on restart)
const SYNC_SECRET = randomBytes(32);

interface PendingSync {
  sessionCookie: string;
  targetDomain: string;
  user: string;
  expiresAt: number;
}

const pendingTokens = new Map<string, PendingSync>();

// Cleanup expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingTokens) {
    if (val.expiresAt < now) pendingTokens.delete(key);
  }
}, 30_000);

const BASE_DOMAINS = ['borisovai.ru', 'borisovai.tech'];

/** Determine which base domain the hostname belongs to */
export function getBaseDomain(hostname: string): string | null {
  for (const domain of BASE_DOMAINS) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return domain;
    }
  }
  return null;
}

/** Get the other base domain */
export function getOtherDomain(hostname: string): string | null {
  const current = getBaseDomain(hostname);
  if (!current) return null;
  return BASE_DOMAINS.find((d) => d !== current) ?? null;
}

/** Parse a specific cookie from the Cookie header */
export function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

/** Generate a one-time sync token */
export function generateSyncToken(
  sessionCookie: string,
  targetDomain: string,
  user: string,
): string {
  const token = randomBytes(32).toString('hex');
  pendingTokens.set(token, {
    sessionCookie,
    targetDomain,
    user,
    expiresAt: Date.now() + 60_000, // 60 seconds
  });
  logger.info(`[CrossSync] Token generated for ${user} → ${targetDomain}`);
  return token;
}

/** Consume and validate a one-time sync token */
export function consumeSyncToken(token: string): PendingSync | null {
  const data = pendingTokens.get(token);
  if (!data) return null;
  if (data.expiresAt < Date.now()) {
    pendingTokens.delete(token);
    return null;
  }
  pendingTokens.delete(token); // One-time use
  logger.info(`[CrossSync] Token consumed for ${data.user} → ${data.targetDomain}`);
  return data;
}
