import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface AddDomainInput {
  domain: string;
  backend: string;
  enabled?: boolean;
}

interface UpdateDomainInput {
  domain: string;
  data: { backend?: string; enabled?: boolean };
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDomainInput) => api.post('/api/ru-proxy/domains', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ru-proxy', 'domains'] }),
  });
}

export function useUpdateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, data }: UpdateDomainInput) =>
      api.put(`/api/ru-proxy/domains/${encodeURIComponent(domain)}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ru-proxy', 'domains'] }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => api.delete(`/api/ru-proxy/domains/${encodeURIComponent(domain)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ru-proxy', 'domains'] }),
  });
}
