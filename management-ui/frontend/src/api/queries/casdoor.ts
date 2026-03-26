import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { CasdoorStatus } from '@management-ui/shared';

export function useCasdoorStatus() {
  return useQuery({
    queryKey: ['casdoor', 'status'],
    queryFn: () => api.get<CasdoorStatus>('/api/casdoor/status'),
    staleTime: 30_000,
  });
}
