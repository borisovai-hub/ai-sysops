import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete('/api/files/delete', { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}

export function useCreateDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; name: string }) => {
      const fullPath = input.path === '/' ? `/${input.name}` : `${input.path}/${input.name}`;
      return api.post('/api/files/mkdir', { path: fullPath });
    },
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
