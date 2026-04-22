import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface LogSource {
  id: string;
  label: string;
  type: 'systemd' | 'docker';
  target: string;
  description?: string;
  group?: string;
}

export function useLogSources() {
  return useQuery<{ sources: LogSource[]; diagnostics: { journalctl: boolean; docker: boolean } }>({
    queryKey: ['log-sources'],
    queryFn: () => api.get('/api/logs/sources'),
    staleTime: 60_000,
  });
}
