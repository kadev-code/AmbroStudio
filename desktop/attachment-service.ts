import { Worker } from 'node:worker_threads';
import type { StoredAttachment } from './database.js';

type AttachmentWorkerResult =
  | { ok: true; attachments: StoredAttachment[] }
  | { ok: true; cachedPath: string }
  | { ok: false; errorCode: string };

function runAttachmentWorker(workerData: object) {
  return new Promise<AttachmentWorkerResult>((resolve, reject) => {
    const worker = new Worker(new URL('./attachment-worker.js', import.meta.url), {
      execArgv: [],
      workerData,
    });
    let result: AttachmentWorkerResult | undefined;
    let finished = false;
    worker.once('message', (workerResult: AttachmentWorkerResult) => {
      result = workerResult;
    });
    worker.once('error', () => {
      if (finished) return;
      finished = true;
      reject(new Error('ATTACHMENT_WORKER_FAILED'));
    });
    worker.once('exit', (code) => {
      if (finished) return;
      finished = true;
      if (code !== 0 || !result?.ok) {
        reject(
          new Error(
            result && !result.ok
              ? result.errorCode
              : `ATTACHMENT_WORKER_EXITED_${code}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

export async function addAttachmentsInBackground(
  databasePath: string,
  filePaths: string[],
) {
  const result = await runAttachmentWorker({
    operation: 'add',
    databasePath,
    filePaths,
  });
  if (!('attachments' in result)) throw new Error('ATTACHMENTS_NOT_RETURNED');
  return result.attachments;
}

export async function cacheAttachmentInBackground(
  databasePath: string,
  attachmentId: string,
  cacheDirectory: string,
) {
  const result = await runAttachmentWorker({
    operation: 'cache',
    databasePath,
    attachmentId,
    cacheDirectory,
  });
  if (!('cachedPath' in result)) throw new Error('ATTACHMENT_PATH_NOT_RETURNED');
  return result.cachedPath;
}
