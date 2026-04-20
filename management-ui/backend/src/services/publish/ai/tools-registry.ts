import type { AgentToolDef, ApprovalTier } from '@management-ui/shared';
import { publishPayloadSchema, createReleaseRequestSchema } from '@management-ui/shared';
import * as orchestrator from '../orchestrator.js';
import * as releasesService from '../releases.js';
import { verifyBySlug } from '../verify.js';
import { listTraefikServices } from '../../../lib/traefik.js';
import { dnsApiProxy } from '../../../lib/dns-api.js';
import { gitlabApi } from '../../../lib/gitlab-api.js';
import { getBaseDomains, loadInstallConfig } from '../../../config/env.js';

// --- Approval policy ---

export type PublishApprovals = 'auto_safe' | 'manual' | 'auto_all';

/**
 * Каждый AI-tool имеет "natural" tier. Эффективный tier вычисляется в
 * зависимости от payload.approvals:
 *   auto_all  → все auto (кроме того, что tool помечен как forced manual);
 *   auto_safe → destructive/publish → approve, остальное auto;
 *   manual    → все approve (кроме read-only).
 */
interface ToolSpec {
  def: AgentToolDef;
  naturalTier: ApprovalTier;
  forcedManual?: boolean; // всегда требует approval, даже при auto_all
  execute(input: Record<string, unknown>, ctx: { runId?: string }): Promise<Record<string, unknown>>;
}

