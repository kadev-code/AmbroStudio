import { Worker } from 'node:worker_threads';

type BackupWorkerResult =
  | { ok: true }
  | { ok: false; errorCode: string };

export function createBackupInBackground(
  databasePath: string,
  destinationPath: string,
) {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./backup-worker.js', import.meta.url), {
      execArgv: [],
      workerData: { databasePath, destinationPath },
    });
    let result: BackupWorkerResult | undefined;
    let finished = false;

    worker.once('message', (workerResult: BackupWorkerResult) => {
      result = workerResult;
    });
    worker.once('error', () => {
      if (finished) return;
      finished = true;
      reject(new Error('BACKUP_WORKER_FAILED'));
    });
    worker.once('exit', (code) => {
      if (finished) return;
      finished = true;
      if (code !== 0 || !result?.ok) {
        reject(
          new Error(
            result && !result.ok
              ? result.errorCode
              : `BACKUP_WORKER_EXITED_${code}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
