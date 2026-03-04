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

// --- Repo root discovery ---

const CONFIG_SUBDIR = 'config/contabo-sm-139';

function findRepoDir(): string {
  if (process.env.REPO_DIR) return process.env.REPO_DIR;
  if (existsSync(PATHS.REPO_DIR)) return PATHS.REPO_DIR;
  // Dev: walk up from CWD looking for config/contabo-sm-139
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, CONFIG_SUBDIR))) return dir;
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

function repoPath(...segments: string[]): string {
  const repo = getRepoDir();
  if (!repo) return '';
  return join(repo, CONFIG_SUBDIR, ...segments);
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
  const dir = repoPath('traefik', 'dynamic');
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
  return repoPath('dns', 'records.json');
}

export function isDnsGitOps(): boolean {
  return getDnsRecordsPath() !== '';
}

// --- Authelia users ---

export function getAutheliaUsersPath(): string {
  if (process.env.AUTHELIA_GITOPS === 'false') return PATHS.AUTHELIA_USERS;
  const p = repoPath('authelia', 'users_database.yml');
  if (p) return p;
  return PATHS.AUTHELIA_USERS;
}

export function getAutheliaMailboxesPath(): string {
  if (process.env.AUTHELIA_GITOPS === 'false') return PATHS.USER_MAILBOXES;
  const p = repoPath('authelia', 'user-mailboxes.json');
  if (p) return p;
  return PATHS.USER_MAILBOXES;
}

export function isAutheliaGitOps(): boolean {
  const p = repoPath('authelia', 'users_database.yml');
  return p !== '' && getAutheliaUsersPath() === p;
}

// --- RU Proxy domains ---

export function getRuProxyDomainsPath(): string {
  if (process.env.RU_PROXY_GITOPS === 'false') return '';
  return repoPath('ru-proxy', 'domains.json');
}

export function isRuProxyGitOps(): boolean {
  return getRuProxyDomainsPath() !== '';
}
