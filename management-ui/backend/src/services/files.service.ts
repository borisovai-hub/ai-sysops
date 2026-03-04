import { readdirSync, statSync, renameSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AppError, NotFoundError, ConflictError } from '@management-ui/shared';
import axios from 'axios';
import { loadInstallConfig, buildDomainsList } from '../config/env.js';
import { safePath } from '../lib/sanitize.js';
import { execCommandSafe } from '../lib/exec.js';

const FILES_ROOT = '/srv/files';

/**
 * Get file server status (Docker container + disk info).
 */
export async function getFileStatus(): Promise<Record<string, unknown>> {
  const installConfig = loadInstallConfig();

  let isRunning = false;
  const result = execCommandSafe('docker ps --filter name=fileserver --format "{{.Names}}"');
  if (result.success) {
    isRunning = result.stdout === 'fileserver';
  }

  let healthy = false;
  if (isRunning) {
    try {
      const port = installConfig.files_port || 3002;
      const resp = await axios.get(`http://127.0.0.1:${port}/health`, { timeout: 3000 });
      healthy = resp.status === 200;
    } catch {
      healthy = false;
    }
  }

  let disk = { total: 0, used: 0, available: 0, percent: 0 };
  const dfResult = execCommandSafe(`df -B1 ${FILES_ROOT} 2>/dev/null | tail -1`);
  if (dfResult.success) {
    const parts = dfResult.stdout.split(/\s+/);
    if (parts.length >= 5) {
      disk = {
        total: parseInt(parts[1]) || 0,
        used: parseInt(parts[2]) || 0,
        available: parseInt(parts[3]) || 0,
        percent: parseInt(parts[4]) || 0,
      };
    }
  }

  const prefix = installConfig.files_prefix as string || 'files';
  const middle = installConfig.files_middle as string || 'dev';
  const domains = buildDomainsList(`${prefix}.${middle}`);

  return {
    installed: isRunning,
    running: healthy,
    domains,
    port: installConfig.files_port || 3002,
    disk,
  };
}

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

/**
 * Browse files in a directory.
 */
export function browseFiles(userPath: string): { path: string; items: FileItem[] } {
  const dirPath = safePath(FILES_ROOT, userPath || '/');
  if (!dirPath) throw new AppError('Недопустимый путь');
  if (!existsSync(dirPath)) throw new NotFoundError('Директория не найдена');

  const stat = statSync(dirPath);
  if (!stat.isDirectory()) throw new AppError('Путь не является директорией');

  const entries = readdirSync(dirPath);
  const items: FileItem[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    try {
      const fullPath = join(dirPath, name);
      const s = statSync(fullPath);
      items.push({
        name,
        type: s.isDirectory() ? 'directory' : 'file',
        size: s.isDirectory() ? 0 : s.size,
        modified: s.mtime.toISOString(),
      });
    } catch { /* skip */ }
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const relativePath = relative(FILES_ROOT, dirPath) || '/';
  return { path: '/' + relativePath.replace(/\\/g, '/').replace(/^\/$/, ''), items };
}

/**
 * Delete a file or directory.
 */
export function deleteFile(userPath: string): void {
  const targetPath = safePath(FILES_ROOT, userPath);
  if (!targetPath) throw new AppError('Недопустимый путь');
  if (targetPath === FILES_ROOT) throw new AppError('Нельзя удалить корневую директорию');
  if (!existsSync(targetPath)) throw new NotFoundError('Файл не найден');

  rmSync(targetPath, { recursive: true, force: true });
}

/**
 * Create a directory.
 */
export function createDirectory(userPath: string): void {
  const dirPath = safePath(FILES_ROOT, userPath);
  if (!dirPath) throw new AppError('Недопустимый путь');
  if (existsSync(dirPath)) throw new ConflictError('Директория уже существует');
  mkdirSync(dirPath, { recursive: true });
}

/**
 * Rename/move a file or directory.
 */
export function renameFile(from: string, to: string): void {
  const fromPath = safePath(FILES_ROOT, from);
  const toPath = safePath(FILES_ROOT, to);
  if (!fromPath || !toPath) throw new AppError('Недопустимый путь');
  if (!existsSync(fromPath)) throw new NotFoundError('Исходный файл не найден');
  if (existsSync(toPath)) throw new ConflictError('Целевой путь уже существует');
  renameSync(fromPath, toPath);
}

/**
 * Get the FILES_ROOT constant for upload handling.
 */
export function getFilesRoot(): string {
  return FILES_ROOT;
}
