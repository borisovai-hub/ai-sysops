import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export function usePublishContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/content/${encodeURIComponent(id)}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content', 'drafts'] }),
  });
}

export function useUnpublishContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/content/${encodeURIComponent(id)}/unpublish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content', 'drafts'] }),
  });
}
