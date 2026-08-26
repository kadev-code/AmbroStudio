import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '@/src/modules/errors/app-error-boundary';
import { StudioShell } from '@/src/modules/shell/studio-shell';
import { installGlobalErrorHandlers } from '@/src/infrastructure/logging/global-error-handlers';
import '@/src/styles/globals.css';

installGlobalErrorHandlers();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('APP_ROOT_NOT_FOUND');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <StudioShell />
    </AppErrorBoundary>
  </StrictMode>,
);
