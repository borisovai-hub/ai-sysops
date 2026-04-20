import { AppError } from '@management-ui/shared';
import { execCommandSafe } from '../../../lib/exec.js';
import { existsSync } from 'node:fs';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

const INSTALL_SCRIPT_DIR = '/opt/management-ui/scripts/single-machine';

export const installTool: PublishTool = {
  kind: 'install_script',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    if (!payload.install) return { status: 'skipped', detail: 'install block отсутствует' };
    const { scriptName, forceReinstall, preserveSecrets } = payload.install;
    if (!/^[a-z0-9-]+$/.test(scriptName) || scriptName.startsWith('-')) {
      throw new AppError(`install.scriptName невалиден: ${scriptName}`);
    }
    const scriptPath = `${INSTALL_SCRIPT_DIR}/install-${scriptName}.sh`;
    const flags: string[] = [];
    if (forceReinstall) flags.push('--force');
    if (preserveSecrets === false) flags.push('--reset-secrets');

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: systemd-run ${scriptPath} ${flags.join(' ')}`.trim(),
        after: { scriptPath, flags },
      };
    }

    if (!existsSync(scriptPath)) {
      return { status: 'error', error: `Install-скрипт не найден: ${scriptPath}` };
    }
    // systemd-run чтобы не висеть на долгих установках; если недоступен — fallback.
    const cmd = `systemd-run --unit=publish-install-${payload.slug} --collect --wait bash ${scriptPath} ${flags.join(' ')}`.trim();
    const result = execCommandSafe(cmd);
    if (!result.success) {
      const fallback = execCommandSafe(`bash ${scriptPath} ${flags.join(' ')}`);
      if (!fallback.success) {
        return { status: 'error', error: fallback.error || result.error || 'install script failed' };
      }
      return { status: 'ok', detail: `installed via fallback (без systemd-run)`, after: { scriptPath } };
    }
    return { status: 'ok', detail: `installed via systemd-run`, after: { scriptPath } };
  },
};
