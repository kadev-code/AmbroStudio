const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export function readStoredDocument(key: string) {
  if (typeof window === 'undefined') return null;

  try {
    const desktopValue = window.ambroDesktop?.storage.read(key);
    if (desktopValue !== undefined && desktopValue !== null) {
      return desktopValue;
    }

    const browserValue = window.localStorage.getItem(key);
    if (browserValue && window.ambroDesktop) {
      window.ambroDesktop.storage.write(key, browserValue);
    }
    return browserValue;
  } catch {
    return null;
  }
}

export function writeStoredDocument(key: string, serializedValue: string) {
  if (typeof window === 'undefined') return;
  if (new TextEncoder().encode(serializedValue).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('DOCUMENT_TOO_LARGE');
  }

  if (window.ambroDesktop) {
    window.ambroDesktop.storage.write(key, serializedValue);
    return;
  }

  window.localStorage.setItem(key, serializedValue);
}

export function writeStoredDocuments(
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
    window.ambroDesktop.storage.writeMany(documents);
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
