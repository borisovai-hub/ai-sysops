import axios from 'axios';
import { loadInstallConfig } from '../config/env.js';

interface RuProxyConfig {
  url: string;
  token: string;
}

/**
 * Get RU Proxy API config from install-config.json.
 */
export function getRuProxyConfig(): RuProxyConfig {
  const installConfig = loadInstallConfig();
  return {
    url: (installConfig.ru_proxy_api_url || '').replace(/\/+$/, ''),
    token: installConfig.ru_proxy_api_token || '',
  };
}

/**
 * Make a request to the RU Proxy management API.
 */
export async function ruProxyApi(method: string, apiPath: string, data?: unknown): Promise<unknown> {
  const cfg = getRuProxyConfig();
  if (!cfg.url || !cfg.token) {
    throw new Error('RU Proxy не настроен (ru_proxy_api_url, ru_proxy_api_token в install-config.json)');
  }
  const resp = await axios({
    method,
    url: `${cfg.url}${apiPath}`,
    headers: { Authorization: `Bearer ${cfg.token}` },
    data,
    timeout: 10000,
  });
  return resp.data;
}
