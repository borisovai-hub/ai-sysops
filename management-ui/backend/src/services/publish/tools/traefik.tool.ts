import { AppError } from '@management-ui/shared';
import { getBaseDomains } from '../../../config/env.js';
import {
  createTraefikConfig, deleteTraefikConfig, reloadTraefik, findServiceConfig,
} from '../../../lib/traefik.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

function buildDomainsString(prefix: string, middle?: string): string {
  const baseDomains = getBaseDomains();
  const sub = middle ? `${prefix}.${middle}` : prefix;
  return baseDomains.map(d => `${sub}.${d}`).join(',');
}

/**
 * Guard: правило Traefik должно покрывать ВСЕ base_domains.
 * Вызывается после createTraefikConfig — читает YAML и проверяет rule.
 */
function assertRuleCoversAllTlds(configPath: string): void {
  // Простая проверка — если функция buildHostRule соберёт правило из domain-string,
  // оно всегда содержит оба TLD. Это подстраховка для будущих изменений.
  const baseDomains = getBaseDomains();
  const fs = require('node:fs') as typeof import('node:fs');
  const content = fs.readFileSync(configPath, 'utf-8');
  for (const base of baseDomains) {
    if (!content.includes(`.${base}\``) && !content.includes(`.${base}"`)) {
      throw new AppError(
        `TRAEFIK_GUARD_VIOLATION: Rule в ${configPath} не содержит домен для ${base}. ` +
        `Каждый роутер обязан иметь Host для всех base_domains (${baseDomains.join(', ')}).`,
      );
    }
  }
}

export const traefikTool: PublishTool = {
  kind: 'traefik',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    if (payload.type === 'infra') {
      return { status: 'skipped', detail: 'type=infra не требует Traefik' };
    }
    const backend = payload.backend;
    // deploy/docs/product/service — все нуждаются в Traefik, но для deploy порт
    // может не быть передан (allocate позже). На данном шаге пропускаем если нет backend.
    if (!backend) {
      return { status: 'skipped', detail: 'backend port не задан — Traefik пропущен' };
    }
    const domainStr = buildDomainsString(payload.domain.prefix, payload.domain.middle);
    const authelia = payload.authelia?.enabled ?? false;

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: write /etc/traefik/dynamic/${payload.slug}.yml → rule covers ${domainStr}${authelia ? ' + authelia@file' : ''}`,
        after: { slug: payload.slug, domain: domainStr, authelia },
      };
    }

    const result = createTraefikConfig(
      payload.slug, domainStr, backend.internalIp, backend.port,
      { authelia },
    );
    assertRuleCoversAllTlds(result.configPath);
    const reload = reloadTraefik();
    return {
      status: 'ok',
      detail: `${result.detail}; reload mode: ${reload.mode}${authelia ? '; authelia@file' : ''}`,
      after: { configPath: result.configPath, domain: domainStr, authelia, reloadMode: reload.mode },
    };
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    if (ctx.dryRun) return { status: 'ok', detail: `plan delete traefik ${ctx.payload.slug}` };
    const existing = findServiceConfig(ctx.payload.slug);
    if (!existing) return { status: 'skipped', detail: 'traefik config already gone' };
    try {
      deleteTraefikConfig(ctx.payload.slug);
      reloadTraefik();
      return { status: 'ok', detail: `traefik config ${ctx.payload.slug}.yml removed` };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
