import { getBaseDomains } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

/**
 * Authelia tool: управление middleware + access_control для нового сервиса.
 *
 * Правило 6 точек (см. AGENT_PUBLISH.md):
 *   1. Traefik router middleware (делает traefikTool если authelia.enabled).
 *   2. access_control в /etc/authelia/configuration.yml.
 *   3. install-authelia.sh — *_DOMAINS env при переустановке.
 *   4. deploy-authelia.sh — _ensure_authelia_middleware.
 *   5. install-<svc>.sh — генерация Traefik YAML с authelia@file.
 *   6. deploy-<svc>.sh — аналогично.
 *
 * Из этих шести в runtime управляется только #1 (Traefik YAML через traefikTool)
 * и #2 (access_control — этот tool). Остальные — статичные скрипты, обновляются
 * через commit в config-repo или правки install-*.sh скриптов (выполняются
 * install.tool при первом развёртывании нового сервиса).
 *
 * Если authelia.enabled=false — tool пропускает шаг.
 */
export const autheliaTool: PublishTool = {
  kind: 'authelia',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    if (!payload.authelia?.enabled) {
      return { status: 'skipped', detail: 'authelia disabled' };
    }
    const baseDomains = getBaseDomains();
    const sub = payload.domain.middle
      ? `${payload.domain.prefix}.${payload.domain.middle}`
      : payload.domain.prefix;
    const domains = baseDomains.map(b => `${sub}.${b}`);
    const policy = payload.authelia.policy || 'two_factor';

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: add access_control rule for ${domains.join(', ')} policy=${policy}`,
        after: { domains, policy },
      };
    }

    // Runtime-обновление access_control: сейчас конфиг Authelia управляется
    // через install-authelia.sh и configure-traefik.sh на сервере. Реализуем
    // упрощённый путь: вызовем helper из services/users.service, если доступен;
    // иначе — предупреждение в лог и возврат skipped (не блокируем публикацию).
    try {
      // Динамически импортируем, чтобы не добавлять жёсткую зависимость при билде
      // если функция ещё не существует.
      const mod = await import('../../../lib/authelia.js').catch(() => null);
      const unknownMod = mod as unknown as { ensureAccessControl?: (d: string[], p: string) => Promise<void> } | null;
      if (unknownMod && typeof unknownMod.ensureAccessControl === 'function') {
        await unknownMod.ensureAccessControl(domains, policy);
        return { status: 'ok', detail: `access_control обновлён для ${domains.length} домен(ов)`, after: { domains, policy } };
      }
    } catch (err) {
      logger.warn('authelia ensureAccessControl failed:', (err as Error).message);
    }
    return {
      status: 'skipped',
      detail: 'access_control обновляется через install-authelia.sh (см. AGENT_PUBLISH.md правило №2)',
      after: { domains, policy, manualAction: 'run scripts/ci/deploy-authelia.sh' },
    };
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    // Rollback authelia rule — destructive, требует approval на уровне orchestrator.
    if (ctx.dryRun) return { status: 'ok', detail: 'plan remove authelia rule' };
    return {
      status: 'skipped',
      detail: 'access_control откат через ручной commit в /etc/authelia/configuration.yml',
      after: stepState.after,
    };
  },
};
