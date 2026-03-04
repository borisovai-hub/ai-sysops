import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface Draft {
  id: string;
  title: string;
  slug: string;
  contentType: string;
  updatedAt: string;
}

export function useDrafts() {
  return useQuery({
    queryKey: ['content', 'drafts'],
    queryFn: () => api.get<{ drafts: Draft[] }>('/api/content/drafts').then(r => r.drafts),
    staleTime: 60_000,
  });
}
