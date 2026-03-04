import axios from 'axios';
import { loadInstallConfig, buildDomainsList } from '../config/env.js';
import { execCommandSafe } from '../lib/exec.js';

/**
 * Get Umami Analytics status.
 */
export async function getAnalyticsStatus(): Promise<Record<string, unknown>> {
  const installConfig = loadInstallConfig();

  let isRunning = false;
  const result = execCommandSafe('docker ps --filter name=umami --format "{{.Names}}"');
  if (result.success) {
    isRunning = result.stdout === 'umami';
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

  return {
    installed: isRunning,
    running: healthy,
    domains,
    port: installConfig.umami_port || 3001,
    script_name: installConfig.umami_tracker_script || 'stats',
  };
}
