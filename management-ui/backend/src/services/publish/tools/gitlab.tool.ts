import { AppError } from '@management-ui/shared';
import {
  gitlabApi, pushFileToGitlab, deleteFileFromGitlab, setGitlabCiVariable,
} from '../../../lib/gitlab-api.js';
import { loadTemplate, renderTemplate, getTemplateForProject } from '../../../lib/template-engine.js';
import { loadAppConfig } from '../../../config/env.js';
import * as configService from '../../config.service.js';
import type { PublishTool, ToolContext, ToolResult } from '../types.js';

async function resolveProjectId(payload: ToolContext['payload']): Promise<{ id: number; defaultBranch: string; pathWithNamespace: string }> {
  const gl = payload.gitlab;
  if (!gl) throw new AppError('gitlab block required');
  let id = gl.projectId;
  if (!id && gl.projectPath) {
    const encoded = encodeURIComponent(gl.projectPath.replace(/\\/g, '/'));
    const proj = (await gitlabApi('get', `/projects/${encoded}`)) as Record<string, unknown>;
    id = proj.id as number;
    return {
      id,
      defaultBranch: (proj.default_branch as string) || 'main',
      pathWithNamespace: (proj.path_with_namespace as string) || gl.projectPath,
    };
  }
  if (!id) throw new AppError('gitlab.projectId или gitlab.projectPath обязателен');
  const proj = (await gitlabApi('get', `/projects/${id}`)) as Record<string, unknown>;
  return {
    id,
    defaultBranch: (proj.default_branch as string) || 'main',
    pathWithNamespace: (proj.path_with_namespace as string) || '',
  };
}

export const gitlabCiTool: PublishTool = {
  kind: 'gitlab_ci',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun, sharedState } = ctx;
    if (!payload.gitlab) {
      return { status: 'skipped', detail: 'gitlab block отсутствует' };
    }
    const appCfg = loadAppConfig();
    const runnerTag = appCfg.runner_tag || 'deploy-production';

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: push .gitlab-ci.yml + .gitlab/ci/pipeline.yml (template=${payload.gitlab.template}) to GitLab project`,
        after: { template: payload.gitlab.template, runnerTag },
      };
    }

    const { id, defaultBranch, pathWithNamespace } = await resolveProjectId(payload);
    sharedState.gitlabProjectId = id;
    sharedState.gitlabDefaultBranch = defaultBranch;
    sharedState.gitlabPath = pathWithNamespace;

    const templateFile = getTemplateForProject(
      payload.type === 'service' ? 'infra' : payload.type as 'deploy' | 'docs' | 'infra' | 'product',
      payload.appType,
    );
    const template = loadTemplate(templateFile);
    const rendered = renderTemplate(template, {
      SLUG: payload.slug,
      DOMAIN: payload.domain.prefix,
      PORT: String(payload.backend?.port ?? ''),
      RUNNER_TAG: runnerTag,
      DEFAULT_BRANCH: defaultBranch,
      APP_TYPE: payload.appType,
    });
    const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
    await pushFileToGitlab(id, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: CI/CD для ${payload.slug}`);
    await pushFileToGitlab(id, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: pipeline для ${payload.slug}`);
    return {
      status: 'ok',
      detail: `CI файлы загружены (template=${templateFile})`,
      after: { gitlabProjectId: id, defaultBranch, template: templateFile },
    };
  },

  async rollback(stepState, ctx): Promise<ToolResult> {
    if (ctx.dryRun) return { status: 'ok', detail: 'plan delete CI files' };
    const after = stepState.after as { gitlabProjectId?: number; defaultBranch?: string } | undefined;
    if (!after?.gitlabProjectId) return { status: 'skipped', detail: 'no CI to rollback' };
    try {
      const branch = after.defaultBranch || 'main';
      await deleteFileFromGitlab(after.gitlabProjectId, '.gitlab/ci/pipeline.yml', branch, `chore: удаление CI для ${ctx.payload.slug}`);
      await deleteFileFromGitlab(after.gitlabProjectId, '.gitlab-ci.yml', branch, `chore: удаление CI для ${ctx.payload.slug}`);
      return { status: 'ok', detail: 'CI файлы удалены' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  },
};

export const gitlabVariablesTool: PublishTool = {
  kind: 'gitlab_variables',
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const { payload, dryRun, sharedState } = ctx;
    if (!payload.gitlab) return { status: 'skipped', detail: 'no gitlab' };

    const variables: Array<{ key: string; value: string; masked?: boolean; variable_type?: string }> = [];
    const userVars = payload.gitlab.variables || {};
    for (const [k, v] of Object.entries(userVars)) variables.push({ key: k, value: v });

    if (payload.type === 'deploy') {
      variables.push({ key: 'DEPLOY_PATH', value: `/var/www/${payload.slug}` });
      variables.push({ key: 'PM2_APP_NAME', value: payload.slug });
    } else if (payload.type === 'docs') {
      variables.push({ key: 'DOCS_DEPLOY_PATH', value: `/var/www/docs/${payload.slug}` });
      variables.push({ key: 'PROJECT_SLUG', value: payload.slug });
      variables.push({ key: 'MANAGEMENT_UI_URL', value: configService.getManagementUiUrl() });
      variables.push({ key: 'MANAGEMENT_UI_TOKEN', value: configService.getManagementUiToken(), masked: true });
    } else if (payload.type === 'product') {
      variables.push({ key: 'DOWNLOADS_PATH', value: `/var/www/downloads/${payload.slug}` });
      variables.push({ key: 'PROJECT_SLUG', value: payload.slug });
      variables.push({ key: 'MANAGEMENT_UI_URL', value: configService.getManagementUiUrl() });
      variables.push({ key: 'MANAGEMENT_UI_TOKEN', value: configService.getManagementUiToken(), masked: true });
    }
    if (payload.gitlab.frontendEnv) {
      variables.push({ key: 'FRONTEND_ENV', value: payload.gitlab.frontendEnv, variable_type: 'file' });
    }
    if (payload.gitlab.backendEnv) {
      variables.push({ key: 'BACKEND_ENV', value: payload.gitlab.backendEnv, variable_type: 'file' });
    }

    if (dryRun) {
      return {
        status: 'ok',
        detail: `Plan: set ${variables.length} CI variable(s) (${variables.map(v => v.key).join(', ')})`,
        after: { keys: variables.map(v => v.key) },
      };
    }

    const id = (sharedState.gitlabProjectId as number) ?? (await resolveProjectId(payload)).id;
    for (const v of variables) {
      await setGitlabCiVariable(id, v.key, v.value, {
        masked: v.masked,
        variable_type: v.variable_type,
      });
    }
    return {
      status: 'ok',
      detail: `${variables.length} CI var(s) set`,
      after: { keys: variables.map(v => v.key) },
    };
  },
};
