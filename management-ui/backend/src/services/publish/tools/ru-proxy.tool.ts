import { getBaseDomains } from '../../../config/env.js';
import * as ruProxyService from '../../ru-proxy.service.js';
import { logger } from '../../../lib/logger.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

export const ruProxyTool: PublishTool = {
  kind: 'ru_proxy',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    if (!payload.ruProxy?.enabled) {
      return { status: 'skipped', detail: 'ruProxy disabled' };
    }
    const baseDomains = getBaseDomains();
    const ruDomain = baseDomains.find(d => d.endsWith('.ru'));
    if (!ruDomain) {
      return { status: 'skipped', detail: 'no .ru base_domain configured' };
    }
    const sub = payload.domain.middle
      ? `${payload.domain.prefix}.${payload.domain.middle}`
      : payload.domain.prefix;
    const ruHost = `${sub}.${ruDomain}`;
    // Backend — соответствующий .tech (напрямую в Contabo через Traefik).
    const techDomain = baseDomains.find(d => d.endsWith('.tech')) || baseDomains[0];
    const backendScheme = payload.ruProxy.backendScheme || 'https';
    const backendUrl = `${backendScheme}://${sub}.${techDomain}`;

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: RU Proxy ${ruHost} → ${backendUrl}`,
        after: { ruHost, backendUrl },
      };
    }

    try {
      const result = await ruProxyService.addDomain(ruHost, backendUrl);
      return {
        status: 'ok',
        detail: `RU Proxy ${ruHost} → ${backendUrl} (${result.gitops ? 'gitops' : 'direct'})`,
        after: { ruHost, backendUrl, gitops: !!result.gitops },
      };
    } catch (err) {
      logger.warn('ru-proxy addDomain failed:', (err as Error).message);
      return { status: 'error', error: (err as Error).message };
    }
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    const after = stepState.after as { ruHost?: string } | undefined;
    if (!after?.ruHost) return { status: 'skipped', detail: 'no ru-proxy domain to rollback' };
    if (ctx.dryRun) return { status: 'ok', detail: `plan remove RU Proxy ${after.ruHost}` };
    try {
      if (typeof (ruProxyService as { deleteDomain?: (d: string) => Promise<unknown> }).deleteDomain === 'function') {
        await (ruProxyService as { deleteDomain: (d: string) => Promise<unknown> }).deleteDomain(after.ruHost);
        return { status: 'ok', detail: `RU Proxy ${after.ruHost} removed` };
      }
      return { status: 'skipped', detail: 'ruProxyService.deleteDomain not available' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
