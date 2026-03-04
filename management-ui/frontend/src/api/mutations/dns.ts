import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface CreateDnsInput {
  subdomain: string;
  domain: string;
  type: string;
  ip: string;
}

interface UpdateDnsInput {
  id: string;
  data: Record<string, unknown>;
}

export function useCreateDns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDnsInput) => api.post('/api/dns/records', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dns', 'records'] }),
  });
}

export function useUpdateDns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: UpdateDnsInput) => api.put(`/api/dns/records/${encodeURIComponent(id)}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dns', 'records'] }),
  });
}

export function useDeleteDns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/dns/records/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dns', 'records'] }),
  });
}
