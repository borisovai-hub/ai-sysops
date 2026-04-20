import { createOrUpdateStrapiProject } from '../../../lib/strapi-api.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

export const strapiTool: PublishTool = {
  kind: 'strapi',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun } = ctx;
    if (!payload.strapi) return { status: 'skipped', detail: 'strapi block отсутствует' };
    const entry = { ...payload.strapi.entry, title: payload.title, description: payload.description };

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: upsert Strapi ${payload.strapi.contentType} entry slug=${payload.slug}`,
        after: { contentType: payload.strapi.contentType, slug: payload.slug },
      };
    }
    try {
      const result = await createOrUpdateStrapiProject(payload.slug, entry, { draft: true });
      if (!result.done) return { status: 'error', error: result.error || 'Strapi upsert failed' };
      return {
        status: 'ok',
        detail: result.detail || `Strapi entry ${payload.slug} upserted`,
        after: { strapiId: result.id, contentType: payload.strapi.contentType },
      };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};
