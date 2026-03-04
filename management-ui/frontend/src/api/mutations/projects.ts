import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface PublishProjectInput {
  slug: string;
  type?: string;
  projectType?: string;
  appType?: string;
  gitlabProject?: string;
  title?: string;
  domain?: string;
}

export function usePublishProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishProjectInput) => api.post('/api/publish/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish', 'projects'] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.delete(`/api/publish/projects/${encodeURIComponent(slug)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish', 'projects'] }),
  });
}

export function useRetryProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post(`/api/publish/projects/${encodeURIComponent(slug)}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish', 'projects'] }),
  });
}
