import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../../lib/logger.js';

/**
 * System prompt для AI Publisher LLM = содержимое AGENT_PUBLISH.md + AGENT_PUBLISH_API.md.
 * Читается из docs/agents/ (репо проекта). Кешируется в памяти, с инвалидацией
 * по mtime файлов.
 *
 * На стороне Anthropic prompt caching включается через cache_control.
 */

interface PromptCache {
  text: string;
  loadedAt: number;
  fileMtimes: Record<string, number>;
}

let cache: PromptCache | null = null;

const PREAMBLE = `Ты — AI Publisher для инфраструктуры borisovai. Твоя задача — помогать
пользователю публиковать сервисы и проекты, обновлять релизы и артефакты,
строго следуя правилам из документации ниже.

Правила работы:
1. Отвечай по-русски, кратко, по делу.
2. Перед мутирующей операцией ВСЕГДА сначала вызывай publish_dry_run для
   получения плана. Показывай план пользователю и объясняй, что произойдёт.
3. Не выдумывай значения — читай через get_install_config, list_services,
   get_gitlab_project. Если данных не хватает — задай пользователю вопрос
   (просто отправь текст вопроса, система покажет его пользователю).
4. Правило обоих TLD (.ru + .tech), 6 точек Authelia, идемпотентность DNS,
   права Docker volume, Strapi как источник версии — всё это гарантируется
   API (guards в orchestrator). Не пытайся обходить guards.
5. Destructive операции (delete_release, rollback_publish, publish/unpublish
   release на сайте) всегда требуют явного approval пользователя.
6. Когда работа завершена — кратко отчитайся что сделано и доступно ли
   по адресам (.ru и .tech).

Ниже — полная документация правил и контракта API. Используй её как источник
истины (содержимое закешировано провайдером для скорости).`;

function resolveDocsDir(): string {
  const fromEnv = process.env.PUBLISH_DOCS_DIR;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // dev: backend/src/... → ../../docs/agents
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '..', '..', '..', 'docs', 'agents'),   // dist/src → repo root
    resolve(here, '..', '..', '..', '..', 'docs', 'agents'),         // src → repo root
    '/opt/management-ui/docs/agents',
    '/opt/borisovai-admin/docs/agents',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return here;
}

const DOC_FILES = ['AGENT_PUBLISH.md', 'AGENT_PUBLISH_API.md'];

function readDocs(): { text: string; mtimes: Record<string, number> } {
  const dir = resolveDocsDir();
  const parts: string[] = [PREAMBLE];
  const mtimes: Record<string, number> = {};
  for (const name of DOC_FILES) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      logger.warn(`AI Publisher: doc not found ${p}`);
      continue;
    }
    const st = statSync(p);
    mtimes[p] = st.mtimeMs;
    parts.push(`\n\n## ${name}\n\n` + readFileSync(p, 'utf-8'));
  }
  return { text: parts.join(''), mtimes };
}

export function getSystemPrompt(): string {
  if (cache) {
    // проверим mtime
    let changed = false;
    for (const [p, m] of Object.entries(cache.fileMtimes)) {
      if (existsSync(p) && statSync(p).mtimeMs !== m) { changed = true; break; }
    }
    if (!changed) return cache.text;
  }
  const { text, mtimes } = readDocs();
  cache = { text, loadedAt: Date.now(), fileMtimes: mtimes };
  return text;
}

export function invalidateCache(): void {
  cache = null;
}

export function getCacheInfo(): { loaded: boolean; loadedAt?: number; files: string[] } {
  return {
    loaded: !!cache,
    loadedAt: cache?.loadedAt,
    files: cache ? Object.keys(cache.fileMtimes) : [],
  };
}
