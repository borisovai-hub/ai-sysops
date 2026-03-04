import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface Proxy {
  name: string;
  type: string;
  status: string;
  local_addr: string;
  remote_addr: string;
}

export function useTunnelStatus() {
  return useQuery({
    queryKey: ['tunnels', 'status'],
    queryFn: () => api.get<{ status: string; proxies_count: number }>('/api/tunnels/status'),
    staleTime: 30_000,
  });
}

export function useProxies() {
  return useQuery({
    queryKey: ['tunnels', 'proxies'],
    queryFn: () => api.get<{ proxies: Proxy[] }>('/api/tunnels/proxies').then(r => r.proxies),
    staleTime: 30_000,
  });
}

export function useTunnelConfig() {
  return useQuery({
    queryKey: ['tunnels', 'config'],
    queryFn: () => api.get<Record<string, unknown>>('/api/tunnels/config'),
    staleTime: 60_000,
  });
}

export function useClientConfig() {
  return useQuery({
    queryKey: ['tunnels', 'client-config'],
    queryFn: () => api.get<{ config: string }>('/api/tunnels/client-config').then(r => r.config),
    staleTime: 60_000,
  });
}
