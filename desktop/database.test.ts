import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopDatabase } from './database.js';

const temporaryDirectories: string[] = [];

function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'ambro-studio-db-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    database: new DesktopDatabase(join(directory, 'test.sqlite')),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('desktop database', () => {
  it('abre e preserva um banco da versão anterior sem recriar os documentos', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ambro-studio-db-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'legacy.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE app_documents (
        document_key TEXT PRIMARY KEY,
        document_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE diagnostic_events (
        event_id TEXT PRIMARY KEY,
        incident_code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE negotiation_attachments (
        attachment_id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        content BLOB NOT NULL
      );
      PRAGMA user_version = 2;
    `);
    legacy
      .prepare(`
        INSERT INTO app_documents (document_key, document_value, updated_at)
        VALUES (?, ?, ?)
      `)
      .run(
        'ambro-studio:client-drafts:v1',
        '[{"id":"cadastro-preservado"}]',
        '2026-08-26T12:00:00.000Z',
      );
    legacy.close();

    const migrated = new DesktopDatabase(databasePath);

    expect(
      migrated.readDocument('ambro-studio:client-drafts:v1'),
    ).toContain('cadastro-preservado');
    migrated.close();
    const inspected = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      inspected.prepare('PRAGMA user_version').get(),
    ).toMatchObject({ user_version: 3 });
    inspected.close();
  });

  it('persiste somente documentos autorizados', () => {
    const { database } = createTestDatabase();
    const key = 'ambro-studio:client-drafts:v1';
    database.writeDocument(key, '[{"id":"teste"}]');

    expect(database.readDocument(key)).toBe('[{"id":"teste"}]');
    expect(() => database.writeDocument('chave-livre', '{}')).toThrow(
      'INVALID_DOCUMENT_KEY',
    );
    database.close();
  });

  it('atualiza vários documentos na mesma transação', () => {
    const { database } = createTestDatabase();
    const clientsKey = 'ambro-studio:client-drafts:v1';
    const productionKey = 'ambro-studio:production-drafts:v1';
    database.writeDocuments([
      { key: clientsKey, serializedValue: '[{"status":"Concluída"}]' },
      { key: productionKey, serializedValue: '[{"archived":true}]' },
    ]);

    expect(database.readDocument(clientsKey)).toContain('Concluída');
    expect(database.readDocument(productionKey)).toContain('archived');
    expect(() =>
      database.writeDocuments([
        { key: clientsKey, serializedValue: '[]' },
        { key: 'chave-livre', serializedValue: '[]' },
      ]),
    ).toThrow('INVALID_DOCUMENT_KEY');
    expect(database.readDocument(clientsKey)).toContain('Concluída');
    database.close();
  });

  it('exclui clientes, pedidos vinculados e anexos na mesma transação', () => {
    const { database, directory } = createTestDatabase();
    const clientsKey = 'ambro-studio:client-drafts:v1';
    const productionKey = 'ambro-studio:production-drafts:v1';
    const attachmentPath = join(directory, 'proposta.txt');
    writeFileSync(attachmentPath, 'negociação fictícia', 'utf8');
    const [attachment] = database.addAttachments([attachmentPath]);
    database.writeDocuments([
      { key: clientsKey, serializedValue: '[{"id":"cliente"}]' },
      { key: productionKey, serializedValue: '[{"id":"pedido"}]' },
    ]);

    database.deleteClientData(
      [
        { key: clientsKey, serializedValue: '[]' },
        { key: productionKey, serializedValue: '[]' },
      ],
      [attachment.id],
    );

    expect(database.readDocument(clientsKey)).toBe('[]');
    expect(database.readDocument(productionKey)).toBe('[]');
    expect(() => database.readAttachment(attachment.id)).toThrow(
      'ATTACHMENT_NOT_FOUND',
    );
    database.close();
  });

  it('não altera os documentos se a exclusão de clientes for inválida', () => {
    const { database } = createTestDatabase();
    const clientsKey = 'ambro-studio:client-drafts:v1';
    const productionKey = 'ambro-studio:production-drafts:v1';
    database.writeDocuments([
      { key: clientsKey, serializedValue: '[{"id":"cliente"}]' },
      { key: productionKey, serializedValue: '[{"id":"pedido"}]' },
    ]);

    expect(() =>
      database.deleteClientData(
        [
          { key: clientsKey, serializedValue: '[]' },
          { key: productionKey, serializedValue: '[]' },
        ],
        ['identificador-inválido'],
      ),
    ).toThrow('INVALID_ATTACHMENT_ID');
    expect(database.readDocument(clientsKey)).toContain('cliente');
    expect(database.readDocument(productionKey)).toContain('pedido');
    database.close();
  });

  it('cria e restaura um backup validado', () => {
    const { database, directory } = createTestDatabase();
    const key = 'ambro-studio:pricing-product-drafts:v1';
    const materialsKey = 'ambro-studio:pricing-materials:v1';
    const backupPath = join(directory, 'backup.ambrobackup');
    const attachmentPath = join(directory, 'proposta.txt');
    database.writeDocument(key, '[{"name":"Produto inicial"}]');
    database.writeDocument(materialsKey, '[{"description":"Papel"}]');
    writeFileSync(attachmentPath, 'conteúdo fictício', 'utf8');
    const [attachment] = database.addAttachments([attachmentPath]);
    database.createBackup(backupPath);
    database.writeDocument(key, '[]');
    database.writeDocument(materialsKey, '[]');
    database.removeAttachment(attachment.id);
    database.restoreBackup(backupPath);

    expect(database.readDocument(key)).toContain('Produto inicial');
    expect(database.readDocument(materialsKey)).toContain('Papel');
    expect(database.readAttachment(attachment.id).content.toString('utf8')).toBe(
      'conteúdo fictício',
    );
    database.close();
  });

  it('cria backup por uma conexão somente leitura sem bloquear novas gravações', () => {
    const { database, directory } = createTestDatabase();
    const key = 'ambro-studio:pricing-product-drafts:v1';
    const backupPath = join(directory, 'background.ambrobackup');
    database.writeDocument(key, '[{"name":"Produto preservado"}]');
    const reader = new DesktopDatabase(database.path, { readOnly: true });

    reader.createBackup(backupPath);
    reader.close();
    database.writeDocument(key, '[{"name":"Produto atualizado"}]');

    const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as {
      documents: Record<string, unknown>;
    };
    expect(JSON.stringify(backup.documents[key])).toContain(
      'Produto preservado',
    );
    expect(database.readDocument(key)).toContain('Produto atualizado');
    database.close();
  });

  it('substitui um backup existente de forma completa', () => {
    const { database, directory } = createTestDatabase();
    const key = 'ambro-studio:pricing-product-drafts:v1';
    const backupPath = join(directory, 'rotating.ambrobackup');
    database.writeDocument(key, '[{"name":"Primeira versão"}]');
    database.createBackup(backupPath);
    database.writeDocument(key, '[{"name":"Segunda versão"}]');

    database.createBackup(backupPath);

    expect(readFileSync(backupPath, 'utf8')).toContain('Segunda versão');
    expect(
      readFileSync(backupPath, 'utf8'),
    ).not.toContain('Primeira versão');
    database.close();
  });

  it('restaura backups antigos da versão 1 sem alterar o formato atual', () => {
    const { database, directory } = createTestDatabase();
    const key = 'ambro-studio:client-drafts:v1';
    const backupPath = join(directory, 'legacy.ambrobackup');
    writeFileSync(
      backupPath,
      JSON.stringify({
        format: 'ambro-studio-backup',
        version: 1,
        createdAt: '2026-08-25T12:00:00.000Z',
        documents: { [key]: [{ id: 'cliente-antigo' }] },
      }),
      'utf8',
    );

    database.restoreBackup(backupPath);

    expect(database.readDocument(key)).toContain('cliente-antigo');
    database.close();
  });

  it('recusa anexos com extensão não permitida', () => {
    const { database, directory } = createTestDatabase();
    const attachmentPath = join(directory, 'programa.exe');
    writeFileSync(attachmentPath, 'não executar', 'utf8');

    expect(() => database.addAttachments([attachmentPath])).toThrow(
      'ATTACHMENT_TYPE_NOT_ALLOWED',
    );
    database.close();
  });

  it('exporta somente eventos técnicos com contrato fechado', () => {
    const { database, directory } = createTestDatabase();
    const diagnosticsPath = join(directory, 'diagnostics.json');
    database.recordDiagnostic({
      eventId: 'd4546561-f3ed-47ab-9422-cd8b358cbad5',
      incidentCode: 'AMB-A1B2C',
      correlationId: '3403507e-58f4-4ccd-9a3a-463ece19c018',
      timestamp: '2026-08-26T12:00:00.000Z',
      severity: 'error',
      eventCode: 'CONTROLLED_ERROR',
      module: 'diagnostics',
      operation: 'export-test',
      result: 'failure',
      environment: 'development',
      releaseVersion: '0.1.0',
      buildId: 'test',
    });
    expect(() =>
      database.recordDiagnostic({
        eventId: 'x',
        incidentCode: 'AMB-A1B2C',
        timestamp: '2026-08-26T12:00:00.000Z',
        eventCode: 'CONTROLLED_ERROR',
        module: 'diagnostics',
        operation: 'export-test',
        result: 'failure',
        customerName: 'não pode entrar',
      }),
    ).toThrow('INVALID_DIAGNOSTIC_EVENT');
    database.exportDiagnostics(diagnosticsPath);

    const exported = readFileSync(diagnosticsPath, 'utf8');
    expect(exported).toContain('AMB-A1B2C');
    expect(exported).not.toContain('customerName');
    database.close();
  });
});
