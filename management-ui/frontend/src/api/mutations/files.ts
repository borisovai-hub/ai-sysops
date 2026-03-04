import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete('/api/files', { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}

export function useCreateDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; name: string }) => api.post('/api/files/mkdir', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}

export function useRenameFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.post('/api/files/rename', { from, to }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}
