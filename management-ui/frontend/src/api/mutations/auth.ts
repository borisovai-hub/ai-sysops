import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<{ id: string; name: string; token: string }>('/api/auth/tokens', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'tokens'] }),
  });
}

export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/auth/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'tokens'] }),
  });
}
