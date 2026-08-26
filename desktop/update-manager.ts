import { app } from 'electron';
import electronUpdater from 'electron-updater';
import type {
  DesktopUpdateState,
  DesktopUpdateStatus,
} from '../src/infrastructure/desktop/desktop-api.js';
import { isUpdateConfigured, updateConfig } from './update-config.js';

const { NsisUpdater } = electronUpdater;

type UpdateTechnicalEvent = {
  eventCode: string;
  operation: string;
  result: 'success' | 'failure';
  errorCode?: string;
};

type UpdateManagerOptions = {
  broadcast(state: DesktopUpdateState): void;
  beforeInstall(): void;
  recordTechnicalEvent(event: UpdateTechnicalEvent): void;
};

function safeVersion(value: unknown) {
  return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : undefined;
}

export class UpdateManager {
  private updater: InstanceType<typeof NsisUpdater> | undefined;
  private startupTimer: NodeJS.Timeout | undefined;
  private checkTimer: NodeJS.Timeout | undefined;
  private state: DesktopUpdateState;

  constructor(private readonly options: UpdateManagerOptions) {
    this.state = {
      status: !app.isPackaged
        ? 'development'
        : isUpdateConfigured()
          ? 'idle'
          : 'not-configured',
      currentVersion: app.getVersion(),
    };
  }

  initialize() {
    if (!app.isPackaged || !isUpdateConfigured()) {
      this.publishState(this.state.status);
      return;
    }

    const updater = new NsisUpdater({
      provider: 'github',
      owner: updateConfig.owner,
      repo: updateConfig.repository,
      private: false,
    });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.logger = null;
    updater.on('checking-for-update', () => {
      this.publishState('checking');
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_CHECK_STARTED',
        operation: 'check-update',
        result: 'success',
      });
    });
    updater.on('update-available', (info) => {
      this.publishState('available', {
        availableVersion: safeVersion(info.version),
      });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_AVAILABLE',
        operation: 'check-update',
        result: 'success',
      });
    });
    updater.on('update-not-available', () => {
      this.publishState('up-to-date');
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_NOT_AVAILABLE',
        operation: 'check-update',
        result: 'success',
      });
    });
    updater.on('download-progress', (progress) => {
      this.publishState('downloading', {
        availableVersion: this.state.availableVersion,
        downloadPercent: Math.max(0, Math.min(100, progress.percent)),
      });
    });
    updater.on('update-downloaded', (info) => {
      this.publishState('downloaded', {
        availableVersion: safeVersion(info.version),
        downloadPercent: 100,
      });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_DOWNLOADED',
        operation: 'download-update',
        result: 'success',
      });
    });
    updater.on('error', () => {
      this.publishState('error', { errorCode: 'UPDATE_OPERATION_FAILED' });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_OPERATION_FAILED',
        operation: 'update-application',
        result: 'failure',
        errorCode: 'UPDATE_OPERATION_FAILED',
      });
    });
    this.updater = updater;

    this.startupTimer = setTimeout(() => void this.check(), 15_000);
    this.checkTimer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
  }

  getState() {
    return this.state;
  }

  async check() {
    if (!this.updater || this.state.status === 'checking') return;
    try {
      await this.updater.checkForUpdates();
    } catch {
      this.publishState('error', { errorCode: 'UPDATE_CHECK_FAILED' });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_CHECK_FAILED',
        operation: 'check-update',
        result: 'failure',
        errorCode: 'UPDATE_CHECK_FAILED',
      });
    }
  }

  async download() {
    if (!this.updater || this.state.status !== 'available') return;
    this.publishState('downloading', {
      availableVersion: this.state.availableVersion,
      downloadPercent: 0,
    });
    this.options.recordTechnicalEvent({
      eventCode: 'UPDATE_DOWNLOAD_STARTED',
      operation: 'download-update',
      result: 'success',
    });
    try {
      await this.updater.downloadUpdate();
    } catch {
      this.publishState('error', { errorCode: 'UPDATE_DOWNLOAD_FAILED' });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_DOWNLOAD_FAILED',
        operation: 'download-update',
        result: 'failure',
        errorCode: 'UPDATE_DOWNLOAD_FAILED',
      });
    }
  }

  install() {
    if (!this.updater || this.state.status !== 'downloaded') return;
    try {
      this.options.beforeInstall();
    } catch {
      this.publishState('error', { errorCode: 'UPDATE_BACKUP_FAILED' });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_BACKUP_FAILED',
        operation: 'backup-before-update',
        result: 'failure',
        errorCode: 'UPDATE_BACKUP_FAILED',
      });
      return;
    }
    this.options.recordTechnicalEvent({
      eventCode: 'UPDATE_INSTALL_STARTED',
      operation: 'install-update',
      result: 'success',
    });
    try {
      this.updater.quitAndInstall(false, true);
    } catch {
      this.publishState('error', { errorCode: 'UPDATE_INSTALL_FAILED' });
      this.options.recordTechnicalEvent({
        eventCode: 'UPDATE_INSTALL_FAILED',
        operation: 'install-update',
        result: 'failure',
        errorCode: 'UPDATE_INSTALL_FAILED',
      });
    }
  }

  dispose() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  private publishState(
    status: DesktopUpdateStatus,
    details: Partial<DesktopUpdateState> = {},
  ) {
    this.state = {
      status,
      currentVersion: app.getVersion(),
      ...details,
    };
    this.options.broadcast(this.state);
  }
}
