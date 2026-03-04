import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

interface CreateUserInput {
  username: string;
  displayname?: string;
  displayName?: string;
  email: string;
  password: string;
  groups?: string[];
}

interface UpdateUserInput {
  username: string;
  data: { displayname?: string; email?: string; groups?: string[] };
}

interface ChangePasswordInput {
  username: string;
  password: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post('/api/authelia/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authelia', 'users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, data }: UpdateUserInput) =>
      api.put(`/api/authelia/users/${encodeURIComponent(username)}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authelia', 'users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.delete(`/api/authelia/users/${encodeURIComponent(username)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authelia', 'users'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ username, password }: ChangePasswordInput) =>
      api.post(`/api/authelia/users/${encodeURIComponent(username)}/password`, { password }),
  });
}

export function useApplyUsers() {
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>('/api/authelia/users/apply'),
  });
}

export function useSyncUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string; imported: number }>('/api/authelia/users/sync'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['authelia', 'users'] }),
  });
}
