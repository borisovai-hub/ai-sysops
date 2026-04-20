import { execCommand } from '../../../lib/exec.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

const BASE_DIRS: Record<string, string> = {
  deploy: '/var/www',
  docs: '/var/www/docs',
  product: '/var/www/downloads',
};

export const directoriesTool: PublishTool = {
  kind: 'directories',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    const base = BASE_DIRS[payload.type];
    if (!base) {
      return { status: 'skipped', detail: `type=${payload.type} без директории` };
    }
    const path = `${base}/${payload.slug}`;

    if (dryRun) {
      return { status: 'ok', detail: `Plan: mkdir -p ${path} + chown gitlab-runner`, after: { path } };
    }
    try {
      execCommand(`mkdir -p ${path} && chown gitlab-runner:gitlab-runner ${path}`);
      return { status: 'ok', detail: path, after: { path } };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
