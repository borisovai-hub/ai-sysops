import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title?: string; model?: string }) =>
      api.post('/api/agent/sessions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', 'sessions'] }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/agent/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', 'sessions'] }),
  });
}

export function useApproveAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/agent/approvals/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent'] }),
  });
}

export function useDenyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/api/agent/approvals/${id}/deny`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent'] }),
  });
}
