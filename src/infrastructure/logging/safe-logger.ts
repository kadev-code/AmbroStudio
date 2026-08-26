import { z } from 'zod';

const safeEventSchema = z
  .object({
    eventId: z.string().uuid(),
    incidentCode: z.string().regex(/^AMB-[A-Z0-9]{5}$/),
    correlationId: z.string().uuid(),
    timestamp: z.string().datetime(),
    severity: z.enum(['debug', 'info', 'warning', 'error', 'fatal']),
    eventCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    module: z.enum([
      'app',
      'authentication',
      'clients',
      'diagnostics',
      'firebase',
      'pricing',
      'production',
      'storage',
    ]),
    operation: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    result: z.enum(['success', 'failure']),
    environment: z.enum(['development', 'staging', 'production']),
    releaseVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,40}$/),
    buildId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    routeId: z.string().regex(/^[a-z][a-z0-9.-]{1,80}$/).optional(),
    browserFamily: z
      .enum(['chrome', 'edge', 'firefox', 'safari', 'other'])
      .optional(),
    online: z.boolean().optional(),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
    stackFingerprint: z.string().regex(/^[a-f0-9]{8}$/).optional(),
  })
  .strict();

export type SafeDiagnosticEvent = z.infer<typeof safeEventSchema>;
export type SafeLogModule = SafeDiagnosticEvent['module'];
export type SafeLogSeverity = SafeDiagnosticEvent['severity'];

export type SafeLogInput = {
  severity: SafeLogSeverity;
  eventCode: string;
  module: SafeLogModule;
  operation: string;
  result: 'success' | 'failure';
  correlationId?: string;
  routeId?: string;
  errorCode?: string;
};

export interface DiagnosticTransport {
  send(event: SafeDiagnosticEvent): Promise<void>;
}

export class MemoryDiagnosticTransport implements DiagnosticTransport {
  readonly events: SafeDiagnosticEvent[] = [];

  async send(event: SafeDiagnosticEvent) {
    this.events.push(event);
  }
}

class EndpointDiagnosticTransport implements DiagnosticTransport {
  constructor(private readonly endpoint?: string) {}

  async send(event: SafeDiagnosticEvent) {
    if (typeof window !== 'undefined' && window.ambroDesktop) {
      window.ambroDesktop.diagnostics.record(event);
      return;
    }

    if (!this.endpoint) {
      return;
    }

    await fetch(this.endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    });
  }
}

function createUuid() {
  return crypto.randomUUID();
}

function createIncidentCode(uuid: string) {
  return 'AMB-' + uuid.replaceAll('-', '').slice(-5).toUpperCase();
}

function browserFamily(): SafeDiagnosticEvent['browserFamily'] {
  if (typeof navigator === 'undefined') return undefined;
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('edg/')) return 'edge';
  if (agent.includes('chrome/')) return 'chrome';
  if (agent.includes('firefox/')) return 'firefox';
  if (agent.includes('safari/')) return 'safari';
  return 'other';
}

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeStackFingerprint(error: unknown) {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }

  const normalized = error.stack
    .split('\n')
    .slice(0, 8)
    .map((line) =>
      line
        .replace(/https?:\/\/[^\s)]+/gi, '<url>')
        .replace(/[A-Z]:\\[^\s)]+/gi, '<path>')
        .replace(/\?.*?(?=[:)\s]|$)/g, ''),
    )
    .join('\n');

  return hashText(normalized);
}

function runtimeEnvironment(): SafeDiagnosticEvent['environment'] {
  const value = import.meta.env.VITE_APP_ENV;
  if (value === 'staging' || value === 'production') return value;
  return 'development';
}

export function createSafeLogger(
  transport: DiagnosticTransport = new EndpointDiagnosticTransport(
    import.meta.env.VITE_DIAGNOSTICS_ENDPOINT,
  ),
) {
  return {
    record(input: SafeLogInput, error?: unknown) {
      const eventId = createUuid();
      const event = safeEventSchema.parse({
        eventId,
        incidentCode: createIncidentCode(eventId),
        correlationId: input.correlationId ?? createUuid(),
        timestamp: new Date().toISOString(),
        severity: input.severity,
        eventCode: input.eventCode,
        module: input.module,
        operation: input.operation,
        result: input.result,
        environment: runtimeEnvironment(),
        releaseVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0-dev',
        buildId: import.meta.env.VITE_BUILD_ID ?? 'local',
        routeId: input.routeId,
        browserFamily: browserFamily(),
        online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
        errorCode: input.errorCode,
        stackFingerprint: safeStackFingerprint(error),
      });

      void transport.send(event).catch(() => {
        // O logger nunca deve causar uma segunda falha na aplicação.
      });

      return {
        eventId: event.eventId,
        incidentCode: event.incidentCode,
        correlationId: event.correlationId,
      };
    },
  };
}

export const safeLogger = createSafeLogger();
