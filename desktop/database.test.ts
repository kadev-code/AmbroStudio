import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('cria e restaura um backup validado', () => {
    const { database, directory } = createTestDatabase();
    const key = 'ambro-studio:pricing-product-drafts:v1';
    const backupPath = join(directory, 'backup.ambrobackup');
    const attachmentPath = join(directory, 'proposta.txt');
    database.writeDocument(key, '[{"name":"Produto inicial"}]');
    writeFileSync(attachmentPath, 'conteúdo fictício', 'utf8');
    const [attachment] = database.addAttachments([attachmentPath]);
    database.createBackup(backupPath);
    database.writeDocument(key, '[]');
    database.removeAttachment(attachment.id);
    database.restoreBackup(backupPath);

    expect(database.readDocument(key)).toContain('Produto inicial');
    expect(database.readAttachment(attachment.id).content.toString('utf8')).toBe(
      'conteúdo fictício',
    );
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
