import { readFileSync, existsSync } from 'node:fs';
import axios from 'axios';

const FRP_CONFIG_FILE = '/etc/frp/frps.toml';

interface FrpsConfig {
  [key: string]: string;
}

/**
 * Read and parse frps TOML config into key-value pairs.
 */
export function readFrpsConfig(): FrpsConfig | null {
  try {
    if (!existsSync(FRP_CONFIG_FILE)) return null;
    const content = readFileSync(FRP_CONFIG_FILE, 'utf-8');
    const config: FrpsConfig = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^([a-zA-Z_.]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (match) config[match[1]] = match[2];
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * Make a request to the frps dashboard API.
 */
export async function frpsDashboardRequest(apiPath: string): Promise<unknown> {
  const cfg = readFrpsConfig();
  if (!cfg) throw new Error('frps не установлен');
  const port = cfg['webServer.port'] || '17490';
  const user = cfg['webServer.user'] || 'admin';
  const pass = cfg['webServer.password'] || '';
  const resp = await axios.get(`http://127.0.0.1:${port}${apiPath}`, {
    auth: { username: user, password: pass },
    timeout: 5000,
  });
  return resp.data;
}
