import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { MonitoringConfig, MonitoringStatus, HealthCheckRow, ServiceUptimeStats, AlertRow } from '@management-ui/shared';

export function useMonitoringConfig() {
  return useQuery({
    queryKey: ['monitoring', 'config'],
    queryFn: () => api.get<MonitoringConfig>('/api/monitoring/config'),
    staleTime: 60_000,
  });
}

export function useMonitoringStatus() {
  return useQuery({
    queryKey: ['monitoring', 'status'],
    queryFn: () => api.get<MonitoringStatus>('/api/monitoring/status'),
    refetchInterval: 30_000,
  });
}

export function useServiceDetail(name: string) {
  return useQuery({
    queryKey: ['monitoring', 'service', name],
    queryFn: () =>
      api.get<{ history: HealthCheckRow[]; stats: ServiceUptimeStats }>(
        `/api/monitoring/status/${encodeURIComponent(name)}`,
      ),
    enabled: !!name,
    staleTime: 30_000,
  });
}

export function useUptimeStats(days?: number) {
  const params = days != null ? `?days=${days}` : '';
  return useQuery({
    queryKey: ['monitoring', 'uptime', days],
    queryFn: () => api.get<{ stats: ServiceUptimeStats[] }>(`/api/monitoring/uptime${params}`),
    staleTime: 60_000,
  });
}

export function useAlerts(params?: { status?: string; severity?: string; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.severity) search.set('severity', params.severity);
  if (params?.limit != null) search.set('limit', String(params.limit));
  const qs = search.toString();

  return useQuery({
    queryKey: ['monitoring', 'alerts', params],
    queryFn: () => api.get<{ alerts: AlertRow[] }>(`/api/monitoring/alerts${qs ? `?${qs}` : ''}`),
  });
}
