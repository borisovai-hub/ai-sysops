// System paths (production server)
export const PATHS = {
  CONFIG_DIR: '/etc/management-ui',
  CONFIG_FILE: '/etc/management-ui/config.json',
  AUTH_FILE: '/etc/management-ui/auth.json',
  PROJECTS_FILE: '/etc/management-ui/projects.json',
  INSTALL_CONFIG: '/etc/install-config.json',
  DNS_CONFIG: '/etc/dns-api/config.json',
  USER_MAILBOXES: '/etc/management-ui/user-mailboxes.json',
  TRAEFIK_DYNAMIC: '/etc/traefik/dynamic',
  AUTHELIA_USERS: '/etc/authelia/users_database.yml',
  AUTHELIA_CONFIG: '/etc/authelia/configuration.yml',
  DB_DIR: '/var/lib/management-ui',
  DB_FILE: '/var/lib/management-ui/management-ui.db',
  TEMPLATES_DIR: '/opt/management-ui/templates',
  REPO_DIR: '/opt/borisovai-admin',
  TRAEFIK_REPO_DYNAMIC: '/opt/borisovai-admin/config/contabo-sm-139/traefik/dynamic',
  DNS_REPO_RECORDS: '/opt/borisovai-admin/config/contabo-sm-139/dns/records.json',
  AUTHELIA_REPO_USERS: '/opt/borisovai-admin/config/contabo-sm-139/authelia/users_database.yml',
  AUTHELIA_REPO_MAILBOXES: '/opt/borisovai-admin/config/contabo-sm-139/authelia/user-mailboxes.json',
  RU_PROXY_REPO_DOMAINS: '/opt/borisovai-admin/config/contabo-sm-139/ru-proxy/domains.json',
} as const;

// Default port
export const DEFAULT_PORT = 3000;

// DNS API
export const DNS_API_PORT = 5353;
export const DNS_API_HOST = '127.0.0.1';

// Auth
export const TOKEN_LENGTH = 64;
export const TOKEN_ID_LENGTH = 8;

// Ports
export const DEFAULT_BASE_PORT = 4010;
