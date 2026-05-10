import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Whitelist сервисов которые можно перезагружать через /services/:name/reload.
// Расширяется по мере добавления чекеров на конкретный сервер.
export const RELOAD_WHITELIST = new Set([
  'traefik',
  'frps',
  'authelia',
  'vikunja',
  'umami',
  'node-agent', // self-reload (после обновления исходников)
]);

export interface SyncResult {
  before_sha: string | null;
  after_sha: string | null;
  changed_files: string[];
  output: string;
  triggered_reloads: Record<string, boolean>;
}

/**
 * git pull в config-репе. Возвращает изменения и автоматически перезагружает
 * Traefik если изменились dynamic/*.yml.
 */
export function syncConfigRepo(repoDir: string): SyncResult {
  if (!existsSync(repoDir)) {
    throw new Error(`config_repo_dir не существует: ${repoDir}`);
  }

  const before = gitHead(repoDir);
  let output = '';
  try {
    output = execFileSync('git', ['-C', repoDir, 'pull', '--ff-only'], { encoding: 'utf-8' });
  } catch (err) {
    output = `git pull failed: ${(err as Error).message}`;
    return { before_sha: before, after_sha: before, changed_files: [], output, triggered_reloads: {} };
  }

  const after = gitHead(repoDir);
  let changedFiles: string[] = [];
  if (before && after && before !== after) {
    try {
      const diff = execFileSync('git', ['-C', repoDir, 'diff', '--name-only', `${before}..${after}`], { encoding: 'utf-8' });
      changedFiles = diff.trim().split('\n').filter(Boolean);
    } catch {
      changedFiles = [];
    }
  }

  // Авто-reload по типу изменений
  const reloads: Record<string, boolean> = {};
  if (changedFiles.some((f) => f.includes('traefik/dynamic/') || f.includes('traefik/traefik.yml'))) {
    reloads.traefik = reloadService('traefik');
  }
  if (changedFiles.some((f) => f.includes('authelia/'))) {
    reloads.authelia = reloadService('authelia');
  }

  return { before_sha: before, after_sha: after, changed_files: changedFiles, output, triggered_reloads: reloads };
}

function gitHead(repoDir: string): string | null {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

/**
 * systemctl reload <name>, если есть в whitelist и юнит существует.
 */
export function reloadService(name: string): boolean {
  if (!RELOAD_WHITELIST.has(name)) {
    throw new Error(`reload запрещён для ${name} (нет в whitelist)`);
  }
  const unit = `${name}.service`;
  try {
    execFileSync('systemctl', ['reload-or-restart', unit], { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Листинг конфигов в repoDir с SHA-256 каждого файла. Только safe paths
 * (внутри repoDir).
 */
export function listConfigFiles(repoDir: string): { path: string; size: number; sha256: string }[] {
  if (!existsSync(repoDir)) return [];
  const out: { path: string; size: number; sha256: string }[] = [];
  walk(repoDir, repoDir, out);
  return out;
}

function walk(base: string, dir: string, out: { path: string; size: number; sha256: string }[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(base, full, out);
    } else if (st.isFile() && st.size < 100_000) {
      const rel = full.slice(base.length + 1).replace(/\\/g, '/');
      const sha = createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16);
      out.push({ path: rel, size: st.size, sha256: sha });
    }
  }
}
