export interface AppConfig {
  gitlab_url: string;
  gitlab_token: string;
  strapi_url: string;
  strapi_token: string;
  base_port: number;
  runner_tag: string;
  main_site_path: string;
  deploy_base_path: string;
}

/**
 * Raw install config as stored in /etc/install-config.json.
 * base_domains is comma-separated string, use getBaseDomains() for parsed array.
 */
export interface InstallConfig {
  base_domains: string;
  prefixes?: string;
  middle?: string;
  main_port?: number;
  dns_port?: number;
  ru_proxy_api_url?: string;
  ru_proxy_api_token?: string;
  // Service-specific prefixes and ports (extensible)
  analytics_prefix?: string;
  analytics_middle?: string;
  umami_port?: number;
  umami_tracker_script?: string;
  files_prefix?: string;
  files_middle?: string;
  files_port?: number;
  mailu_api_url?: string;
  mailu_api_token?: string;
  mailu_domain?: string;
  tasks_prefix?: string;
  tasks_middle?: string;
  vikunja_port?: number;
  [key: string]: unknown;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  user: string | null;
  authMethod: string | null;
  details: string | null;
  createdAt: string;
}
