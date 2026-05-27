import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './hooks/useAuth';
import { useTheme } from './lib/theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Root() {
  const resolved = useTheme((s) => s.resolved);

  // Wire the matchMedia listener once. The inline script in index.html already
  // applied the initial class; init() just keeps the store and DOM in sync.
  useEffect(() => useTheme.getState().init(), []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          theme={resolved}
          position="top-center"
          richColors
          closeButton
          toastOptions={{ className: 'font-sans' }}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
