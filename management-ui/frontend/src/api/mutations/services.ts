import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface CreateServiceInput {
  name: string;
  domain: string;
  port: string | number;
  internalIp?: string;
  ip?: string;
  authelia?: boolean;
}

interface UpdateServiceInput {
  name: string;
  data: Record<string, unknown>;
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceInput) => api.post('/api/services', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: UpdateServiceInput) => api.put(`/api/services/${encodeURIComponent(name)}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.delete(`/api/services/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}
