import { useQuery } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import type {
  ServerRecord,
  ServerHealthSnapshot,
  CreateServerRequest,
  CreateServerResponse,
  UpdateServerRequest,
} from '@management-ui/shared';

export interface ServerWithHealth extends ServerRecord {
  health: ServerHealthSnapshot;
}

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () =>
      api.get<{ servers: ServerWithHealth[]; step_ca_available: boolean }>('/api/servers/'),
    refetchInterval: 30_000,
  });
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateServerRequest) =>
      api.post<CreateServerResponse>('/api/servers/', req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useUpdateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: UpdateServerRequest }) =>
      api.put<{ server: ServerRecord }>(`/api/servers/${encodeURIComponent(name)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useDeleteServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.delete(`/api/servers/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useTestServer() {
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ server: string; health: ServerHealthSnapshot }>(
        `/api/servers/${encodeURIComponent(name)}/test`,
      ),
  });
}

export function useRotateBootstrapToken() {
  return useMutation({
    mutationFn: (name: string) =>
      api.post<CreateServerResponse>(`/api/servers/${encodeURIComponent(name)}/rotate-token`),
  });
}
