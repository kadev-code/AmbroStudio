import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopUpdateState } from '../src/infrastructure/desktop/desktop-api.js';
import {
  addAttachmentsInBackground,
  cacheAttachmentInBackground,
} from './attachment-service.js';
import { createBackupInBackground } from './backup-service.js';
import { DesktopDatabase } from './database.js';
import { UpdateManager } from './update-manager.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(currentDirectory, '..', '..');
const developmentUrl = process.argv
  .find((argument) => argument.startsWith('--dev-url='))
  ?.slice('--dev-url='.length);
const smokeTest = process.argv.includes('--smoke-test');

if (smokeTest) app.disableHardwareAcceleration();

let database: DesktopDatabase;
let updateManager: UpdateManager | undefined;
let automaticBackupTimer: NodeJS.Timeout | undefined;
let automaticBackupPromise: Promise<void> | undefined;

function attachmentCacheDirectory() {
  return join(app.getPath('temp'), 'AmbroStudio');
}

function smokeDatabasePath() {
  return join(app.getPath('temp'), `ambro-studio-smoke-${process.pid}.sqlite`);
}

function isExpectedSmokeDatabasePath(path: string) {
  return (
    dirname(resolve(path)) === resolve(app.getPath('temp')) &&
    basename(path).startsWith('ambro-studio-smoke-') &&
    basename(path).endsWith('.sqlite')
  );
}

async function clearAttachmentCache() {
  try {
    await rm(attachmentCacheDirectory(), { recursive: true, force: true });
  } catch {
    // Um visualizador externo pode manter o arquivo aberto até o próximo início.
  }
}

async function writeAutomaticBackup() {
  const backupDirectory = join(app.getPath('userData'), 'backups');
  const weekday = new Date().getDay();
  await createBackupInBackground(
    database.path,
    join(backupDirectory, `ambro-studio-auto-${weekday}.ambrobackup`),
  );
}

function createAutomaticBackup() {
  if (automaticBackupPromise) return;
  automaticBackupPromise = writeAutomaticBackup()
    .catch(() => {
      recordAppTechnicalEvent({
        eventCode: 'AUTOMATIC_BACKUP_FAILED',
        operation: 'create-automatic-backup',
        result: 'failure',
        errorCode: 'BACKGROUND_BACKUP_FAILED',
      });
    })
    .finally(() => {
      automaticBackupPromise = undefined;
    });
}

function actionResult<T>(action: () => T) {
  try {
    return { ok: true as const, value: action() };
  } catch (error) {
    return {
      ok: false as const,
      errorCode: error instanceof Error ? error.message : 'DESKTOP_OPERATION_FAILED',
    };
  }
}

function timedActionResult<T>(operation: string, action: () => T) {
  const startedAt = performance.now();
  const result = actionResult(action);
  if (performance.now() - startedAt >= 250) {
    recordAppTechnicalEvent({
      eventCode: 'SLOW_DESKTOP_OPERATION',
      operation,
      result: 'failure',
      errorCode: 'DESKTOP_OPERATION_OVER_250MS',
    });
  }
  return result;
}

function broadcastUpdateState(state: DesktopUpdateState) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:state', state);
  }
}

function recordAppTechnicalEvent(event: {
  eventCode: string;
  operation: string;
  result: 'success' | 'failure';
  errorCode?: string;
}) {
  try {
    const eventId = randomUUID();
    database.recordDiagnostic({
      eventId,
      incidentCode: `AMB-${eventId.replaceAll('-', '').slice(-5).toUpperCase()}`,
      correlationId: randomUUID(),
      timestamp: new Date().toISOString(),
      severity: event.result === 'failure' ? 'error' : 'info',
      eventCode: event.eventCode,
      module: 'app',
      operation: event.operation,
      result: event.result,
      environment: 'production',
      releaseVersion: app.getVersion(),
      buildId: app.getVersion(),
      errorCode: event.errorCode,
    });
  } catch {
    // O diagnóstico da atualização nunca deve causar uma segunda falha.
  }
}

