import { safeLogger } from './safe-logger';

export function installGlobalErrorHandlers() {
  const handleWindowError = (event: ErrorEvent) => {
    safeLogger.record(
      {
        severity: 'error',
        eventCode: 'UNHANDLED_WINDOW_ERROR',
        module: 'app',
        operation: 'handle-window-error',
        result: 'failure',
        routeId: 'app.global',
        errorCode: 'UNHANDLED_ERROR',
      },
      event.error,
    );
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    safeLogger.record(
      {
        severity: 'error',
        eventCode: 'UNHANDLED_PROMISE_REJECTION',
        module: 'app',
        operation: 'handle-promise-rejection',
        result: 'failure',
        routeId: 'app.global',
        errorCode: 'UNHANDLED_REJECTION',
      },
      event.reason,
    );
  };

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
