import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const allowedDocumentKeys = new Set([
  'ambro-studio:client-drafts:v1',
  'ambro-studio:production-drafts:v1',
  'ambro-studio:pricing-product-drafts:v1',
  'ambro-studio:pricing-materials:v1',
]);

const maximumDocumentBytes = 10 * 1024 * 1024;
const maximumAttachmentBytes = 25 * 1024 * 1024;
const maximumBackupBytes = 350 * 1024 * 1024;
const allowedAttachmentExtensions = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
]);

const attachmentMimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
};

export type StoredAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: string;
};

type BackupAttachment = StoredAttachment & { contentBase64: string };

type BackupFile = {
  format: 'ambro-studio-backup';
  version: 1 | 2;
  createdAt: string;
  documents: Record<string, unknown>;
  attachments?: BackupAttachment[];
};

type SafeStoredDiagnosticEvent = Record<string, unknown> & {
  eventId: string;
  incidentCode: string;
  timestamp: string;
  eventCode: string;
  module: string;
  operation: string;
  result: 'success' | 'failure';
};

function assertDocumentKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !allowedDocumentKeys.has(key)) {
    throw new Error('INVALID_DOCUMENT_KEY');
  }
}

function validateSerializedDocument(value: unknown) {
  if (typeof value !== 'string') throw new Error('INVALID_DOCUMENT_VALUE');
  if (Buffer.byteLength(value, 'utf8') > maximumDocumentBytes) {
    throw new Error('DOCUMENT_TOO_LARGE');
  }
  JSON.parse(value);
  return value;
}

function validateDocumentBatch(documents: unknown) {
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > 20) {
    throw new Error('INVALID_DOCUMENT_BATCH');
  }

  const validatedDocuments = documents.map((document) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error('INVALID_DOCUMENT_BATCH');
    }
    const candidate = document as {
      key?: unknown;
      serializedValue?: unknown;
    };
    assertDocumentKey(candidate.key);
    return {
      key: candidate.key,
      serializedValue: validateSerializedDocument(candidate.serializedValue),
    };
  });
  if (
    new Set(validatedDocuments.map((document) => document.key)).size !==
    validatedDocuments.length
  ) {
    throw new Error('DUPLICATED_DOCUMENT_KEY');
  }
  return validatedDocuments;
}

function assertAttachmentId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error('INVALID_ATTACHMENT_ID');
  }
}

function validateBackupAttachment(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_BACKUP_ATTACHMENT');
  }
  const attachment = value as Partial<BackupAttachment>;
  assertAttachmentId(attachment.id);
  if (
    typeof attachment.fileName !== 'string' ||
    !attachment.fileName.trim() ||
    attachment.fileName.length > 180 ||
    typeof attachment.mimeType !== 'string' ||
    attachment.mimeType.length > 100 ||
    !Number.isInteger(attachment.sizeBytes) ||
    !attachment.sizeBytes ||
    attachment.sizeBytes > maximumAttachmentBytes ||
    typeof attachment.addedAt !== 'string' ||
    !Number.isFinite(Date.parse(attachment.addedAt)) ||
    typeof attachment.contentBase64 !== 'string'
  ) {
    throw new Error('INVALID_BACKUP_ATTACHMENT');
  }
  const extension = extname(attachment.fileName).toLowerCase();
  if (
    !allowedAttachmentExtensions.has(extension) ||
    attachment.mimeType !== attachmentMimeTypes[extension]
  ) {
    throw new Error('INVALID_BACKUP_ATTACHMENT');
  }
  const content = Buffer.from(attachment.contentBase64, 'base64');
  if (content.byteLength !== attachment.sizeBytes) {
    throw new Error('INVALID_BACKUP_ATTACHMENT');
  }
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    addedAt: attachment.addedAt,
    content,
  };
}

function isSafeDiagnosticEvent(value: unknown): value is SafeStoredDiagnosticEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'eventId',
    'incidentCode',
    'correlationId',
    'timestamp',
    'severity',
    'eventCode',
    'module',
    'operation',
    'result',
    'environment',
    'releaseVersion',
    'buildId',
    'routeId',
    'browserFamily',
    'online',
    'errorCode',
    'stackFingerprint',
  ]);

  return (
    Object.keys(event).every((key) => allowedKeys.has(key)) &&
    typeof event.eventId === 'string' &&
    typeof event.incidentCode === 'string' &&
    /^AMB-[A-Z0-9]{5}$/.test(event.incidentCode) &&
    typeof event.timestamp === 'string' &&
    typeof event.eventCode === 'string' &&
    typeof event.module === 'string' &&
    typeof event.operation === 'string' &&
    (event.result === 'success' || event.result === 'failure')
  );
}

