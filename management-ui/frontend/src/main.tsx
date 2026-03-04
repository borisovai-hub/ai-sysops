import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster, toast } from 'sonner';
import { App } from './App';
import { ApiError } from './api/client';
import { initTheme } from './lib/theme';
import './index.css';

initTheme();

const mutationCache = new MutationCache({
  onError: (error) => {
    const msg = error instanceof ApiError
      ? error.message
      : error?.message || 'Неизвестная ошибка';
    toast.error(msg);
  },
});

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
