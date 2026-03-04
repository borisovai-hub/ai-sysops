import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface FileEntry {
  name: string;
  type: string;
  size: number;
  modified: string;
}

export function useFileStatus() {
  return useQuery({
    queryKey: ['files', 'status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/files/status'),
    staleTime: 30_000,
  });
}

export function useFileBrowse(path: string) {
  return useQuery({
    queryKey: ['files', 'browse', path],
    queryFn: () =>
      api.get<{ files: FileEntry[] }>(`/api/files/browse?path=${encodeURIComponent(path)}`)
        .then(r => r.files),
    staleTime: 60_000,
    enabled: !!path,
  });
}
