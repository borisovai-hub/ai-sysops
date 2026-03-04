import { resolve } from 'node:path';

/**
 * Remove \r and control characters from strings.
 */
export function sanitizeString(str: unknown): string {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/\r/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Check if a service name is safe for use as a filename (no path traversal).
 */
export function isSafeServiceName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}

/**
 * Build Traefik Host() rule from comma-separated domain string.
 * Example: "a.com,b.com" → "Host(`a.com`) || Host(`b.com`)"
 */
export function buildHostRule(domainStr: string): string {
  if (!domainStr || typeof domainStr !== 'string') return '';
  const parts = domainStr.split(',').map(s => sanitizeString(s)).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map(d => `Host(\`${d}\`)`).join(' || ');
}

/**
 * Validate Authelia username (a-z, 0-9, ._- up to 64 chars).
 */
export function isValidAutheliaUsername(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9._-]{1,64}$/.test(name);
}

/**
 * Resolve a user-provided path within a root directory.
 * Returns null if the resolved path escapes the root (path traversal protection).
 */
export function safePath(root: string, userPath: string): string | null {
  const resolved = resolve(root, userPath || '');
  if (!resolved.startsWith(root)) return null;
  return resolved;
}
