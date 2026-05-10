import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  PATHS,
} from '@management-ui/shared';
import type { ServerRecord, CreateServerRequest, UpdateServerRequest } from '@management-ui/shared';

const SERVERS_FILE = PATHS.SERVERS_FILE;
const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

let cache: ServerRecord[] | null = null;

function readFile(): ServerRecord[] {
  if (cache) return cache;
  if (!existsSync(SERVERS_FILE)) {
    cache = [];
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(SERVERS_FILE, 'utf-8')) as ServerRecord[];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function writeFile(servers: ServerRecord[]): void {
  const dir = dirname(SERVERS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2), 'utf-8');
  cache = servers;
}

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new ValidationError(`Невалидное имя сервера: ${name} (требуется ^[a-z][a-z0-9-]{0,63}$)`);
  }
}

export function listServers(): ServerRecord[] {
  return [...readFile()];
}

export function getServer(name: string): ServerRecord {
  const s = readFile().find((x) => x.name === name);
  if (!s) throw new NotFoundError(`Сервер не найден: ${name}`);
  return s;
}

export function getEnabledServers(): ServerRecord[] {
  return readFile().filter((s) => s.enabled);
}

export function createServer(req: CreateServerRequest): ServerRecord {
  validateName(req.name);
  if (!req.ssh_host) throw new ValidationError('ssh_host обязателен');
  if (!req.agent_url) throw new ValidationError('agent_url обязателен');
  if (!req.agent_san) throw new ValidationError('agent_san обязателен');
  if (req.role !== 'primary' && req.role !== 'secondary') {
    throw new ValidationError('role должен быть primary или secondary');
  }

  const list = readFile();
  if (list.some((s) => s.name === req.name)) {
    throw new ConflictError(`Сервер уже существует: ${req.name}`);
  }
  // Только один primary
  if (req.role === 'primary' && list.some((s) => s.role === 'primary')) {
    throw new ConflictError('Уже есть primary-сервер');
  }

  const now = new Date().toISOString();
  const record: ServerRecord = {
    name: req.name,
    role: req.role,
    ssh_host: req.ssh_host,
    agent_url: req.agent_url,
    agent_san: req.agent_san,
    base_domains: req.base_domains ?? [],
    config_dir: req.config_dir || `servers/${req.name}`,
    enabled: true,
    tags: req.tags ?? [],
    created_at: now,
    updated_at: now,
  };

  writeFile([...list, record]);
  return record;
}

export function updateServer(name: string, req: UpdateServerRequest): ServerRecord {
  const list = readFile();
  const idx = list.findIndex((s) => s.name === name);
  if (idx < 0) throw new NotFoundError(`Сервер не найден: ${name}`);

  const updated: ServerRecord = {
    ...list[idx],
    ...req,
    name: list[idx].name, // имя неизменно
    updated_at: new Date().toISOString(),
  };

  if (updated.role === 'primary') {
    const otherPrimary = list.find((s, i) => i !== idx && s.role === 'primary');
    if (otherPrimary) throw new ConflictError(`Уже есть primary: ${otherPrimary.name}`);
  }

  list[idx] = updated;
  writeFile(list);
  return updated;
}

export function deleteServer(name: string): void {
  const list = readFile();
  const idx = list.findIndex((s) => s.name === name);
  if (idx < 0) throw new NotFoundError(`Сервер не найден: ${name}`);
  if (list[idx].role === 'primary') {
    throw new AppError('Нельзя удалить primary-сервер', 400);
  }
  writeFile(list.filter((_, i) => i !== idx));
}

/**
 * Сидинг реестра: при первом запуске на primary, если servers.json пуст,
 * автоматически добавляем сам primary как контейнер для node-agent на 127.0.0.1.
 */
export function seedPrimaryIfEmpty(opts: {
  name: string;
  ssh_host: string;
  base_domains: string[];
}): void {
  if (readFile().length > 0) return;
  const now = new Date().toISOString();
  const record: ServerRecord = {
    name: opts.name,
    role: 'primary',
    ssh_host: opts.ssh_host,
    agent_url: 'https://127.0.0.1:7180',
    agent_san: `agent-${opts.name}.internal`,
    base_domains: opts.base_domains,
    config_dir: `servers/${opts.name}`,
    enabled: true,
    tags: ['primary', 'auto-seeded'],
    created_at: now,
    updated_at: now,
  };
  writeFile([record]);
}
