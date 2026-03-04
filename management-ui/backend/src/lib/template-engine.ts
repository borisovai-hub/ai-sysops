import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '@management-ui/shared';

/**
 * Load a CI template file by name.
 */
export function loadTemplate(templateName: string): string {
  const templatePath = join(PATHS.TEMPLATES_DIR, templateName);
  if (!existsSync(templatePath)) {
    throw new Error(`Шаблон не найден: ${templateName}`);
  }
  return readFileSync(templatePath, 'utf-8');
}

/**
 * Render a template by replacing {{KEY}} placeholders.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Get CI template filename for a project type and app type.
 */
export function getTemplateForProject(projectType: string, appType: string): string {
  const mapping: Record<string, Record<string, string>> = {
    deploy: { frontend: 'frontend.gitlab-ci.yml', backend: 'backend.gitlab-ci.yml', fullstack: 'fullstack.gitlab-ci.yml' },
    docs: { default: 'docs.gitlab-ci.yml' },
    infra: { default: 'validate.gitlab-ci.yml' },
    product: { default: 'product.gitlab-ci.yml' },
  };
  const typeMap = mapping[projectType];
  if (!typeMap) throw new Error(`Неизвестный тип проекта: ${projectType}`);
  return typeMap[appType] || typeMap.default || Object.values(typeMap)[0];
}
