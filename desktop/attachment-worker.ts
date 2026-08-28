import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { DesktopDatabase } from './database.js';

type AddAttachmentsWork = {
  operation: 'add';
  databasePath: string;
  filePaths: string[];
};

type CacheAttachmentWork = {
  operation: 'cache';
  databasePath: string;
  attachmentId: string;
  cacheDirectory: string;
};

type AttachmentWork = AddAttachmentsWork | CacheAttachmentWork;

function validatedWork(value: unknown): AttachmentWork {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_ATTACHMENT_WORK');
  }
  const candidate = value as Partial<AttachmentWork>;
  if (typeof candidate.databasePath !== 'string' || !candidate.databasePath) {
    throw new Error('INVALID_ATTACHMENT_WORK');
  }
  if (candidate.operation === 'add' && Array.isArray(candidate.filePaths)) {
    return {
      operation: 'add',
      databasePath: candidate.databasePath,
      filePaths: candidate.filePaths,
    };
  }
  if (
    candidate.operation === 'cache' &&
    typeof candidate.attachmentId === 'string' &&
    typeof candidate.cacheDirectory === 'string'
  ) {
    return {
      operation: 'cache',
      databasePath: candidate.databasePath,
      attachmentId: candidate.attachmentId,
      cacheDirectory: candidate.cacheDirectory,
    };
  }
  throw new Error('INVALID_ATTACHMENT_WORK');
}

let database: DesktopDatabase | undefined;
try {
  const work = validatedWork(workerData);
  if (work.operation === 'add') {
    database = new DesktopDatabase(work.databasePath);
    const attachments = database.addAttachments(work.filePaths);
    parentPort?.postMessage({ ok: true, attachments });
  } else {
    database = new DesktopDatabase(work.databasePath, { readOnly: true });
    const attachment = database.readAttachment(work.attachmentId);
    mkdirSync(work.cacheDirectory, { recursive: true });
    const cachedPath = join(
      work.cacheDirectory,
      `${attachment.metadata.id}${extname(attachment.metadata.fileName).toLowerCase()}`,
    );
    writeFileSync(cachedPath, attachment.content);
    parentPort?.postMessage({ ok: true, cachedPath });
  }
} catch {
  parentPort?.postMessage({ ok: false, errorCode: 'ATTACHMENT_WORKER_FAILED' });
  process.exitCode = 1;
} finally {
  database?.close();
}
