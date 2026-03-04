import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PATHS } from '@management-ui/shared';
import { strapiApi } from '../lib/strapi-api.js';
import { AppError } from '@management-ui/shared';
import { sanitizeString } from '../lib/sanitize.js';
import { logger } from '../lib/logger.js';

interface DraftItem {
  id: number;
  contentType: string;
  title: string;
  slug?: string;
  updatedAt?: string;
  publishedAt?: string;
}

/**
 * Get all draft content from Strapi (projects + notes).
 */
export async function listDrafts(): Promise<DraftItem[]> {
  const drafts: DraftItem[] = [];

  try {
    const projects = (await strapiApi('get', '/projects?status=draft&pagination[pageSize]=100')) as {
      data?: Array<Record<string, unknown>>;
    };
    if (projects.data) {
      for (const item of projects.data) {
        drafts.push({
          id: item.id as number,
          contentType: 'projects',
          title: (item.title || item.slug || `#${item.id}`) as string,
          slug: item.slug as string | undefined,
          updatedAt: item.updatedAt as string | undefined,
          publishedAt: item.publishedAt as string | undefined,
        });
      }
    }
  } catch (e: unknown) {
    logger.warn('Не удалось получить draft-проекты:', (e as Error).message);
  }

  try {
    const notes = (await strapiApi('get', '/notes?status=draft&pagination[pageSize]=100')) as {
      data?: Array<Record<string, unknown>>;
    };
    if (notes.data) {
      for (const item of notes.data) {
        drafts.push({
          id: item.id as number,
          contentType: 'notes',
          title: (item.title_ru || item.title_en || `#${item.id}`) as string,
          slug: item.slug as string | undefined,
          updatedAt: item.updatedAt as string | undefined,
          publishedAt: item.publishedAt as string | undefined,
        });
      }
    }
  } catch { /* notes may not exist */ }

  return drafts;
}

const ALLOWED_CONTENT_TYPES = ['projects', 'notes', 'threads', 'blog-notes'];

function loadProjects(): Array<Record<string, unknown>> {
  try {
    if (existsSync(PATHS.PROJECTS_FILE)) {
      return JSON.parse(readFileSync(PATHS.PROJECTS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveProjects(projects: Array<Record<string, unknown>>): void {
  writeFileSync(PATHS.PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

/**
 * Publish a content entry in Strapi.
 */
export async function publishContent(contentType: string, id: number): Promise<void> {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new AppError(`Недопустимый content type: ${contentType}`);
  }

  const now = new Date().toISOString();
  await strapiApi('put', `/${contentType}/${id}`, { data: { publishedAt: now } });

  if (contentType === 'projects') {
    try {
      const strapiProject = (await strapiApi('get', `/${contentType}/${id}`)) as {
        data?: Record<string, unknown>;
      };
      const slug = strapiProject.data?.slug as string | undefined;
      if (slug) {
        const projects = loadProjects();
        const project = projects.find(p => p.slug === slug);
        if (project) {
          if (!project.releases) project.releases = [];
          (project.releases as unknown[]).unshift({
            version: strapiProject.data?.version || '',
            source: 'admin',
            action: 'publish',
            at: now,
          });
          saveProjects(projects);
        }
      }
    } catch (e: unknown) {
      logger.warn('Не удалось обновить аудит-лог:', (e as Error).message);
    }
  }
}

/**
 * Unpublish a content entry in Strapi.
 */
export async function unpublishContent(contentType: string, id: number): Promise<void> {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new AppError(`Недопустимый content type: ${contentType}`);
  }

  await strapiApi('put', `/${contentType}/${id}`, { data: { publishedAt: null } });

  if (contentType === 'projects') {
    try {
      const strapiProject = (await strapiApi('get', `/${contentType}/${id}?status=draft`)) as {
        data?: Record<string, unknown>;
      };
      const slug = strapiProject.data?.slug as string | undefined;
      if (slug) {
        const projects = loadProjects();
        const project = projects.find(p => p.slug === slug);
        if (project) {
          if (!project.releases) project.releases = [];
          (project.releases as unknown[]).unshift({
            version: strapiProject.data?.version || '',
            source: 'admin',
            action: 'unpublish',
            at: new Date().toISOString(),
          });
          saveProjects(projects);
        }
      }
    } catch (e: unknown) {
      logger.warn('Не удалось обновить аудит-лог:', (e as Error).message);
    }
  }
}
