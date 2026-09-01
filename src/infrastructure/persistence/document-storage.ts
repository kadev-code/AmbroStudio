const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

let desktopWriteQueue = Promise.resolve();

function enqueueDesktopWrite(action: () => Promise<void>) {
  const pendingWrite = desktopWriteQueue.then(action, action);
  desktopWriteQueue = pendingWrite.catch(() => undefined);
  return pendingWrite;
}

export function readStoredDocument(key: string) {
  if (typeof window === 'undefined') return null;

  try {
    const desktopValue = window.ambroDesktop?.storage.read(key);
    if (desktopValue !== undefined && desktopValue !== null) {
      return desktopValue;
    }

    const browserValue = window.localStorage.getItem(key);
    if (browserValue && window.ambroDesktop) {
      void writeStoredDocument(key, browserValue).catch(() => undefined);
    }
    return browserValue;
  } catch {
    return null;
  }
}

export async function writeStoredDocument(key: string, serializedValue: string) {
  if (typeof window === 'undefined') return;
  if (new TextEncoder().encode(serializedValue).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('DOCUMENT_TOO_LARGE');
  }

  if (window.ambroDesktop) {
    await enqueueDesktopWrite(() =>
      window.ambroDesktop!.storage.write(key, serializedValue),
    );
    return;
  }

  window.localStorage.setItem(key, serializedValue);
}

export async function writeStoredDocuments(
  documents: Array<{ key: string; serializedValue: string }>,
) {
  if (typeof window === 'undefined') return;
  if (documents.length < 1 || documents.length > 20) {
    throw new Error('INVALID_DOCUMENT_BATCH');
  }
  for (const document of documents) {
    if (
      new TextEncoder().encode(document.serializedValue).byteLength >
      MAX_DOCUMENT_BYTES
    ) {
      throw new Error('DOCUMENT_TOO_LARGE');
    }
  }

  if (window.ambroDesktop) {
    await enqueueDesktopWrite(() =>
      window.ambroDesktop!.storage.writeMany(documents),
    );
    return;
  }

  const previousValues = documents.map((document) => ({
    key: document.key,
    value: window.localStorage.getItem(document.key),
  }));
  try {
    for (const document of documents) {
      window.localStorage.setItem(document.key, document.serializedValue);
    }
  } catch (error) {
    for (const previous of previousValues) {
      if (previous.value === null) {
        window.localStorage.removeItem(previous.key);
      } else {
        window.localStorage.setItem(previous.key, previous.value);
      }
    }
    throw error;
  }
}

export async function writeStoredDocumentsAndRemoveAttachments(
  documents: Array<{ key: string; serializedValue: string }>,
  attachmentIds: string[],
) {
  if (typeof window === 'undefined') return;
  if (window.ambroDesktop) {
    await enqueueDesktopWrite(() =>
      window.ambroDesktop!.storage.deleteClientData(documents, attachmentIds),
    );
    return;
  }

  await writeStoredDocuments(documents);
}
