import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AmbroDesktopApi,
  DesktopActionResult,
  DesktopAttachmentSelectionResult,
  DesktopDiagnosticEvent,
  DesktopUpdateState,
} from '../src/infrastructure/desktop/desktop-api.js';

type SyncResult<T> = { ok: true; value: T } | { ok: false; errorCode: string };

function unwrap<T>(result: SyncResult<T>) {
  if (!result.ok) throw new Error(result.errorCode);
  return result.value;
}

async function invokeAndUnwrap<T>(channel: string, ...args: unknown[]) {
  return unwrap<T>(
    (await ipcRenderer.invoke(channel, ...args)) as SyncResult<T>,
  );
}

const api: AmbroDesktopApi = {
  isDesktop: true,
  platform: process.platform,
  storage: {
    read(key) {
      return unwrap<string | null>(ipcRenderer.sendSync('storage:read', key));
    },
    async write(key, serializedValue) {
      await invokeAndUnwrap<null>('storage:write', key, serializedValue);
    },
    async writeMany(documents) {
      await invokeAndUnwrap<null>('storage:write-many', documents);
    },
    async deleteClientData(documents, attachmentIds) {
      await invokeAndUnwrap<null>(
        'clients:delete-data',
        documents,
        attachmentIds,
      );
    },
  },
  backup: {
    create() {
      return ipcRenderer.invoke('backup:create') as Promise<DesktopActionResult>;
    },
    restore() {
      return ipcRenderer.invoke('backup:restore') as Promise<DesktopActionResult>;
    },
  },
  attachments: {
    add(maxFiles) {
      return ipcRenderer.invoke(
        'attachments:add',
        maxFiles,
      ) as Promise<DesktopAttachmentSelectionResult>;
    },
    open(attachmentId) {
      return ipcRenderer.invoke('attachments:open', attachmentId) as Promise<void>;
    },
    remove(attachmentId) {
      return ipcRenderer.invoke(
        'attachments:remove',
        attachmentId,
      ) as Promise<void>;
    },
  },
  diagnostics: {
    record(event: DesktopDiagnosticEvent) {
      ipcRenderer.send('diagnostics:record', event);
    },
    export() {
      return ipcRenderer.invoke('diagnostics:export') as Promise<DesktopActionResult>;
    },
  },
  updates: {
    getState() {
      return ipcRenderer.invoke('updates:get-state') as Promise<DesktopUpdateState>;
    },
    check() {
      return ipcRenderer.invoke('updates:check') as Promise<void>;
    },
    download() {
      return ipcRenderer.invoke('updates:download') as Promise<void>;
    },
    install() {
      return ipcRenderer.invoke('updates:install') as Promise<void>;
    },
    onStateChange(listener) {
      const handleStateChange = (
        _event: IpcRendererEvent,
        state: DesktopUpdateState,
      ) => listener(state);
      ipcRenderer.on('updates:state', handleStateChange);
      return () => ipcRenderer.removeListener('updates:state', handleStateChange);
    },
  },
};

contextBridge.exposeInMainWorld('ambroDesktop', api);
