import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface AutheliaUser {
  username: string;
  displayname: string;
  email: string;
  externalEmail: string;
  groups: string[];
  disabled: boolean;
  authPolicy: 'one_factor' | 'two_factor';
}

export interface ParsedNotification {
  date: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}

export function useAutheliaUsers() {
  return useQuery({
    queryKey: ['authelia', 'users'],
    queryFn: () => api.get<{ users: AutheliaUser[] }>('/api/authelia/users').then(r => r.users),
    staleTime: 60_000,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['authelia', 'notifications'],
    queryFn: () => api.get<{ notifications: ParsedNotification[] }>('/api/authelia/notifications').then(r => r.notifications),
    staleTime: 30_000,
  });
}

export function useNotifierConfig() {
  return useQuery({
    queryKey: ['authelia', 'notifier'],
    queryFn: () => api.get<Record<string, unknown>>('/api/authelia/notifier'),
    staleTime: 60_000,
  });
}
