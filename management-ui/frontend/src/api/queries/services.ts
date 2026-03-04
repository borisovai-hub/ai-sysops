import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

interface Service {
  name: string;
  domain: string;
  internalIp: string;
  port: string;
  configFile: string;
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<{ services: Service[] }>('/api/services').then(r => r.services),
    staleTime: 30_000,
  });
}

export function useTraefikStatus() {
  return useQuery({
    queryKey: ['traefik', 'status'],
    queryFn: () => api.get<{ status: string }>('/api/traefik/status'),
    staleTime: 30_000,
    retry: false,
  });
}
