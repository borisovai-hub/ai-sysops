import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { PublishRun } from '../queries/publish';

export function usePublishService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<PublishRun>('/api/publish/service', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish-runs'] }),
  });
}

export function usePublishProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<PublishRun>('/api/publish/project', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish-runs'] }),
  });
}

export function useVerifyDeployment() {
  return useMutation({
    mutationFn: (slug: string) => api.post(`/api/publish/verify/${slug}`),
  });
}

export function useRollbackPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { publishId: string; confirmDestructive?: boolean }) =>
      api.post(`/api/publish/rollback/${params.publishId}`, {
        confirmDestructive: params.confirmDestructive ?? true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['publish-runs'] }),
  });
}

export function useApproveAi() {
  return useMutation({
    mutationFn: (params: { sessionId: string; approvalId: string; decision: 'approve' | 'reject' }) =>
      api.post(`/api/publish/ai/approve/${params.sessionId}`, {
        approvalId: params.approvalId,
        decision: params.decision,
      }),
  });
}
