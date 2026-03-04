import axios from 'axios';
import { loadAppConfig } from '../config/env.js';

/**
 * Make a Strapi API request.
 */
export async function strapiApi(method: string, endpoint: string, data?: unknown): Promise<unknown> {
  const config = loadAppConfig();
  if (!config.strapi_url || !config.strapi_token) {
    throw new Error('Strapi URL или токен не настроены в config.json');
  }
  const response = await axios({
    method,
    url: `${config.strapi_url}/api${endpoint}`,
    headers: { Authorization: `Bearer ${config.strapi_token}` },
    data,
    timeout: 15000,
  });
  return response.data;
}

interface StrapiProjectResult {
  done: boolean;
  detail?: string;
  id?: number;
  error?: string;
}

interface CreateOrUpdateOptions {
  draft?: boolean;
}

/**
 * Create or update a Strapi project entry by slug.
 */
export async function createOrUpdateStrapiProject(
  slug: string,
  fields: Record<string, unknown>,
  options: CreateOrUpdateOptions = {},
): Promise<StrapiProjectResult> {
  try {
    const existing = (await strapiApi('get', `/projects?filters[slug][$eq]=${slug}&status=draft`)) as {
      data?: Array<{ id: number }>;
    };
    if (existing.data && existing.data.length > 0) {
      const id = existing.data[0].id;
      const updateData: Record<string, unknown> = { ...fields };
      if (options.draft) updateData.publishedAt = null;
      await strapiApi('put', `/projects/${id}`, { data: updateData });
      return { done: true, detail: `Strapi проект #${id} обновлён${options.draft ? ' (draft)' : ''}`, id };
    }
    const createData: Record<string, unknown> = { slug, ...fields };
    if (options.draft !== false) createData.publishedAt = null;
    const created = (await strapiApi('post', '/projects', { data: createData })) as {
      data: { id: number };
    };
    return { done: true, detail: `Strapi проект #${created.data.id} создан (draft)`, id: created.data.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { done: false, error: message };
  }
}
