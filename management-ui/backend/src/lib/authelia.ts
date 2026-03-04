import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import argon2 from 'argon2';
import yaml from 'yaml';
import { PATHS } from '@management-ui/shared';
import { getAutheliaUsersPath, getAutheliaMailboxesPath, isAutheliaGitOps } from '../config/env.js';
import { execCommandSafe, execFileSafe } from './exec.js';
import { logger } from './logger.js';

const AUTHELIA_BINARY = '/usr/local/bin/authelia';
const AUTHELIA_NOTIFICATIONS_FILE = '/var/lib/authelia/notifications.txt';

export interface AutheliaUserEntry {
  disabled: boolean;
  displayname: string;
  email: string;
  password: string;
  groups: string[];
}

/**
 * Read users from Authelia users_database.yml.
 * GitOps: reads from repo path. Direct: reads from /etc/authelia/.
 */
export function readAutheliaUsers(): Record<string, AutheliaUserEntry> {
  const path = getAutheliaUsersPath();
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  const data = yaml.parse(content);
  return (data && data.users) || {};
}

/**
 * Write users to Authelia users_database.yml.
 * GitOps: writes to repo (no chown/chmod). Direct: writes to /etc with permissions.
 * Returns the path written to (for commit tracking).
 */
export function writeAutheliaUsers(users: Record<string, AutheliaUserEntry>): string {
  const path = getAutheliaUsersPath();
  if (existsSync(path)) {
    copyFileSync(path, path + '.backup');
  }
  writeFileSync(path, yaml.stringify({ users }), 'utf-8');
  if (!isAutheliaGitOps()) {
    execCommandSafe(`chown authelia:authelia "${path}" && chmod 600 "${path}"`);
  }
  return path;
}

/**
 * Hash a password using Authelia's argon2 hasher.
 * Falls back to Node.js argon2 if Authelia binary is not available.
 */
