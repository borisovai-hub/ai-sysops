import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import type { TasksStatus } from '@management-ui/shared';

export function useTasksStatus() {
  return useQuery({
    queryKey: ['tasks', 'status'],
    queryFn: () => api.get<TasksStatus>('/api/tasks/status'),
    staleTime: 30_000,
  });
}
