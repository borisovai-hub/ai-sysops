import { AppError } from '@management-ui/shared';
import { getBaseDomains } from '../../../config/env.js';
import { getExternalIp, createDnsRecordsForAllDomains, deleteDnsRecord } from '../../../lib/dns-api.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

export const dnsTool: PublishTool = {
  kind: 'dns',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    const prefix = payload.domain.prefix;
    const middle = payload.domain.middle;
    const subdomain = middle ? `${prefix}.${middle}` : prefix;
    const baseDomains = getBaseDomains();
    if (baseDomains.length === 0) {
      throw new AppError('DNS guard: base_domains пуст в /etc/install-config.json');
    }
    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: create A-records for ${subdomain} on ${baseDomains.join(', ')}`,
        after: { subdomain, baseDomains },
      };
    }

    const ip = payload.dns?.ip && payload.dns.ip !== 'auto'
      ? payload.dns.ip
      : await getExternalIp();

    const result = await createDnsRecordsForAllDomains(subdomain, ip);
    if (!result.done) {
      return { status: 'error', error: result.error || 'DNS creation failed' };
    }
    return {
      status: 'ok',
      detail: result.detail || `A-records for ${subdomain} on ${baseDomains.length} domain(s)`,
      after: { subdomain, ip, baseDomains },
    };
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    const after = stepState.after as { subdomain?: string } | undefined;
    const sub = after?.subdomain;
    if (!sub) return { status: 'skipped', detail: 'no DNS to rollback' };
    if (ctx.dryRun) return { status: 'ok', detail: `plan delete DNS ${sub}` };
    try {
      await deleteDnsRecord(sub);
      return { status: 'ok', detail: `DNS ${sub} removed` };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
