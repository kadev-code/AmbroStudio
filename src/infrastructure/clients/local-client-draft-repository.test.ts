import { describe, expect, it } from 'vitest';
import { createClientDraft } from '../../domain/clients/client';
import { parseStoredClientDrafts } from './local-client-draft-repository';

describe('local client draft repository', () => {
  it('recusa registros corrompidos', () => {
    expect(parseStoredClientDrafts('conteúdo inválido')).toEqual([]);
    expect(parseStoredClientDrafts('[{"name":"incompleto"}]')).toEqual([]);
  });

  it('restaura registros que respeitam o contrato', () => {
    const clients = createClientDraft(
      [],
      { name: 'Cliente Teste', phone: '11999990000', email: '' },
      {
        id: '7b9a7167-cbe2-452c-a7b8-c41fbd3ada53',
        timestamp: '2026-08-25T12:00:00.000Z',
      },
    );

    expect(parseStoredClientDrafts(JSON.stringify(clients))).toEqual(clients);
  });

  it('migra cadastros anteriores sem produto de interesse', () => {
    const clients = createClientDraft(
      [],
      { name: 'Cliente Antigo', phone: '11999990000', email: '' },
      {
        id: '8528ca44-862b-4f9a-8265-094b85cf02fa',
        timestamp: '2026-08-24T12:00:00.000Z',
      },
    );
    const legacyClient: Partial<(typeof clients)[number]> = { ...clients[0] };
    delete legacyClient.interestedProductIds;

    expect(
      parseStoredClientDrafts(JSON.stringify([legacyClient]))[0]
        .interestedProductIds,
    ).toEqual([]);
  });
});
