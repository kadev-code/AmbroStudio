export type DesktopActionResult =
  | { status: 'success'; path: string }
  | { status: 'cancelled' };

export type DesktopAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: string;
};

export type DesktopAttachmentSelectionResult =
  | { status: 'success'; attachments: DesktopAttachment[] }
  | { status: 'cancelled' };

export type DesktopUpdateStatus =
  | 'not-configured'
  | 'development'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type DesktopUpdateState = {
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  downloadPercent?: number;
  errorCode?: string;
};

export type DesktopDiagnosticEvent = {
  eventId: string;
  incidentCode: string;
  correlationId: string;
  timestamp: string;
  severity: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  eventCode: string;
  module: string;
  operation: string;
  result: 'success' | 'failure';
  environment: 'development' | 'staging' | 'production';
  releaseVersion: string;
  buildId: string;
  routeId?: string;
  browserFamily?: string;
  online?: boolean;
  errorCode?: string;
  stackFingerprint?: string;
};

export type AmbroDesktopApi = {
  isDesktop: true;
  platform: NodeJS.Platform;
  storage: {
    read(key: string): string | null;
    write(key: string, serializedValue: string): void;
    writeMany(
      documents: Array<{ key: string; serializedValue: string }>,
    ): void;
    deleteClientData(
      documents: Array<{ key: string; serializedValue: string }>,
      attachmentIds: string[],
    ): void;
  };
  backup: {
    create(): Promise<DesktopActionResult>;
    restore(): Promise<DesktopActionResult>;
  };
  attachments: {
    add(maxFiles: number): Promise<DesktopAttachmentSelectionResult>;
    open(attachmentId: string): Promise<void>;
    remove(attachmentId: string): Promise<void>;
  };
  diagnostics: {
    record(event: DesktopDiagnosticEvent): void;
    export(): Promise<DesktopActionResult>;
  };
  updates: {
    getState(): Promise<DesktopUpdateState>;
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    onStateChange(listener: (state: DesktopUpdateState) => void): () => void;
  };
};

declare global {
  interface Window {
    ambroDesktop?: AmbroDesktopApi;
  }
}

export {};
