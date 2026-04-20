import { createRelease } from '../releases.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

/**
 * Release tool — запускается после основных шагов публикации, если в payload
 * передан блок `release`. Одним вызовом: artifact materialize → Strapi update.
 */
export const releaseTool: PublishTool = {
  kind: 'strapi_release',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun, runId } = ctx;
    if (!payload.release) return { status: 'skipped', detail: 'release block отсутствует' };
    try {
      const info = await createRelease(payload.slug, {
        idempotencyKey: payload.idempotencyKey + ':release',
        dryRun,
        release: payload.release,
        updateStrapi: !!payload.strapi,
        publishToSite: false,
      }, runId);
      return {
        status: 'ok',
        detail: `release ${info.version} with ${info.artifacts.length} artifact(s), strapi=${info.strapiStatus}`,
        after: {
          version: info.version,
          strapiStatus: info.strapiStatus,
          artifactCount: info.artifacts.length,
        },
      };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
