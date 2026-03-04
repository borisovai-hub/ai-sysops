import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useAnalyticsStatus() {
  return useQuery({
    queryKey: ['analytics', 'status'],
    queryFn: () => api.get<{ status: string; url: string }>('/api/analytics/status'),
    staleTime: 30_000,
  });
}
