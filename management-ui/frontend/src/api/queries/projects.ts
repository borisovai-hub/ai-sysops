import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface PublishConfig {
  gitlabUrl: string;
  strapiUrl: string;
  baseDomains: string;
  basePorts: string;
  runnerTag: string;
  mainSitePath: string;
  deployBasePath: string;
}

export interface Project {
  slug: string;
  projectType: string;
  appType: string;
  domain: string;
  title: string;
  status: string;
  steps: Record<string, unknown>;
  releases: unknown[];
}

export interface GitlabProject {
  id: number;
  name: string;
  web_url: string;
}

export function usePublishConfig() {
  return useQuery({
    queryKey: ['publish', 'config'],
    queryFn: () => api.get<{ config: PublishConfig }>('/api/publish/config').then(r => r.config),
    staleTime: 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['publish', 'projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/api/publish/projects').then(r => r.projects),
    staleTime: 60_000,
  });
}

export function useGitlabProjects() {
  return useQuery({
    queryKey: ['gitlab', 'projects'],
    queryFn: () => api.get<{ projects: GitlabProject[] }>('/api/gitlab/projects').then(r => r.projects),
    staleTime: 60_000,
  });
}
