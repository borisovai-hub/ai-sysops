import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type { MonitoringConfig } from '@management-ui/shared';

export function useUpdateMonitoringConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: MonitoringConfig) => api.put('/api/monitoring/config', config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring'] }),
  });
}

export function useRunAllChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/monitoring/check'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring', 'status'] }),
  });
}

export function useRunCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post(`/api/monitoring/check/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring', 'status'] }),
  });
}

export function useAckAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/api/monitoring/alerts/${id}/ack`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring', 'alerts'] }),
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/api/monitoring/alerts/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring', 'alerts'] }),
  });
}
