export type ProjectType = 'deploy' | 'docs' | 'infra' | 'product';
export type AppType = 'frontend' | 'backend' | 'fullstack';
export type ProjectStatus = 'ok' | 'partial';

export interface ProjectStep {
  stepName: string;
  done: boolean;
  detail?: string;
  error?: string;
}

export interface ProjectRelease {
  id: number;
  version: string;
  downloadUrl?: string;
  changelog?: string;
  source: string;
  action: string;
  strapiUpdated: boolean;
  createdAt: string;
}

export interface Project {
  id: number;
  slug: string;
  gitlabProjectId: number;
  projectType: ProjectType;
  appType: AppType;
  domain: string | null;
  title: string;
  description: string;
  authelia: boolean;
  pathWithNamespace: string | null;
  defaultBranch: string;
  portFrontend: number | null;
  portBackend: number | null;
  status: ProjectStatus;
  steps: ProjectStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishProjectRequest {
  slug: string;
  gitlabProjectId: number;
  projectType: ProjectType;
  appType?: AppType;
  title: string;
  description?: string;
  authelia?: boolean;
}

export interface PublishConfig {
  gitlab_url: string;
  strapi_url: string;
  base_port: number;
  runner_tag: string;
  base_domains: string[];
}
