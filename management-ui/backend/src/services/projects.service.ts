import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PATHS, AppError, NotFoundError, ConflictError } from '@management-ui/shared';
import { sanitizeString } from '../lib/sanitize.js';
import { loadAppConfig, buildDomainsString } from '../config/env.js';
import { loadDnsConfig, getExternalIp, createDnsRecordsForAllDomains, deleteDnsRecord } from '../lib/dns-api.js';
import { createTraefikConfig, deleteTraefikConfig, reloadTraefik } from '../lib/traefik.js';
import { gitlabApi, pushFileToGitlab, deleteFileFromGitlab, setGitlabCiVariable } from '../lib/gitlab-api.js';
import { createOrUpdateStrapiProject } from '../lib/strapi-api.js';
import { loadTemplate, renderTemplate, getTemplateForProject } from '../lib/template-engine.js';
import { execCommand } from '../lib/exec.js';
import { getManagementUiUrl, getManagementUiToken } from './config.service.js';
import { logger } from '../lib/logger.js';

interface ProjectRecord {
  slug: string;
  gitlabProjectId: number;
  projectType: string;
  appType: string;
  domain: string;
  title: string;
  description: string;
  authelia: boolean;
  pathWithNamespace: string;
  defaultBranch: string;
  ports?: { frontend?: number; backend?: number };
  status: string;
  steps: Record<string, { done: boolean; detail?: string; error?: string; updatedAt?: string }>;
  releases?: Array<Record<string, unknown>>;
  createdAt: string;
}

