import { describe, expect, it } from 'vitest';
import {
  createSafeLogger,
  MemoryDiagnosticTransport,
} from './safe-logger';

describe('safeLogger', () => {
  it('gera um código de incidente pesquisável', async () => {
    const transport = new MemoryDiagnosticTransport();
    const logger = createSafeLogger(transport);
    const result = logger.record(
      {
        severity: 'error',
        eventCode: 'PRICING_CALCULATION_FAILED',
        module: 'pricing',
        operation: 'calculate-price',
        result: 'failure',
        errorCode: 'INVALID_PERCENTAGE_TOTAL',
      },
      new Error('conteúdo que não pode ser enviado'),
    );

    await Promise.resolve();

    expect(result.incidentCode).toMatch(/^AMB-[A-Z0-9]{5}$/);
    expect(transport.events).toHaveLength(1);
    expect(JSON.stringify(transport.events[0])).not.toContain(
      'conteúdo que não pode ser enviado',
    );
  });

  it('não oferece campos livres para dados de clientes', async () => {
    const transport = new MemoryDiagnosticTransport();
    const logger = createSafeLogger(transport);

    logger.record({
      severity: 'warning',
      eventCode: 'STORAGE_UPLOAD_FAILED',
      module: 'storage',
      operation: 'upload-attachment',
      result: 'failure',
      errorCode: 'FILE_TOO_LARGE',
    });

    await Promise.resolve();

    const serialized = JSON.stringify(transport.events[0]);
    expect(serialized).not.toMatch(/name|email|phone|address|payload|token/i);
  });
});