export async function hashAutheliaPassword(password: string): Promise<string> {
  // Try Authelia binary first (production)
  if (existsSync(AUTHELIA_BINARY)) {
    const result = execFileSafe(AUTHELIA_BINARY, [
      'crypto', 'hash', 'generate', 'argon2', '--password', password,
    ]);
    if (result.success) {
      return result.stdout.replace(/^Digest:\s*/, '');
    }
  }
  // Fallback: Node.js argon2id (same algorithm Authelia uses)
  return await argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Restart Authelia systemd service.
 * In GitOps mode: no-op (restart happens during CI deploy).
 */
export function restartAuthelia(): void {
  if (isAutheliaGitOps()) return;
  const result = execCommandSafe('systemctl restart authelia');
  if (!result.success) {
    logger.warn('Ошибка перезапуска Authelia:', result.error);
  }
}

/**
 * Read user-mailbox mappings from JSON file.
 * GitOps: reads from repo path. Direct: reads from /etc/management-ui/.
 */
export function readUserMailboxes(): Record<string, string> {
  const path = getAutheliaMailboxesPath();
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

/**
 * Write user-mailbox mappings to JSON file.
 * Returns the path written to (for commit tracking).
 */
export function writeUserMailboxes(data: Record<string, string>): string {
  const path = getAutheliaMailboxesPath();
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  return path;
}

/**
 * Get the mailbox email for a user (defaults to username@borisovai.ru).
 */
export function getUserMailbox(username: string): string {
  const mailboxes = readUserMailboxes();
  return mailboxes[username] || `${username}@borisovai.ru`;
}

export interface ParsedNotification {
  date: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}

/**
 * Read Authelia notifications file (TOTP links, verification codes).
 */
export function readNotifications(): ParsedNotification[] {
  if (!existsSync(AUTHELIA_NOTIFICATIONS_FILE)) return [];
  const content = readFileSync(AUTHELIA_NOTIFICATIONS_FILE, 'utf-8');
  if (!content.trim()) return [];

  const blocks = content.split(/(?=^Date: )/m).filter(b => b.trim());
  return blocks.map(block => {
    const dateMatch = block.match(/^Date: (.+)$/m);
    const recipientMatch = block.match(/^Recipient: \{(.+?)\}$/m);
    const subjectMatch = block.match(/^Subject: (.+)$/m);
    const bodyStart = block.indexOf('\n', block.indexOf('Subject:'));
    const body = bodyStart > -1 ? block.slice(bodyStart + 1).trim() : '';

    let recipientEmail = '';
    let recipientName = '';
    if (recipientMatch) {
      const parts = recipientMatch[1].trim();
      const emailMatch = parts.match(/[\w.-]+@[\w.-]+/);
      if (emailMatch) {
        recipientEmail = emailMatch[0];
        recipientName = parts.replace(recipientEmail, '').trim();
      }
    }

    return {
      date: dateMatch ? dateMatch[1].trim() : '',
      recipientEmail,
      recipientName,
      subject: subjectMatch ? subjectMatch[1].trim() : '',
      body,
    };
  }).reverse();
}

export interface NotifierConfig {
  type: 'filesystem' | 'smtp';
  smtp: {
    host: string;
    port: number;
    sender: string;
    username: string;
    password: string;
    tls_skip_verify: boolean;
  };
}

/**
 * Read the notifier section from Authelia configuration.yml.
 */
export function readNotifierConfig(): NotifierConfig | null {
  if (!existsSync(PATHS.AUTHELIA_CONFIG)) return null;
  const content = readFileSync(PATHS.AUTHELIA_CONFIG, 'utf-8');
  const config = yaml.parse(content);
  const notifier = config?.notifier || {};
  const type = notifier.smtp ? 'smtp' : 'filesystem';
  const smtp = notifier.smtp || {};
  return {
    type,
    smtp: {
      host: smtp.address ? smtp.address.replace(/^(tcp|smtp|smtps):\/\//, '').replace(/:\d+$/, '') : '',
      port: smtp.address ? parseInt(smtp.address.replace(/.*:/, '')) || 587 : 587,
      sender: smtp.sender || '',
      username: smtp.username || '',
      password: smtp.password ? '********' : '',
      tls_skip_verify: !!(smtp.tls && smtp.tls.skip_verify),
    },
  };
}

export interface UpdateNotifierRequest {
  type: 'filesystem' | 'smtp';
  smtp?: {
    host: string;
    port?: number;
    sender: string;
    username?: string;
    password?: string;
    tls_skip_verify?: boolean;
  };
}

/**
 * Update the notifier section in Authelia configuration.yml using string replacement
 * to avoid breaking multiline YAML (OIDC private keys, etc.).
 */
export function updateNotifierConfig(req: UpdateNotifierRequest): void {
  if (!existsSync(PATHS.AUTHELIA_CONFIG)) {
    throw new Error('Конфигурация Authelia не найдена');
  }
  const content = readFileSync(PATHS.AUTHELIA_CONFIG, 'utf-8');

  let newBlock: string;
  if (req.type === 'filesystem') {
    newBlock = [
      'notifier:',
      '  filesystem:',
      '    filename: /var/lib/authelia/notifications.txt',
    ].join('\n');
  } else {
    const smtp = req.smtp!;
    const port = smtp.port || 25;
    const lines = [
      'notifier:',
      '  disable_startup_check: true',
      '  smtp:',
      `    address: smtp://${smtp.host}:${port}`,
      `    sender: ${smtp.sender}`,
      '    subject: "[Authelia] {title}"',
      '    disable_require_tls: true',
    ];
    if (smtp.username) {
      lines.push(`    username: ${smtp.username}`);
      if (smtp.password && smtp.password !== '********') {
        lines.push(`    password: ${smtp.password}`);
      } else {
        const parsed = yaml.parse(content);
        const oldPass = parsed?.notifier?.smtp?.password;
        if (oldPass) lines.push(`    password: ${oldPass}`);
      }
    }
    if (smtp.tls_skip_verify) {
      lines.push('    tls:');
      lines.push('      skip_verify: true');
    }
    newBlock = lines.join('\n');
  }

  const replaced = content.replace(/^notifier:\n(?:[ \t]+.*\n)*/m, newBlock + '\n');
  if (replaced === content && !content.includes('notifier:')) {
    throw new Error('Блок notifier не найден в конфигурации');
  }

  copyFileSync(PATHS.AUTHELIA_CONFIG, PATHS.AUTHELIA_CONFIG + '.backup');
  writeFileSync(PATHS.AUTHELIA_CONFIG, replaced, 'utf-8');
  execCommandSafe(`chown authelia:authelia "${PATHS.AUTHELIA_CONFIG}" && chmod 600 "${PATHS.AUTHELIA_CONFIG}"`);
}
