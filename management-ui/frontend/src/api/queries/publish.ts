import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface PublishRunSummary {
  id: string;
  slug: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  dryRun: boolean;
}

export interface PublishStep {
  kind: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  error?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface PublishRun {
  id: string;
  idempotencyKey: string;
  slug: string;
  type: string;
  status: string;
  dryRun: boolean;
  steps: PublishStep[];
  errors: string[];
  createdAt: string;
  updatedAt: string;
  payload?: Record<string, unknown>;
}

export function usePublishRuns(params: { slug?: string; status?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.slug) qs.set('slug', params.slug);
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  return useQuery<{ runs: PublishRunSummary[]; total: number }>({
    queryKey: ['publish-runs', params],
    queryFn: () => api.get(`/api/publish/runs?${qs.toString()}`),
    refetchInterval: 5000,
  });
}

export function usePublishRun(id: string | null) {
  return useQuery<PublishRun>({
    queryKey: ['publish-run', id],
    queryFn: () => api.get(`/api/publish/runs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 3000;
      return ['running', 'pending', 'planning'].includes(data.status) ? 2000 : false;
    },
  });
}

export interface ReleaseArtifact {
  filename: string;
  label?: string;
  platform?: string;
  sizeBytes: number;
  checksumSha256?: string;
  storagePath: string;
  downloadUrl: string;
  visibility: string;
}

export interface ReleaseInfo {
  slug: string;
  version: string;
  action: string;
  source: string;
  changelog: string;
  releasedAt: string;
  strapiStatus?: string;
  strapiDocumentId?: string;
  artifacts: ReleaseArtifact[];
  createdAt: string;
}

export interface ReleaseSummary {
  version: string;
  action: string;
  source: string;
  changelog: string;
  setAsCurrent: boolean;
  strapiStatus: string | null;
  releasedAt: string;
  artifactsCount: number;
}

export function useReleases(slug: string | null) {
  return useQuery<{ releases: ReleaseSummary[]; current: string | null }>({
    queryKey: ['publish-releases', slug],
    queryFn: () => api.get(`/api/publish/releases/${slug}`),
    enabled: !!slug,
  });
}
