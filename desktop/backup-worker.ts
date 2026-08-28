import { parentPort, workerData } from 'node:worker_threads';
import { DesktopDatabase } from './database.js';

type BackupWorkerData = {
  databasePath: string;
  destinationPath: string;
};

function safeWorkerData(value: unknown): BackupWorkerData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_BACKUP_WORKER_DATA');
  }
  const candidate = value as Partial<BackupWorkerData>;
  if (
    typeof candidate.databasePath !== 'string' ||
    !candidate.databasePath ||
    typeof candidate.destinationPath !== 'string' ||
    !candidate.destinationPath
  ) {
    throw new Error('INVALID_BACKUP_WORKER_DATA');
  }
  return {
    databasePath: candidate.databasePath,
    destinationPath: candidate.destinationPath,
  };
}

let database: DesktopDatabase | undefined;
try {
  const data = safeWorkerData(workerData);
  database = new DesktopDatabase(data.databasePath, { readOnly: true });
  database.createBackup(data.destinationPath);
  parentPort?.postMessage({ ok: true });
} catch {
  parentPort?.postMessage({ ok: false, errorCode: 'BACKUP_WORKER_FAILED' });
  process.exitCode = 1;
} finally {
  database?.close();
}
