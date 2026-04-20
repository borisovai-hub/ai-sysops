import { execCommandSafe } from '../../../lib/exec.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

/**
 * Docker volume: ensure, chown на заданный uid/gid ДО первого `compose up -d`.
 * Не падает, если docker/volume отсутствует — только валидирует выполнимое.
 */
export const dockerVolumeTool: PublishTool = {
  kind: 'docker_volume',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    const docker = payload.docker;
    if (!docker?.volumeName) {
      return { status: 'skipped', detail: 'volume not specified' };
    }
    const { volumeName, volumeUid, volumeGid } = docker;
    if (volumeUid == null) {
      return { status: 'skipped', detail: 'volumeUid не задан — chown пропущен' };
    }
    const gid = volumeGid ?? volumeUid;

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: docker volume create ${volumeName} + chown ${volumeUid}:${gid}`,
        after: { volumeName, volumeUid, volumeGid: gid },
      };
    }

    const create = execCommandSafe(`docker volume create ${volumeName}`);
    if (!create.success) {
      return { status: 'error', error: create.error || 'docker volume create failed' };
    }
    // mountpoint из inspect
    const mount = execCommandSafe(`docker volume inspect ${volumeName} --format '{{ .Mountpoint }}'`);
    if (!mount.success || !mount.stdout.trim()) {
      return { status: 'error', error: 'failed to inspect volume mountpoint' };
    }
    const mp = mount.stdout.trim();
    const chown = execCommandSafe(`chown -R ${volumeUid}:${gid} ${mp}`);
    if (!chown.success) {
      return { status: 'error', error: chown.error || 'chown failed' };
    }
    return {
      status: 'ok',
      detail: `${volumeName} chowned to ${volumeUid}:${gid} at ${mp}`,
      after: { volumeName, volumeUid, volumeGid: gid, mountpoint: mp },
    };
  },
};
