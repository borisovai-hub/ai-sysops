import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useAgentSessions() {
  return useQuery({
    queryKey: ['agent', 'sessions'],
    queryFn: () => api.get('/api/agent/sessions'),
  });
}

export function useAgentSession(id: string | null) {
  return useQuery({
    queryKey: ['agent', 'sessions', id],
    queryFn: () => api.get(`/api/agent/sessions/${id}`),
    enabled: !!id,
  });
}

export function useAgentMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['agent', 'messages', sessionId],
    queryFn: () => api.get(`/api/agent/sessions/${sessionId}/messages`),
    enabled: !!sessionId,
    refetchInterval: 2000, // Auto-refresh для tool results
  });
}

export function useAgentTools() {
  return useQuery({
    queryKey: ['agent', 'tools'],
    queryFn: () => api.get('/api/agent/tools'),
  });
}

export function usePendingApprovals(sessionId: string | null) {
  return useQuery({
    queryKey: ['agent', 'approvals', sessionId],
    queryFn: () => api.get(`/api/agent/approvals${sessionId ? `?sessionId=${sessionId}` : ''}`),
    refetchInterval: 1000, // Быстрый polling для approvals
  });
}
