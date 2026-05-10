import { readFileSync } from 'node:fs';

export interface AgentConfig {
  server_name: string;
  listen: string;
  tls: {
    cert: string;
    key: string;
    ca: string;
    require_client_cert: boolean;
    allowed_client_sans: string[];
  };
  config_repo_dir: string;
  enabled_checkers: string[];
  log_level: string;
}

const DEFAULT_CONFIG_PATH = process.env.NODE_AGENT_CONFIG || '/etc/node-agent/config.json';

export function loadConfig(path = DEFAULT_CONFIG_PATH): AgentConfig {
  const raw = readFileSync(path, 'utf-8');
  const cfg = JSON.parse(raw) as AgentConfig;

  if (!cfg.server_name) throw new Error('config.server_name is required');
  if (!cfg.listen) throw new Error('config.listen is required');
  if (!cfg.tls?.cert || !cfg.tls?.key || !cfg.tls?.ca) {
    throw new Error('config.tls.{cert,key,ca} all required');
  }
  if (!Array.isArray(cfg.tls.allowed_client_sans)) {
    throw new Error('config.tls.allowed_client_sans must be array');
  }

  cfg.enabled_checkers = cfg.enabled_checkers || [];
  cfg.log_level = cfg.log_level || 'info';
  cfg.tls.require_client_cert = cfg.tls.require_client_cert !== false;

  return cfg;
}
