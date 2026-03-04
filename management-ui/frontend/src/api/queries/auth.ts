import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

interface AuthCheck {
  authenticated: boolean;
  method?: string;
  user?: string;
}

export function useAuthCheck() {
  return useQuery({
    queryKey: ['auth', 'check'],
    queryFn: () => api.get<AuthCheck>('/api/auth/check'),
    staleTime: 60_000,
  });
}

interface Token {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
}

export function useTokens() {
  return useQuery({
    queryKey: ['auth', 'tokens'],
    queryFn: () => api.get<Token[]>('/api/auth/tokens'),
    staleTime: 60_000,
  });
}
