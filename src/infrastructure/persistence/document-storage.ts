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
