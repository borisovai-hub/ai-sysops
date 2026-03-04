import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatusResult {
  branch: string;
  files: { path: string; status: string }[];
}

export function useGitStatus() {
  return useQuery({
    queryKey: ['git', 'status'],
    queryFn: () => api.get<GitStatusResult>('/api/git/status'),
    staleTime: 30_000,
  });
}

export function useGitDiff(file?: string) {
  return useQuery({
    queryKey: ['git', 'diff', file],
    queryFn: () => {
      const params = file ? `?file=${encodeURIComponent(file)}` : '';
      return api.get<{ diff: string }>(`/api/git/diff${params}`);
    },
    staleTime: 30_000,
  });
}

export function useGitLog() {
  return useQuery({
    queryKey: ['git', 'log'],
    queryFn: () => api.get<{ commits: Commit[] }>('/api/git/log'),
    staleTime: 60_000,
  });
}