const TOOLS: Record<string, ToolSpec> = {
  // --- Read-only ---
  list_services: {
    def: {
      name: 'list_services', tier: 'auto',
      description: 'Список всех Traefik-сервисов на сервере (имя, домены, порт, authelia).',
      parameters: [],
    },
    naturalTier: 'auto',
    async execute() {
      return { services: listTraefikServices() };
    },
  },
  list_dns_records: {
    def: {
      name: 'list_dns_records', tier: 'auto',
      description: 'Список DNS-записей через локальный DNS API.',
      parameters: [],
    },
    naturalTier: 'auto',
    async execute() {
      const res = await dnsApiProxy('GET', '/api/records');
      return { records: res };
    },
  },
  get_install_config: {
    def: {
      name: 'get_install_config', tier: 'auto',
      description: 'Текущий /etc/install-config.json: base_domains и middle-сегменты.',
      parameters: [],
    },
    naturalTier: 'auto',
    async execute() {
      return { config: loadInstallConfig(), baseDomains: getBaseDomains() };
    },
  },
  get_gitlab_project: {
    def: {
      name: 'get_gitlab_project', tier: 'auto',
      description: 'Информация о GitLab-проекте по projectId или pathWithNamespace.',
      parameters: [
        { name: 'projectId', type: 'number', description: 'ID проекта в GitLab' },
        { name: 'projectPath', type: 'string', description: 'Путь вида group/name' },
      ],
    },
    naturalTier: 'auto',
    async execute(input) {
      const { projectId, projectPath } = input as { projectId?: number; projectPath?: string };
      const target = projectId ?? encodeURIComponent(String(projectPath ?? '').replace(/\\/g, '/'));
      const data = await gitlabApi('get', `/projects/${target}`);
      return { project: data };
    },
  },
  list_publish_runs: {
    def: {
      name: 'list_publish_runs', tier: 'auto',
      description: 'Последние прогоны публикации (id, slug, status).',
      parameters: [
        { name: 'slug', type: 'string', description: 'Фильтр по slug' },
        { name: 'limit', type: 'number', description: 'Кол-во записей (default 20)' },
      ],
    },
    naturalTier: 'auto',
    async execute(input) {
      return orchestrator.listRuns({
        slug: input.slug as string | undefined,
        limit: (input.limit as number | undefined) ?? 20,
      });
    },
  },
  list_releases: {
    def: {
      name: 'list_releases', tier: 'auto',
      description: 'История релизов проекта по slug.',
      parameters: [{ name: 'slug', type: 'string', description: 'Slug проекта', required: true }],
    },
    naturalTier: 'auto',
    async execute(input) {
      return releasesService.listReleases(String(input.slug));
    },
  },
  get_release: {
    def: {
      name: 'get_release', tier: 'auto',
      description: 'Детали конкретной версии релиза.',
      parameters: [
        { name: 'slug', type: 'string', description: 'Slug', required: true },
        { name: 'version', type: 'string', description: 'Версия', required: true },
      ],
    },
    naturalTier: 'auto',
    async execute(input) {
      return releasesService.getRelease(String(input.slug), String(input.version));
    },
  },

  // --- Mutation ---
  publish_dry_run: {
    def: {
      name: 'publish_dry_run', tier: 'auto',
      description: 'Построить план публикации без выполнения. Возвращает список шагов. ' +
        'Аргумент payload должен соответствовать publishPayloadSchema (см. AGENT_PUBLISH_API.md).',
      parameters: [
        { name: 'payload', type: 'object', description: 'publishPayload (type, slug, domain, ...) + dryRun=true', required: true },
      ],
    },
    naturalTier: 'auto',
    async execute(input) {
      const payload = publishPayloadSchema.parse({ ...(input.payload as object), dryRun: true });
      return orchestrator.execute(payload);
    },
  },
  publish_execute: {
    def: {
      name: 'publish_execute', tier: 'approve',
      description: 'Выполнить публикацию по payload. Изменяет инфраструктуру (DNS, Traefik, CI, ...). ' +
        'Перед вызовом обязательно publish_dry_run для получения плана.',
      parameters: [
        { name: 'payload', type: 'object', description: 'publishPayload без dryRun', required: true },
      ],
    },
    naturalTier: 'approve',
    async execute(input) {
      const payload = publishPayloadSchema.parse({ ...(input.payload as object), dryRun: false });
      return orchestrator.execute(payload);
    },
  },
  verify_deployment: {
    def: {
      name: 'verify_deployment', tier: 'auto',
      description: 'HTTPS HEAD-проверка обоих TLD + SSL + SSO-редирект для slug.',
      parameters: [{ name: 'slug', type: 'string', description: 'Slug', required: true }],
    },
    naturalTier: 'auto',
    async execute(input) {
      return verifyBySlug(String(input.slug));
    },
  },
  create_release: {
    def: {
      name: 'create_release', tier: 'approve',
      description: 'Создать релиз (версия + changelog + артефакты) для существующего проекта. ' +
        'Загружает артефакты и обновляет Strapi entry.',
      parameters: [
        { name: 'slug', type: 'string', description: 'Slug проекта', required: true },
        { name: 'request', type: 'object', description: 'createReleaseRequestSchema (release{version, artifacts...}, updateStrapi, publishToSite)', required: true },
      ],
    },
    naturalTier: 'approve',
    async execute(input) {
      const body = createReleaseRequestSchema.parse(input.request);
      return releasesService.createRelease(String(input.slug), body);
    },
  },
  publish_release_to_site: {
    def: {
      name: 'publish_release_to_site', tier: 'approve',
      description: 'Опубликовать draft-релиз на сайте (Strapi publish). Меняет публичный контент.',
      parameters: [
        { name: 'slug', type: 'string', description: 'Slug', required: true },
        { name: 'version', type: 'string', description: 'Версия', required: true },
      ],
    },
    naturalTier: 'approve',
    forcedManual: true,
    async execute(input) {
      return releasesService.patchRelease(String(input.slug), String(input.version), { action: 'publish' });
    },
  },
  unpublish_release: {
    def: {
      name: 'unpublish_release', tier: 'approve',
      description: 'Снять релиз с публикации (Strapi unpublish). Меняет публичный контент.',
      parameters: [
        { name: 'slug', type: 'string', description: 'Slug', required: true },
        { name: 'version', type: 'string', description: 'Версия', required: true },
      ],
    },
    naturalTier: 'approve',
    forcedManual: true,
    async execute(input) {
      return releasesService.patchRelease(String(input.slug), String(input.version), { action: 'unpublish' });
    },
  },
  delete_release: {
    def: {
      name: 'delete_release', tier: 'approve',
      description: 'Удалить релиз и его артефакты. DESTRUCTIVE — всегда требует approval.',
      parameters: [
        { name: 'slug', type: 'string', description: 'Slug', required: true },
        { name: 'version', type: 'string', description: 'Версия', required: true },
        { name: 'removeArtifacts', type: 'boolean', description: 'Удалить файлы из storage' },
      ],
    },
    naturalTier: 'approve',
    forcedManual: true,
    async execute(input) {
      return releasesService.deleteRelease(String(input.slug), String(input.version), {
        confirmDestructive: true,
        removeArtifacts: !!input.removeArtifacts,
      });
    },
  },
  rollback_publish: {
    def: {
      name: 'rollback_publish', tier: 'approve',
      description: 'Откат публикации по publishId. DESTRUCTIVE — всегда требует approval.',
      parameters: [
        { name: 'publishId', type: 'string', description: 'id прогона pub_...', required: true },
        { name: 'onlyKinds', type: 'array', description: 'Опциональный список шагов для отката' },
      ],
    },
    naturalTier: 'approve',
    forcedManual: true,
    async execute(input) {
      return orchestrator.rollback(String(input.publishId), {
        confirmDestructive: true,
        onlyKinds: input.onlyKinds as undefined,
      });
    },
  },
};

/**
 * Вычисляет эффективный tier инструмента с учётом политики approvals.
 */
export function effectiveTier(toolName: string, policy: PublishApprovals): ApprovalTier {
  const spec = TOOLS[toolName];
  if (!spec) return 'approve';
  if (spec.forcedManual) return 'approve';
  if (policy === 'manual') return spec.naturalTier === 'auto' ? 'auto' : 'approve';
  if (policy === 'auto_all') return 'auto';
  // auto_safe (default)
  return spec.naturalTier;
}

export function listToolDefs(): AgentToolDef[] {
  return Object.values(TOOLS).map(s => s.def);
}

export function getTool(name: string): ToolSpec | null {
  return TOOLS[name] ?? null;
}
