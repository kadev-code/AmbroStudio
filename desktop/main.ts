import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopUpdateState } from '../src/infrastructure/desktop/desktop-api.js';
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

function attachmentCacheDirectory() {
  return join(app.getPath('temp'), 'AmbroStudio');
}

function clearAttachmentCache() {
  try {
    rmSync(attachmentCacheDirectory(), { recursive: true, force: true });
  } catch {
    // Um visualizador externo pode manter o arquivo aberto até o próximo início.
  }
}

function writeAutomaticBackup() {
  const backupDirectory = join(app.getPath('userData'), 'backups');
  const weekday = new Date().getDay();
  database.createBackup(
    join(backupDirectory, `ambro-studio-auto-${weekday}.ambrobackup`),
  );
}

function createAutomaticBackup() {
  try {
    writeAutomaticBackup();
  } catch {
    // A operação continua; a pessoa usuária ainda pode gerar um backup manual.
  }
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

function broadcastUpdateState(state: DesktopUpdateState) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:state', state);
  }
}

function recordUpdateTechnicalEvent(event: {
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
    event.returnValue = actionResult(() => database.readDocument(key));
  });
  ipcMain.on('storage:write', (event, key: unknown, value: unknown) => {
    event.returnValue = actionResult(() => {
      database.writeDocument(key, value);
      return null;
    });
  });
  ipcMain.on('storage:write-many', (event, documents: unknown) => {
    event.returnValue = actionResult(() => {
      database.writeDocuments(documents);
      return null;
    });
  });
  ipcMain.on(
    'clients:delete-data',
    (event, documents: unknown, attachmentIds: unknown) => {
      event.returnValue = actionResult(() => {
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
      attachments: database.addAttachments(selection.filePaths),
    };
  });

  ipcMain.handle('attachments:open', async (_event, attachmentId: unknown) => {
    const attachment = database.readAttachment(attachmentId);
    const cacheDirectory = attachmentCacheDirectory();
    mkdirSync(cacheDirectory, { recursive: true });
    const cachedPath = join(
      cacheDirectory,
      `${attachment.metadata.id}${extname(attachment.metadata.fileName).toLowerCase()}`,
    );
    writeFileSync(cachedPath, attachment.content);
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
    database.createBackup(selection.filePath);
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
    app.quit();
  }
}

app.whenReady().then(async () => {
  clearAttachmentCache();
  database = new DesktopDatabase(
    smokeTest ? ':memory:' : join(app.getPath('userData'), 'ambro-studio.sqlite'),
  );
  updateManager = new UpdateManager({
    broadcast: broadcastUpdateState,
    beforeInstall: writeAutomaticBackup,
    recordTechnicalEvent: recordUpdateTechnicalEvent,
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
  if (!smokeTest) createAutomaticBackup();
  database?.close();
  clearAttachmentCache();
});