function registerIpc() {
  ipcMain.on('storage:read', (event, key: unknown) => {
    event.returnValue = timedActionResult('read-local-document', () =>
      database.readDocument(key),
    );
  });
  ipcMain.on('storage:write', (event, key: unknown, value: unknown) => {
    event.returnValue = timedActionResult('write-local-document', () => {
      database.writeDocument(key, value);
      return null;
    });
  });
  ipcMain.on('storage:write-many', (event, documents: unknown) => {
    event.returnValue = timedActionResult('write-local-documents', () => {
      database.writeDocuments(documents);
      return null;
    });
  });
  ipcMain.on(
    'clients:delete-data',
    (event, documents: unknown, attachmentIds: unknown) => {
      event.returnValue = timedActionResult('delete-client-data', () => {
        database.deleteClientData(documents, attachmentIds);
        return null;
      });
    },
  );
  ipcMain.on('diagnostics:record', (_event, diagnosticEvent: unknown) => {
    try {
      database.recordDiagnostic(diagnosticEvent);
    } catch {
      // O diagnóstico nunca deve causar uma segunda falha.
    }
  });

  ipcMain.handle('attachments:add', async (_event, requestedMaximum: unknown) => {
    const maximumFiles =
      typeof requestedMaximum === 'number' &&
      Number.isInteger(requestedMaximum) &&
      requestedMaximum > 0
        ? Math.min(requestedMaximum, 10)
        : 1;
    const selection = await dialog.showOpenDialog({
      title: 'Adicionar anexos à negociação',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documentos e imagens',
          extensions: [
            'pdf',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'doc',
            'docx',
            'xls',
            'xlsx',
            'txt',
          ],
        },
      ],
    });
    if (selection.canceled || !selection.filePaths.length) {
      return { status: 'cancelled' };
    }
    if (selection.filePaths.length > maximumFiles) {
      throw new Error('TOO_MANY_ATTACHMENTS_SELECTED');
    }
    return {
      status: 'success',
      attachments: await addAttachmentsInBackground(
        database.path,
        selection.filePaths,
      ),
    };
  });

  ipcMain.handle('attachments:open', async (_event, attachmentId: unknown) => {
    if (typeof attachmentId !== 'string') {
      throw new Error('INVALID_ATTACHMENT_ID');
    }
    const cachedPath = await cacheAttachmentInBackground(
      database.path,
      attachmentId,
      attachmentCacheDirectory(),
    );
    const openError = await shell.openPath(cachedPath);
    if (openError) throw new Error('ATTACHMENT_OPEN_FAILED');
  });

  ipcMain.handle('attachments:remove', (_event, attachmentId: unknown) => {
    database.removeAttachment(attachmentId);
  });

  ipcMain.handle('backup:create', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const selection = await dialog.showSaveDialog({
      title: 'Salvar backup do Ambro Studio',
      defaultPath: `Ambro-Studio-Backup-${date}.ambrobackup`,
      filters: [{ name: 'Backup Ambro Studio', extensions: ['ambrobackup'] }],
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    await createBackupInBackground(database.path, selection.filePath);
    return { status: 'success', path: selection.filePath };
  });

  ipcMain.handle('backup:restore', async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Restaurar backup do Ambro Studio',
      properties: ['openFile'],
      filters: [{ name: 'Backup Ambro Studio', extensions: ['ambrobackup'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' };
    database.restoreBackup(selection.filePaths[0]);
    return { status: 'success', path: selection.filePaths[0] };
  });

  ipcMain.handle('diagnostics:export', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const selection = await dialog.showSaveDialog({
      title: 'Exportar diagnóstico técnico',
      defaultPath: `Ambro-Studio-Diagnostico-${date}.json`,
      filters: [{ name: 'Diagnóstico JSON', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' };
    database.exportDiagnostics(selection.filePath);
    return { status: 'success', path: selection.filePath };
  });

  ipcMain.handle('updates:get-state', () => updateManager?.getState());
  ipcMain.handle('updates:check', () => updateManager?.check());
  ipcMain.handle('updates:download', () => updateManager?.download());
  ipcMain.handle('updates:install', () => updateManager?.install());
}

async function createWindow() {
  let rendererUnresponsive = false;
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f7f2ea',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(currentDirectory, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const allowedUrl = developmentUrl ?? `file://${join(projectRoot, 'dist', 'index.html')}`;
    if (!url.startsWith(allowedUrl)) event.preventDefault();
  });
  if (!smokeTest) window.once('ready-to-show', () => window.show());
  window.on('unresponsive', () => {
    if (rendererUnresponsive) return;
    rendererUnresponsive = true;
    recordAppTechnicalEvent({
      eventCode: 'WINDOW_UNRESPONSIVE',
      operation: 'monitor-window-responsiveness',
      result: 'failure',
      errorCode: 'RENDERER_NOT_RESPONDING',
    });
  });
  window.on('responsive', () => {
    if (!rendererUnresponsive) return;
    rendererUnresponsive = false;
    recordAppTechnicalEvent({
      eventCode: 'WINDOW_RESPONSIVE_AGAIN',
      operation: 'monitor-window-responsiveness',
      result: 'success',
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    recordAppTechnicalEvent({
      eventCode: 'RENDER_PROCESS_GONE',
      operation: 'monitor-render-process',
      result: 'failure',
      errorCode: `RENDERER_${details.reason.replaceAll('-', '_').toUpperCase()}`,
    });
  });

  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(join(projectRoot, 'dist', 'index.html'));
  }

  if (smokeTest) {
    const rendererReady = await window.webContents.executeJavaScript(
      "Boolean(window.ambroDesktop?.isDesktop && document.querySelector('main'))",
    );
    if (!rendererReady) throw new Error('DESKTOP_RENDERER_NOT_READY');
    const smokeBackupPath = `${database.path}.ambrobackup`;
    await createBackupInBackground(database.path, smokeBackupPath);
    if (isExpectedSmokeDatabasePath(database.path)) {
      rmSync(smokeBackupPath, { force: true });
    }
    app.quit();
  }
}

app.whenReady().then(async () => {
  await clearAttachmentCache();
  database = new DesktopDatabase(
    smokeTest
      ? smokeDatabasePath()
      : join(app.getPath('userData'), 'ambro-studio.sqlite'),
  );
  updateManager = new UpdateManager({
    broadcast: broadcastUpdateState,
    beforeInstall: writeAutomaticBackup,
    recordTechnicalEvent: recordAppTechnicalEvent,
  });
  if (!smokeTest) {
    createAutomaticBackup();
    automaticBackupTimer = setInterval(createAutomaticBackup, 15 * 60 * 1000);
  }
  registerIpc();
  await createWindow();
  if (!smokeTest) updateManager.initialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch(() => app.exit(1));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  updateManager?.dispose();
  if (automaticBackupTimer) clearInterval(automaticBackupTimer);
  const databasePath = database?.path;
  database?.close();
  if (smokeTest && databasePath && isExpectedSmokeDatabasePath(databasePath)) {
    for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      rmSync(path, { force: true });
    }
  }
  void clearAttachmentCache();
});
