import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export interface AutheliaUser {
  username: string;
  displayname: string;
  email: string;
  groups: string[];
}

export interface Notification {
  id: string;
  subject: string;
  body: string;
  recipient: string;
  sent_at: string;
}

export function useAutheliaUsers() {
  return useQuery({
    queryKey: ['authelia', 'users'],
    queryFn: () => api.get<{ users: AutheliaUser[] }>('/api/authelia/users').then(r => r.users),
    staleTime: 60_000,
  });
}

export function useNotifications(username?: string) {
  return useQuery({
    queryKey: ['authelia', 'notifications', username],
    queryFn: () => {
      const params = username ? `?username=${encodeURIComponent(username)}` : '';
      return api.get<{ notifications: Notification[] }>(`/api/authelia/notifications${params}`)
        .then(r => r.notifications);
    },
    staleTime: 60_000,
  });
}

export function useNotifierConfig() {
  return useQuery({
    queryKey: ['authelia', 'notifier'],
    queryFn: () => api.get<Record<string, unknown>>('/api/authelia/notifier'),
    staleTime: 60_000,
  });
}