export class DesktopDatabase {
  private readonly database: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_documents (
        document_key TEXT PRIMARY KEY,
        document_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagnostic_events (
        event_id TEXT PRIMARY KEY,
        incident_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS negotiation_attachments (
        attachment_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        content BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS diagnostic_events_incident_code
        ON diagnostic_events (incident_code);
      PRAGMA user_version = 2;
    `);
  }

  readDocument(key: unknown) {
    assertDocumentKey(key);
    const row = this.database
      .prepare('SELECT document_value FROM app_documents WHERE document_key = ?')
      .get(key) as { document_value: string } | undefined;
    return row?.document_value ?? null;
  }

  writeDocument(key: unknown, serializedValue: unknown) {
    assertDocumentKey(key);
    const validatedValue = validateSerializedDocument(serializedValue);
    this.database
      .prepare(`
        INSERT INTO app_documents (document_key, document_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(document_key) DO UPDATE SET
          document_value = excluded.document_value,
          updated_at = excluded.updated_at
      `)
      .run(key, validatedValue, new Date().toISOString());
  }

  writeDocuments(documents: unknown) {
    const validatedDocuments = validateDocumentBatch(documents);

    const statement = this.database.prepare(`
      INSERT INTO app_documents (document_key, document_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(document_key) DO UPDATE SET
        document_value = excluded.document_value,
        updated_at = excluded.updated_at
    `);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const timestamp = new Date().toISOString();
      for (const document of validatedDocuments) {
        statement.run(document.key, document.serializedValue, timestamp);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteClientData(documents: unknown, attachmentIds: unknown) {
    const validatedDocuments = validateDocumentBatch(documents);
    const expectedKeys = new Set([
      'ambro-studio:client-drafts:v1',
      'ambro-studio:production-drafts:v1',
    ]);
    if (
      validatedDocuments.length !== expectedKeys.size ||
      validatedDocuments.some((document) => !expectedKeys.has(document.key))
    ) {
      throw new Error('INVALID_CLIENT_DELETION_DOCUMENTS');
    }
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 10_000) {
      throw new Error('INVALID_ATTACHMENT_IDS');
    }
    for (const attachmentId of attachmentIds) assertAttachmentId(attachmentId);
    const uniqueAttachmentIds = [...new Set(attachmentIds as string[])];

    const documentStatement = this.database.prepare(`
      INSERT INTO app_documents (document_key, document_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(document_key) DO UPDATE SET
        document_value = excluded.document_value,
        updated_at = excluded.updated_at
    `);
    const attachmentStatement = this.database.prepare(
      'DELETE FROM negotiation_attachments WHERE attachment_id = ?',
    );
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const timestamp = new Date().toISOString();
      for (const document of validatedDocuments) {
        documentStatement.run(document.key, document.serializedValue, timestamp);
      }
      for (const attachmentId of uniqueAttachmentIds) {
        attachmentStatement.run(attachmentId);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  recordDiagnostic(event: unknown) {
    if (!isSafeDiagnosticEvent(event)) throw new Error('INVALID_DIAGNOSTIC_EVENT');
    const serialized = JSON.stringify(event);
    if (Buffer.byteLength(serialized, 'utf8') > 32 * 1024) {
      throw new Error('DIAGNOSTIC_EVENT_TOO_LARGE');
    }
    this.database
      .prepare(`
        INSERT OR IGNORE INTO diagnostic_events
          (event_id, incident_code, created_at, event_json)
        VALUES (?, ?, ?, ?)
      `)
      .run(event.eventId, event.incidentCode, event.timestamp, serialized);
  }

  addAttachments(filePaths: string[]) {
    if (!filePaths.length || filePaths.length > 10) {
      throw new Error('INVALID_ATTACHMENT_SELECTION');
    }
    const prepared = filePaths.map((filePath) => {
      const extension = extname(filePath).toLowerCase();
      if (!allowedAttachmentExtensions.has(extension)) {
        throw new Error('ATTACHMENT_TYPE_NOT_ALLOWED');
      }
      const sizeBytes = statSync(filePath).size;
      if (sizeBytes <= 0 || sizeBytes > maximumAttachmentBytes) {
        throw new Error('ATTACHMENT_SIZE_NOT_ALLOWED');
      }
      const content = readFileSync(filePath);
      const fileName = basename(filePath).trim();
      if (!fileName || fileName.length > 180) {
        throw new Error('INVALID_ATTACHMENT_NAME');
      }
      return {
        id: randomUUID(),
        fileName,
        mimeType: attachmentMimeTypes[extension] ?? 'application/octet-stream',
        sizeBytes,
        addedAt: new Date().toISOString(),
        content,
      };
    });

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.database.prepare(`
        INSERT INTO negotiation_attachments
          (attachment_id, file_name, mime_type, size_bytes, added_at, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const attachment of prepared) {
        statement.run(
          attachment.id,
          attachment.fileName,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.addedAt,
          attachment.content,
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return prepared.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      addedAt: attachment.addedAt,
    }));
  }

  readAttachment(attachmentId: unknown) {
    assertAttachmentId(attachmentId);
    const row = this.database
      .prepare(`
        SELECT attachment_id, file_name, mime_type, size_bytes, added_at, content
        FROM negotiation_attachments
        WHERE attachment_id = ?
      `)
      .get(attachmentId) as
      | {
          attachment_id: string;
          file_name: string;
          mime_type: string;
          size_bytes: number;
          added_at: string;
          content: Uint8Array;
        }
      | undefined;
    if (!row) throw new Error('ATTACHMENT_NOT_FOUND');
    return {
      metadata: {
        id: row.attachment_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        addedAt: row.added_at,
      },
      content: Buffer.from(row.content),
    };
  }

  removeAttachment(attachmentId: unknown) {
    assertAttachmentId(attachmentId);
    this.database
      .prepare('DELETE FROM negotiation_attachments WHERE attachment_id = ?')
      .run(attachmentId);
  }

  createBackup(destination: string) {
    mkdirSync(dirname(destination), { recursive: true });
    const rows = this.database
      .prepare('SELECT document_key, document_value FROM app_documents ORDER BY document_key')
      .all() as Array<{ document_key: string; document_value: string }>;
    const attachmentRows = this.database
      .prepare(`
        SELECT attachment_id, file_name, mime_type, size_bytes, added_at, content
        FROM negotiation_attachments
        ORDER BY added_at
      `)
      .all() as Array<{
      attachment_id: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      added_at: string;
      content: Uint8Array;
    }>;
    const backup: BackupFile = {
      format: 'ambro-studio-backup',
      version: 2,
      createdAt: new Date().toISOString(),
      documents: Object.fromEntries(
        rows.map((row) => [row.document_key, JSON.parse(row.document_value)]),
      ),
      attachments: attachmentRows.map((row) => ({
        id: row.attachment_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        addedAt: row.added_at,
        contentBase64: Buffer.from(row.content).toString('base64'),
      })),
    };
    writeFileSync(destination, JSON.stringify(backup, null, 2), 'utf8');
  }

  restoreBackup(source: string) {
    const raw = readFileSync(source, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > maximumBackupBytes) {
      throw new Error('BACKUP_TOO_LARGE');
    }
    const parsed = JSON.parse(raw) as Partial<BackupFile>;
    if (
      parsed.format !== 'ambro-studio-backup' ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !parsed.documents ||
      typeof parsed.documents !== 'object' ||
      Array.isArray(parsed.documents)
    ) {
      throw new Error('INVALID_BACKUP');
    }

    const documents = Object.entries(parsed.documents).map(([key, value]) => {
      assertDocumentKey(key);
      return [key, validateSerializedDocument(JSON.stringify(value))] as const;
    });
    const attachments = (parsed.attachments ?? []).map(
      validateBackupAttachment,
    );
    const totalAttachmentBytes = attachments.reduce(
      (total, attachment) => total + attachment.sizeBytes,
      0,
    );
    if (totalAttachmentBytes > 250 * 1024 * 1024) {
      throw new Error('BACKUP_ATTACHMENTS_TOO_LARGE');
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('DELETE FROM app_documents');
      this.database.exec('DELETE FROM negotiation_attachments');
      for (const [key, value] of documents) {
        this.writeDocument(key, value);
      }
      const attachmentStatement = this.database.prepare(`
        INSERT INTO negotiation_attachments
          (attachment_id, file_name, mime_type, size_bytes, added_at, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const attachment of attachments) {
        attachmentStatement.run(
          attachment.id,
          attachment.fileName,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.addedAt,
          attachment.content,
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  exportDiagnostics(destination: string) {
    const rows = this.database
      .prepare('SELECT event_json FROM diagnostic_events ORDER BY created_at DESC LIMIT 5000')
      .all() as Array<{ event_json: string }>;
    writeFileSync(
      destination,
      JSON.stringify(
        {
          format: 'ambro-studio-diagnostics',
          version: 1,
          exportedAt: new Date().toISOString(),
          events: rows.map((row) => JSON.parse(row.event_json)),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  close() {
    this.database.close();
  }
}
