import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api/client.ts';
import { App } from './App.tsx';
import { AuthProvider } from './auth/AuthProvider.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Un 4xx no se arregla reintentando (401, 403, 404); los fallos de red sí.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
