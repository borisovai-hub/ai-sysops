import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface CommitInput {
  files: string[];
  message: string;
}

export function useCommit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommitInput) => api.post('/api/git/commit', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git'] }),
  });
}

export function usePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/git/push'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git'] }),
  });
}

export function useRevert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) => api.post('/api/git/revert', { hash }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git'] }),
  });
}
