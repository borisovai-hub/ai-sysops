import { getBaseDomains } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { ensureAccessControl, removeAccessControl } from '../../../lib/authelia.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

/**
 * Authelia tool: обновление access_control для нового сервиса.
 * Правило 6 точек (см. AGENT_PUBLISH.md):
 *   1. Traefik router middleware (делает traefikTool).
 *   2. access_control в /etc/authelia/configuration.yml (этот tool).
 *   3-6. install/deploy-скрипты — статичные, обновляются через CI.
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
        detail: `Plan: ensure access_control for ${domains.join(', ')} policy=${policy}`,
        after: { domains, policy },
      };
    }

    try {
      const result = ensureAccessControl(domains, policy);
      return {
        status: 'ok',
        detail: `access_control: +${result.added.length} added, ${result.alreadyPresent.length} already present`,
        after: { domains, policy, added: result.added, alreadyPresent: result.alreadyPresent },
      };
    } catch (err) {
      logger.warn('authelia ensureAccessControl failed:', (err as Error).message);
      return { status: 'error', error: (err as Error).message };
    }
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    if (ctx.dryRun) return { status: 'ok', detail: 'plan remove authelia rule' };
    const after = stepState.after as { domains?: string[]; added?: string[] } | undefined;
    // Удаляем только те что сами добавили (after.added), не трогая существовавшие
    const toRemove = after?.added ?? [];
    if (toRemove.length === 0) return { status: 'skipped', detail: 'nothing to remove' };
    try {
      const r = removeAccessControl(toRemove);
      return { status: 'ok', detail: `access_control: -${r.removed.length} removed` };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
