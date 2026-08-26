import { describe, expect, it } from 'vitest';
import {
  addClientNegotiation,
  addClientNegotiationAttachments,
  clientMetrics,
  createClientDraft,
  editClientDraft,
  editClientNegotiation,
  findPhoneConflict,
  filterClientDrafts,
  removeClientNegotiationAttachment,
} from './client';

const clientId = 'bf9dcf63-6dd5-4a2a-b468-300a71da9a8e';
const negotiationId = '92568c03-95e2-45ee-938c-7031986464df';

describe('client drafts', () => {
  it('mantém várias negociações no mesmo cadastro', () => {
    const clients = createClientDraft(
      [],
      { name: 'Cliente Teste', phone: '11999990000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const withNegotiation = addClientNegotiation(
      clients,
      clientId,
      {
        title: 'Kit aniversário',
        status: 'Aprovada',
        amountCents: 15_000,
        occurredOn: '2026-08-25',
      },
      { id: negotiationId, timestamp: '2026-08-25T11:00:00.000Z' },
    );

    expect(withNegotiation).toHaveLength(1);
    expect(withNegotiation[0].negotiations).toHaveLength(1);
    expect(clientMetrics(withNegotiation[0]).purchases).toBe(1);
  });

  it('gera códigos sequenciais e pesquisa pelos contatos', () => {
    const first = createClientDraft(
      [],
      { name: 'Primeiro Cliente', phone: '11999990000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const second = createClientDraft(
      first,
      { name: 'Segundo Cliente', phone: '21988880000', email: 'teste@example.com' },
      {
        id: 'e901f555-e6dc-46ae-9e77-dbf32f75b850',
        timestamp: '2026-08-25T11:00:00.000Z',
      },
    );

    expect(second[0].code).toBe('CLI-0002');
    expect(filterClientDrafts(second, 'example.com')).toEqual([second[0]]);
  });

  it('edita a situação e recalcula os indicadores do cliente', () => {
    const clients = createClientDraft(
      [],
      { name: 'Cliente Teste', phone: '11999990000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const withOpenNegotiation = addClientNegotiation(
      clients,
      clientId,
      {
        title: 'Kit aniversário',
        status: 'Em negociação',
        amountCents: 15_000,
        occurredOn: '2026-08-25',
      },
      { id: negotiationId, timestamp: '2026-08-25T11:00:00.000Z' },
    );
    const completed = editClientNegotiation(
      withOpenNegotiation,
      clientId,
      negotiationId,
      {
        title: 'Kit aniversário',
        status: 'Concluída',
        amountCents: 15_000,
        occurredOn: '2026-08-25',
      },
      '2026-08-25T12:00:00.000Z',
    );

    expect(clientMetrics(completed[0])).toMatchObject({
      purchases: 1,
      openNegotiations: 0,
      status: 'Ativo',
    });
  });

  it('edita o cadastro e mantém vários produtos no mesmo cliente', () => {
    const clients = createClientDraft(
      [],
      { name: 'Cliente Teste', phone: '11999990000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const updated = editClientDraft(
      clients,
      clientId,
      {
        name: 'Cliente Atualizado',
        phone: '11988880000',
        email: 'cliente@example.com',
        interestedProductIds: [
          'f55068c1-b90e-4bce-8c1a-fad04eeb6564',
          'cb830b60-b682-4217-87fb-0eaadb765e08',
        ],
      },
      '2026-08-25T13:00:00.000Z',
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      code: 'CLI-0001',
      name: 'Cliente Atualizado',
      interestedProductIds: [
        'f55068c1-b90e-4bce-8c1a-fad04eeb6564',
        'cb830b60-b682-4217-87fb-0eaadb765e08',
      ],
    });
  });

  it('permite editar um cadastro antigo sem alterar um telefone duplicado', () => {
    const first = createClientDraft(
      [],
      { name: 'Primeiro Cliente', phone: '(11) 99999-0000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const duplicated = createClientDraft(
      first,
      { name: 'Cadastro Antigo', phone: '11999990000', email: '' },
      {
        id: '13943509-8fb2-4785-a526-c661c37172da',
        timestamp: '2026-08-25T11:00:00.000Z',
      },
    );

    expect(
      findPhoneConflict(
        duplicated,
        '11999990000',
        '13943509-8fb2-4785-a526-c661c37172da',
      ),
    ).toBeUndefined();
    expect(findPhoneConflict(duplicated, '11999990000')?.id).toBe(
      '13943509-8fb2-4785-a526-c661c37172da',
    );
  });

  it('registra produto e quantidade sem exigir descrição', () => {
    const productId = 'abf57f10-087a-4d7c-afdc-c6f28f776dbf';
    const clients = createClientDraft(
      [],
      { name: 'Cliente Teste', phone: '11999990000', email: '' },
      { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
    );
    const updated = addClientNegotiation(
      clients,
      clientId,
      {
        productDraftId: productId,
        title: '',
        quantity: 3,
        status: 'Em negociação',
        amountCents: 16_776,
        occurredOn: '2026-08-25',
      },
      { id: negotiationId, timestamp: '2026-08-25T11:00:00.000Z' },
    );

    expect(updated[0].interestedProductIds).toContain(productId);
    expect(updated[0].negotiations[0]).toMatchObject({
      productDraftId: productId,
      title: '',
      quantity: 3,
    });
  });

  it('vincula e remove anexos sem alterar os dados da negociação', () => {
    const clients = addClientNegotiation(
      createClientDraft(
        [],
        { name: 'Cliente Teste', phone: '11999990000', email: '' },
        { id: clientId, timestamp: '2026-08-25T10:00:00.000Z' },
      ),
      clientId,
      {
        title: 'Kit aniversário',
        status: 'Aprovada',
        amountCents: 15_000,
        occurredOn: '2026-08-25',
      },
      { id: negotiationId, timestamp: '2026-08-25T11:00:00.000Z' },
    );
    const attachmentId = '55162f65-5cb8-4bd8-ad8d-43a490f73f30';
    const withAttachment = addClientNegotiationAttachments(
      clients,
      clientId,
      negotiationId,
      [
        {
          id: attachmentId,
          fileName: 'proposta.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1200,
          addedAt: '2026-08-25T12:00:00.000Z',
        },
      ],
    );

    expect(withAttachment[0].negotiations[0].attachments[0].fileName).toBe(
      'proposta.pdf',
    );
    const withoutAttachment = removeClientNegotiationAttachment(
      withAttachment,
      clientId,
      negotiationId,
      attachmentId,
    );
    expect(withoutAttachment[0].negotiations[0].attachments).toEqual([]);
    expect(withoutAttachment[0].negotiations[0].title).toBe('Kit aniversário');
  });
});
