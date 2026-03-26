import axios from 'axios';
import { execCommandSafe } from '../lib/exec.js';
import type { CasdoorStatus } from '@management-ui/shared';

const CASDOOR_PORT = 8121;
const CASDOOR_DOMAIN = 'auth.trendominus.ru';

export async function getCasdoorStatus(): Promise<CasdoorStatus> {
  let isRunning = false;
  const result = execCommandSafe('docker ps --filter name=casdoor --format "{{.Names}}"');
  if (result.success) {
    isRunning = result.stdout.trim().includes('casdoor');
  }

  let healthy = false;
  if (isRunning) {
    try {
      const response = await axios.get(`http://127.0.0.1:${CASDOOR_PORT}/`, { timeout: 3000 });
      healthy = response.status === 200;
    } catch {
      healthy = false;
    }
  }

  const status = healthy ? 'running' : isRunning ? 'degraded' : 'stopped';

  return {
    status,
    installed: isRunning,
    running: healthy,
    domain: CASDOOR_DOMAIN,
    port: CASDOOR_PORT,
  };
}
