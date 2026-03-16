import axios from 'axios';
import { loadInstallConfig, buildDomainsList } from '../config/env.js';
import { execCommandSafe } from '../lib/exec.js';
import { getUserAuthToken, ensureUmamiUser } from '../lib/umami-api.js';

/**
 * Login to Umami and return auth token (for SSO bridge).
 * Ensures the user exists in Umami before returning the token.
 */
export async function getUmamiAuthToken(username?: string): Promise<string> {
  if (username) {
    return getUserAuthToken(username);
  }
  // Fallback: admin token
  const installConfig = loadInstallConfig();
  const umamiPort = installConfig.umami_port || 3001;
  const umamiPassword = (installConfig as Record<string, unknown>).umami_admin_password as string || 'umami';

  const resp = await axios.post(`http://127.0.0.1:${umamiPort}/api/auth/login`, {
    username: 'admin',
    password: umamiPassword,
  }, { timeout: 5000 });

  const token = resp.data?.token;
  if (!token) {
    throw new Error('Umami auth token not received');
  }
  return token as string;
}

/**
 * Get Umami Analytics status.
 */
export async function getAnalyticsStatus(): Promise<Record<string, unknown>> {
  const installConfig = loadInstallConfig();

  let isRunning = false;
  const result = execCommandSafe('docker ps --filter name=umami --format "{{.Names}}"');
  if (result.success) {
    isRunning = result.stdout.trim().includes('umami');
  }

  let healthy = false;
  if (isRunning) {
    try {
      const response = await axios.get('http://127.0.0.1:3001/api/heartbeat', { timeout: 3000 });
      healthy = response.status === 200;
    } catch {
      healthy = false;
    }
  }

  const prefix = installConfig.analytics_prefix || 'analytics';
  const middle = installConfig.analytics_middle || 'dev';
  const fullPrefix = `${prefix}.${middle}`;
  const domains = buildDomainsList(fullPrefix);

  // status field for frontend compatibility (expects 'running' | 'stopped')
  const status = healthy ? 'running' : isRunning ? 'degraded' : 'stopped';

  return {
    status,
    installed: isRunning,
    running: healthy,
    domains,
    port: installConfig.umami_port || 3001,
    script_name: installConfig.umami_tracker_script || 'stats',
  };
}
