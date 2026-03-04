import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppConfig, InstallConfig } from '@management-ui/shared';
import { PATHS, DEFAULT_PORT } from '@management-ui/shared';

function readJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- Repo root discovery (borisovai-admin) ---

function findRepoDir(): string {
  if (process.env.REPO_DIR) return process.env.REPO_DIR;
  if (existsSync(PATHS.REPO_DIR)) return PATHS.REPO_DIR;
  // Dev: walk up from CWD looking for management-ui/
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'management-ui'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

let _repoDir: string | undefined;

export function getRepoDir(): string {
  if (_repoDir === undefined) _repoDir = findRepoDir();
  return _repoDir;
}

// --- Server config dir discovery (config repo) ---

const DEFAULT_SERVER_NAME = 'contabo-sm-139';

function findServerConfigDir(): string {
  const serverName = process.env.SERVER_NAME || DEFAULT_SERVER_NAME;

  // 1. Explicit env var
  if (process.env.SERVER_CONFIG_DIR) return process.env.SERVER_CONFIG_DIR;

  // 2. Config repo on server: /opt/server-configs/servers/<name>
  const configRepoDir = process.env.CONFIG_REPO_DIR || PATHS.CONFIG_REPO_DIR;
  const configRepoPath = join(configRepoDir, 'servers', serverName);
  if (existsSync(configRepoPath)) return configRepoPath;

  // 3. Legacy: config/<name> inside borisovai-admin
  const repo = getRepoDir();
  if (repo) {
    const legacyPath = join(repo, 'config', serverName);
    if (existsSync(legacyPath)) return legacyPath;
  }

  // 4. Dev: walk up from CWD
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    // Config repo structure: servers/<name>/
    const serversPath = join(dir, 'servers', serverName);
    if (existsSync(serversPath)) return serversPath;
    // Legacy structure: config/<name>/
    const configPath = join(dir, 'config', serverName);
    if (existsSync(configPath)) return configPath;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  return '';
}

let _serverConfigDir: string | undefined;

export function getServerConfigDir(): string {
  if (_serverConfigDir === undefined) _serverConfigDir = findServerConfigDir();
  return _serverConfigDir;
}

function configPath(...segments: string[]): string {
  const dir = getServerConfigDir();
  if (!dir) return '';
  return join(dir, ...segments);
}

// --- App config ---

export function loadAppConfig(): AppConfig {
  const config = readJsonFile<AppConfig>(PATHS.CONFIG_FILE);
  if (!config) {
    return {
      gitlab_url: process.env.GITLAB_URL || '',
      gitlab_token: process.env.GITLAB_TOKEN || '',
      strapi_url: process.env.STRAPI_URL || '',
      strapi_token: process.env.STRAPI_TOKEN || '',
      base_port: process.env.BASE_PORT != null ? Number(process.env.BASE_PORT) : 4010,
      runner_tag: process.env.RUNNER_TAG || 'deploy-production',
      main_site_path: process.env.MAIN_SITE_PATH || '/var/www/borisovai-site',
      deploy_base_path: process.env.DEPLOY_BASE_PATH || '/var/www',
    };
  }
  return config;
}

export function loadInstallConfig(): InstallConfig {
  const config = readJsonFile<InstallConfig>(PATHS.INSTALL_CONFIG);
  if (!config) {
    return {
      base_domains: process.env.BASE_DOMAINS || 'borisovai.ru,borisovai.tech',
    };
  }
  return config;
}

export function getBaseDomains(): string[] {
  const installConfig = loadInstallConfig();
  return installConfig.base_domains.split(',').map(d => d.trim()).filter(Boolean);
}

export function buildDomainsList(prefix: string): string[] {
  const domains = getBaseDomains();
  if (!prefix || domains.length === 0) return domains;
  return domains.map(d => `${prefix}.${d}`);
}

export function buildDomainsString(prefix: string): string {
  return buildDomainsList(prefix).join(',');
}

export function getPort(): number {
  return Number(process.env.PORT) || DEFAULT_PORT;
}

export function getDbPath(): string {
  return process.env.DB_PATH || PATHS.DB_FILE;
}

// --- Traefik config dir ---

export function getTraefikConfigDir(): string {
  if (process.env.TRAEFIK_GITOPS === 'false') return PATHS.TRAEFIK_DYNAMIC;
  const dir = configPath('traefik', 'dynamic');
  if (dir && existsSync(dir)) return dir;
  return PATHS.TRAEFIK_DYNAMIC;
}

export function isGitOpsMode(): boolean {
  const dir = getTraefikConfigDir();
  return dir !== PATHS.TRAEFIK_DYNAMIC;
}

// --- DNS records ---

export function getDnsRecordsPath(): string {
  if (process.env.DNS_GITOPS === 'false') return '';
  return configPath('dns', 'records.json');
}

export function isDnsGitOps(): boolean {
  return getDnsRecordsPath() !== '';
}

// --- Authelia users ---

export function getAutheliaUsersPath(): string {
  if (process.env.AUTHELIA_GITOPS === 'false') return PATHS.AUTHELIA_USERS;
  const p = configPath('authelia', 'users_database.yml');
  if (p) return p;
  return PATHS.AUTHELIA_USERS;
}

export function getAutheliaMailboxesPath(): string {
  if (process.env.AUTHELIA_GITOPS === 'false') return PATHS.USER_MAILBOXES;
  const p = configPath('authelia', 'user-mailboxes.json');
  if (p) return p;
  return PATHS.USER_MAILBOXES;
}

export function isAutheliaGitOps(): boolean {
  const p = configPath('authelia', 'users_database.yml');
  return p !== '' && getAutheliaUsersPath() === p;
}

// --- RU Proxy domains ---

export function getRuProxyDomainsPath(): string {
  if (process.env.RU_PROXY_GITOPS === 'false') return '';
  return configPath('ru-proxy', 'domains.json');
}

export function isRuProxyGitOps(): boolean {
  return getRuProxyDomainsPath() !== '';
}
