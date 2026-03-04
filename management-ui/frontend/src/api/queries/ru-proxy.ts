import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface RuProxyDomain {
  domain: string;
  backend: string;
  enabled: boolean;
}

export function useRuProxyStatus() {
  return useQuery({
    queryKey: ['ru-proxy', 'status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/ru-proxy/status'),
    staleTime: 30_000,
  });
}

export function useRuProxyDomains() {
  return useQuery({
    queryKey: ['ru-proxy', 'domains'],
    queryFn: () => api.get<{ domains: RuProxyDomain[] }>('/api/ru-proxy/domains').then(r => r.domains),
    staleTime: 60_000,
  });
}
