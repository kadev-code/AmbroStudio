import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AmbroDesktopApi } from '../desktop/desktop-api';
import {
  writeStoredDocument,
  writeStoredDocuments,
} from './document-storage';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window',
);

function installDesktopStorage(
  storage: AmbroDesktopApi['storage'],
) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      ambroDesktop: {
        isDesktop: true,
        platform: 'win32',
        storage,
      },
    },
  });
}

function storageWith(
  overrides: Partial<AmbroDesktopApi['storage']>,
): AmbroDesktopApi['storage'] {
  return {
    read: () => null,
    write: async () => undefined,
    writeMany: async () => undefined,
    deleteClientData: async () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

describe('document storage desktop queue', () => {
  it('preserva a ordem das gravações assíncronas', async () => {
    const events: string[] = [];
    let releaseFirstWrite: () => void = () => undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    installDesktopStorage(
      storageWith({
        write: vi.fn(async (key) => {
          events.push(`start:${key}`);
          if (key === 'first') await firstWriteBlocked;
          events.push(`end:${key}`);
        }),
      }),
    );

    const first = writeStoredDocument('first', '{}');
    const second = writeStoredDocument('second', '{}');
    await vi.waitFor(() => expect(events).toEqual(['start:first']));

    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ]);
  });

  it('continua a fila depois de uma falha e mantém lotes atômicos', async () => {
    const events: string[] = [];
    installDesktopStorage(
      storageWith({
        write: vi.fn(async (key) => {
          events.push(`write:${key}`);
          if (key === 'failed') throw new Error('WRITE_FAILED');
        }),
        writeMany: vi.fn(async (
          documents: Array<{ key: string; serializedValue: string }>,
        ) => {
          events.push(`batch:${documents.map(({ key }) => key).join(',')}`);
        }),
      }),
    );

    await expect(writeStoredDocument('failed', '{}')).rejects.toThrow(
      'WRITE_FAILED',
    );
    await writeStoredDocuments([
      { key: 'clients', serializedValue: '[]' },
      { key: 'production', serializedValue: '[]' },
    ]);

    expect(events).toEqual([
      'write:failed',
      'batch:clients,production',
    ]);
  });
});