function loadProjects(): ProjectRecord[] {
  try {
    if (existsSync(PATHS.PROJECTS_FILE)) {
      return JSON.parse(readFileSync(PATHS.PROJECTS_FILE, 'utf-8'));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Ошибка чтения реестра проектов:', message);
  }
  return [];
}

function saveProjects(projects: ProjectRecord[]): void {
  writeFileSync(PATHS.PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

function allocatePort(projects: ProjectRecord[]): number {
  const config = loadAppConfig();
  const basePort = config.base_port || 4010;
  const usedPorts = new Set<number>();
  for (const p of projects) {
    if (p.ports) {
      if (p.ports.frontend) usedPorts.add(p.ports.frontend);
      if (p.ports.backend) usedPorts.add(p.ports.backend);
    }
  }
  let port = basePort;
  while (usedPorts.has(port)) port++;
  return port;
}

/**
 * List all registered projects.
 */
export function listProjects(): ProjectRecord[] {
  return loadProjects();
}

/**
 * List GitLab projects (from GitLab API).
 */
export async function listGitlabProjects(): Promise<unknown[]> {
  const projects = await gitlabApi('get', '/projects?membership=true&per_page=100&order_by=name&sort=asc');
  return (projects as Array<Record<string, unknown>>).map(p => ({
    id: p.id,
    name: p.name,
    path: p.path,
    pathWithNamespace: p.path_with_namespace,
    defaultBranch: p.default_branch,
    webUrl: p.web_url,
  }));
}

/**
 * Resolve a GitLab project by encoded path (e.g. "group%2Fname").
 */
export async function resolveGitlabProject(encodedPath: string): Promise<Record<string, unknown>> {
  const project = (await gitlabApi('get', `/projects/${encodedPath}`)) as Record<string, unknown>;
  return project;
}

/**
 * Publish (register) a project — main orchestrator.
 */
export async function publishProject(params: {
  gitlabProjectId: number;
  slug: string;
  projectType: string;
  appType?: string;
  domain?: string;
  title?: string;
  description?: string;
  authelia?: boolean;
  force?: boolean;
}): Promise<{ project: ProjectRecord }> {
  const slug = sanitizeString(params.slug);
  const projectType = sanitizeString(params.projectType);
  const appType = sanitizeString(params.appType || 'frontend');
  const domain = sanitizeString(params.domain || '');
  const title = sanitizeString(params.title || slug);
  const description = sanitizeString(params.description || '');
  const config = loadAppConfig();
  const dnsConfig = loadDnsConfig();

  if (!slug || !params.gitlabProjectId || !projectType) {
    throw new AppError('Необходимы параметры: gitlabProjectId, slug, projectType');
  }

  const projects = loadProjects();
  const existingIdx = projects.findIndex(p => p.slug === slug);
  if (existingIdx !== -1 && !params.force) {
    throw new ConflictError(`Проект с slug "${slug}" уже существует. Используйте force:true для перерегистрации.`);
  }
  if (existingIdx !== -1) projects.splice(existingIdx, 1);

  let gitlabProject: Record<string, unknown>;
  try {
    gitlabProject = (await gitlabApi('get', `/projects/${params.gitlabProjectId}`)) as Record<string, unknown>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(`Не удалось получить проект GitLab #${params.gitlabProjectId}: ${message}`);
  }

  const defaultBranch = (gitlabProject.default_branch as string) || 'main';
  const pathWithNamespace = gitlabProject.path_with_namespace as string;
  const projectDomain = domain || buildDomainsString(slug) || (dnsConfig.domain ? `${slug}.${dnsConfig.domain}` : '');
  const runnerTag = config.runner_tag || 'deploy-production';

  const steps: Record<string, { done: boolean; detail?: string; error?: string }> = {};
  const projectRecord: ProjectRecord = {
    slug, gitlabProjectId: params.gitlabProjectId, projectType, appType,
    domain: projectDomain, title, description, authelia: params.authelia !== false,
    pathWithNamespace, defaultBranch, createdAt: new Date().toISOString(), steps, status: 'partial',
  };

  let templateFileName: string;
  try {
    templateFileName = getTemplateForProject(projectType, appType);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AppError(message);
  }

  if (projectType === 'deploy') {
    const port = allocatePort(projects);
    projectRecord.ports = { frontend: port };

    try {
      const externalIp = await getExternalIp();
      steps.dns = await createDnsRecordsForAllDomains(slug, externalIp);
    } catch (err: unknown) { steps.dns = { done: false, error: (err as Error).message }; }

    try {
      steps.traefik = createTraefikConfig(slug, projectDomain, '127.0.0.1', port, { authelia: params.authelia !== false });
      reloadTraefik();
    } catch (err: unknown) { steps.traefik = { done: false, error: (err as Error).message }; }

    try {
      const deployPath = `/var/www/${slug}`;
      execCommand(`mkdir -p ${deployPath} && chown gitlab-runner:gitlab-runner ${deployPath}`);
      steps.directories = { done: true, detail: deployPath };
    } catch (err: unknown) { steps.directories = { done: false, error: (err as Error).message }; }

    try {
      const template = loadTemplate(templateFileName);
      const rendered = renderTemplate(template, {
        SLUG: slug, DOMAIN: projectDomain, PORT: String(port),
        RUNNER_TAG: runnerTag, DEFAULT_BRANCH: defaultBranch, APP_TYPE: appType,
      });
      const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
      steps.ci = { done: true, detail: 'CI файлы загружены' };
    } catch (err: unknown) { steps.ci = { done: false, error: (err as Error).message }; }

    try {
      await setGitlabCiVariable(params.gitlabProjectId, 'DEPLOY_PATH', `/var/www/${slug}`);
      await setGitlabCiVariable(params.gitlabProjectId, 'PM2_APP_NAME', slug);
      steps.variables = { done: true, detail: 'DEPLOY_PATH, PM2_APP_NAME' };
    } catch (err: unknown) { steps.variables = { done: false, error: (err as Error).message }; }

  } else if (projectType === 'docs') {
    try { steps.strapi = await createOrUpdateStrapiProject(slug, { title, description }); }
    catch (err: unknown) { steps.strapi = { done: false, error: (err as Error).message }; }

    try {
      const docsPath = `/var/www/docs/${slug}`;
      execCommand(`mkdir -p ${docsPath} && chown gitlab-runner:gitlab-runner ${docsPath}`);
      steps.directories = { done: true, detail: docsPath };
    } catch (err: unknown) { steps.directories = { done: false, error: (err as Error).message }; }

    try {
      const template = loadTemplate(templateFileName);
      const rendered = renderTemplate(template, { SLUG: slug, RUNNER_TAG: runnerTag, DEFAULT_BRANCH: defaultBranch });
      const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
      steps.ci = { done: true, detail: 'CI файлы загружены' };
    } catch (err: unknown) { steps.ci = { done: false, error: (err as Error).message }; }

    try {
      const managementUiUrl = getManagementUiUrl();
      const managementUiToken = getManagementUiToken();
      await setGitlabCiVariable(params.gitlabProjectId, 'DOCS_DEPLOY_PATH', `/var/www/docs/${slug}`);
      await setGitlabCiVariable(params.gitlabProjectId, 'PROJECT_SLUG', slug);
      await setGitlabCiVariable(params.gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
      await setGitlabCiVariable(params.gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
      steps.variables = { done: true, detail: 'DOCS_DEPLOY_PATH, PROJECT_SLUG, MANAGEMENT_UI_URL, MANAGEMENT_UI_TOKEN' };
    } catch (err: unknown) { steps.variables = { done: false, error: (err as Error).message }; }

  } else if (projectType === 'infra') {
    try {
      const template = loadTemplate(templateFileName);
      const rendered = renderTemplate(template, { SLUG: slug, RUNNER_TAG: runnerTag, DEFAULT_BRANCH: defaultBranch });
      const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
      steps.ci = { done: true, detail: 'CI файлы загружены' };
    } catch (err: unknown) { steps.ci = { done: false, error: (err as Error).message }; }

    if (config.strapi_url && config.strapi_token) {
      try { steps.strapi = await createOrUpdateStrapiProject(slug, { title, description }); }
      catch (err: unknown) { steps.strapi = { done: false, error: (err as Error).message }; }
    }

  } else if (projectType === 'product') {
    try { steps.strapi = await createOrUpdateStrapiProject(slug, { title, description }); }
    catch (err: unknown) { steps.strapi = { done: false, error: (err as Error).message }; }

    try {
      const downloadsPath = `/var/www/downloads/${slug}`;
      execCommand(`mkdir -p ${downloadsPath} && chown gitlab-runner:gitlab-runner ${downloadsPath}`);
      steps.directories = { done: true, detail: downloadsPath };
    } catch (err: unknown) { steps.directories = { done: false, error: (err as Error).message }; }

    try {
      const template = loadTemplate(templateFileName);
      const rendered = renderTemplate(template, { SLUG: slug, RUNNER_TAG: runnerTag, DEFAULT_BRANCH: defaultBranch });
      const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
      await pushFileToGitlab(params.gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
      steps.ci = { done: true, detail: 'CI файлы загружены' };
    } catch (err: unknown) { steps.ci = { done: false, error: (err as Error).message }; }

    try {
      const managementUiUrl = getManagementUiUrl();
      const managementUiToken = getManagementUiToken();
      await setGitlabCiVariable(params.gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
      await setGitlabCiVariable(params.gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
      await setGitlabCiVariable(params.gitlabProjectId, 'PROJECT_SLUG', slug);
      await setGitlabCiVariable(params.gitlabProjectId, 'DOWNLOADS_PATH', `/var/www/downloads/${slug}`);
      steps.variables = { done: true, detail: 'MANAGEMENT_UI_URL, MANAGEMENT_UI_TOKEN, PROJECT_SLUG, DOWNLOADS_PATH' };
    } catch (err: unknown) { steps.variables = { done: false, error: (err as Error).message }; }
  }

  projectRecord.status = Object.values(steps).every(s => s?.done) ? 'ok' : 'partial';
  projects.push(projectRecord);
  saveProjects(projects);

  return { project: projectRecord };
}

/**
 * Delete a project (rollback Traefik, DNS, CI files).
 */
export async function deleteProject(slug: string): Promise<void> {
  const cleanSlug = sanitizeString(slug);
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.slug === cleanSlug);
  if (idx === -1) throw new NotFoundError('Проект не найден');

  const project = projects[idx];

  if (project.steps?.traefik?.done) {
    deleteTraefikConfig(cleanSlug);
    reloadTraefik();
  }
  if (project.steps?.dns?.done) {
    await deleteDnsRecord(cleanSlug);
  }
  if (project.steps?.ci?.done && project.gitlabProjectId) {
    try {
      const branch = project.defaultBranch || 'main';
      await deleteFileFromGitlab(project.gitlabProjectId, '.gitlab/ci/pipeline.yml', branch, `chore: удаление CI для ${cleanSlug}`);
      await deleteFileFromGitlab(project.gitlabProjectId, '.gitlab-ci.yml', branch, `chore: удаление CI для ${cleanSlug}`);
    } catch (err: unknown) {
      logger.warn(`Не удалось удалить CI файлы для ${cleanSlug}:`, (err as Error).message);
    }
  }

  projects.splice(idx, 1);
  saveProjects(projects);
}

/**
 * Retry failed steps for a project.
 */
export async function retryProject(slug: string): Promise<{ retried: string[]; project: ProjectRecord }> {
  const cleanSlug = sanitizeString(slug);
  const projects = loadProjects();
  const project = projects.find(p => p.slug === cleanSlug);
  if (!project) throw new NotFoundError('Проект не найден');

  const config = loadAppConfig();
  const steps = project.steps || {};
  const { gitlabProjectId, defaultBranch, projectType, appType, domain: projectDomain } = project;
  const branch = defaultBranch || 'main';
  const runnerTag = config.runner_tag || 'deploy-production';
  const port = project.ports?.frontend;
  const title = project.title || cleanSlug;
  const description = project.description || '';
  const retried: string[] = [];

  if (steps.dns && !steps.dns.done && projectType === 'deploy') {
    try {
      const externalIp = await getExternalIp();
      steps.dns = await createDnsRecordsForAllDomains(cleanSlug, externalIp);
      retried.push('dns');
    } catch (err: unknown) { steps.dns = { done: false, error: (err as Error).message }; }
  }

  if (steps.traefik && !steps.traefik.done && projectType === 'deploy' && port) {
    try {
      steps.traefik = createTraefikConfig(cleanSlug, projectDomain, '127.0.0.1', port, { authelia: project.authelia !== false });
      reloadTraefik();
      retried.push('traefik');
    } catch (err: unknown) { steps.traefik = { done: false, error: (err as Error).message }; }
  }

  if (steps.directories && !steps.directories.done) {
    try {
      let dirPath: string | undefined;
      if (projectType === 'deploy') dirPath = `/var/www/${cleanSlug}`;
      else if (projectType === 'docs') dirPath = `/var/www/docs/${cleanSlug}`;
      else if (projectType === 'product') dirPath = `/var/www/downloads/${cleanSlug}`;
      if (dirPath) {
        execCommand(`mkdir -p ${dirPath} && chown -R gitlab-runner:gitlab-runner ${dirPath}`);
        steps.directories = { done: true, detail: dirPath };
        retried.push('directories');
      }
    } catch (err: unknown) { steps.directories = { done: false, error: (err as Error).message }; }
  }

  if (steps.ci && !steps.ci.done && gitlabProjectId) {
    try {
      const templateFileName = getTemplateForProject(projectType, appType);
      const template = loadTemplate(templateFileName);
      const rendered = renderTemplate(template, {
        SLUG: cleanSlug, DOMAIN: projectDomain || '', PORT: String(port || ''),
        RUNNER_TAG: runnerTag, DEFAULT_BRANCH: branch, APP_TYPE: appType || 'frontend',
      });
      const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
      await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, branch, `chore: CI retry for ${cleanSlug}`);
      await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, branch, `chore: pipeline retry for ${cleanSlug}`);
      steps.ci = { done: true, detail: 'CI файлы загружены (retry)' };
      retried.push('ci');
    } catch (err: unknown) { steps.ci = { done: false, error: (err as Error).message }; }
  }

  if (steps.strapi && !steps.strapi.done) {
    try {
      steps.strapi = await createOrUpdateStrapiProject(cleanSlug, { title, description });
      retried.push('strapi');
    } catch (err: unknown) { steps.strapi = { done: false, error: (err as Error).message }; }
  }

  if (steps.variables && !steps.variables.done && gitlabProjectId) {
    try {
      if (projectType === 'deploy') {
        await setGitlabCiVariable(gitlabProjectId, 'DEPLOY_PATH', `/var/www/${cleanSlug}`);
        await setGitlabCiVariable(gitlabProjectId, 'PM2_APP_NAME', cleanSlug);
      } else if (projectType === 'product') {
        await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', getManagementUiUrl());
        await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', getManagementUiToken(), { masked: true });
        await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', cleanSlug);
        await setGitlabCiVariable(gitlabProjectId, 'DOWNLOADS_PATH', `/var/www/downloads/${cleanSlug}`);
      } else if (projectType === 'docs') {
        await setGitlabCiVariable(gitlabProjectId, 'DOCS_DEPLOY_PATH', `/var/www/docs/${cleanSlug}`);
        await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', cleanSlug);
        await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', getManagementUiUrl());
        await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', getManagementUiToken(), { masked: true });
      }
      steps.variables = { done: true, detail: 'CI переменные (retry)' };
      retried.push('variables');
    } catch (err: unknown) { steps.variables = { done: false, error: (err as Error).message }; }
  }

  project.status = Object.values(steps).every(s => s?.done) ? 'ok' : 'partial';
  saveProjects(projects);
  return { retried, project };
}

/**
 * Update CI files for a project.
 */
export async function updateCi(slug: string): Promise<void> {
  const cleanSlug = sanitizeString(slug);
  const projects = loadProjects();
  const project = projects.find(p => p.slug === cleanSlug);
  if (!project) throw new NotFoundError('Проект не найден');

  const config = loadAppConfig();
  const dnsConfig = loadDnsConfig();
  const { projectType, appType, gitlabProjectId, defaultBranch } = project;
  const branch = defaultBranch || 'main';
  const runnerTag = config.runner_tag || 'deploy-production';
  const projectDomain = project.domain || (dnsConfig.domain ? `${cleanSlug}.${dnsConfig.domain}` : '');
  const port = project.ports?.frontend || allocatePort(projects);

  const templateFileName = getTemplateForProject(projectType, appType);
  const template = loadTemplate(templateFileName);
  const rendered = renderTemplate(template, {
    SLUG: cleanSlug, DOMAIN: projectDomain, PORT: String(port),
    RUNNER_TAG: runnerTag, DEFAULT_BRANCH: branch, APP_TYPE: appType || 'frontend',
  });

  const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
  await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, branch, `chore: update CI/CD pipeline for ${cleanSlug}`);
  await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, branch, `chore: update pipeline config for ${cleanSlug}`);

  if (!project.steps) project.steps = {};
  project.steps.ci = { done: true, detail: 'CI файлы обновлены', updatedAt: new Date().toISOString() };
  saveProjects(projects);
}

/**
 * Record a release for a project (webhook from CI).
 */
export async function recordRelease(
  slug: string,
  params: { version: string; downloadUrl?: string; changelog?: string; source?: string },
): Promise<{ release: Record<string, unknown>; strapiResult: unknown }> {
  const cleanSlug = sanitizeString(slug);
  if (!params.version) {
    throw new AppError('Необходим параметр: version');
  }

  const projects = loadProjects();
  const project = projects.find(p => p.slug === cleanSlug);
  if (!project) throw new NotFoundError(`Проект "${cleanSlug}" не найден в реестре`);

  const updateFields: Record<string, unknown> = { version: params.version };
  if (params.downloadUrl) updateFields.downloadUrl = params.downloadUrl;
  if (params.changelog) updateFields.changelog = params.changelog;

  let strapiResult = null;
  try {
    strapiResult = await createOrUpdateStrapiProject(cleanSlug, updateFields, { draft: true });
  } catch (err: unknown) {
    logger.warn(`Release ${cleanSlug}: не удалось обновить Strapi:`, (err as Error).message);
  }

  if (!project.releases) project.releases = [];
  const release = {
    version: params.version,
    downloadUrl: params.downloadUrl || '',
    changelog: params.changelog || '',
    source: params.source || 'unknown',
    action: 'release',
    strapiUpdated: !!(strapiResult && (strapiResult as { done?: boolean }).done),
    at: new Date().toISOString(),
  };
  project.releases.unshift(release);
  saveProjects(projects);

  return { release, strapiResult };
}

/**
 * Get releases for a project.
 */
export function getReleases(slug: string): unknown[] {
  const cleanSlug = sanitizeString(slug);
  const projects = loadProjects();
  const project = projects.find(p => p.slug === cleanSlug);
  if (!project) throw new NotFoundError('Проект не найден');
  return project.releases || [];
}
