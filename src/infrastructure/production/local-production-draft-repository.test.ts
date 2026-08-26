import { describe, expect, it } from 'vitest';
import { createProductionOrder } from '../../domain/production/production-order';
import { parseStoredProductionDrafts } from './local-production-draft-repository';

describe('local production draft repository', () => {
  it('restaura somente pedidos válidos', () => {
    expect(parseStoredProductionDrafts('inválido')).toEqual([]);

    const orders = createProductionOrder(
      [],
      {
        product: 'Convites personalizados',
        clientId: null,
        dueDate: '2026-08-30',
        priority: 'high',
        status: 'approved',
      },
      {
        id: 'fc1ab45e-e6c5-4ca2-8805-1948313af94d',
        timestamp: '2026-08-25T12:00:00.000Z',
      },
    );

    expect(parseStoredProductionDrafts(JSON.stringify(orders))).toEqual(orders);
  });

  it('migra pedidos anteriores sem informação de arquivamento', () => {
    const orders = createProductionOrder(
      [],
      {
        product: 'Pedido antigo',
        clientId: null,
        dueDate: '2026-08-30',
        priority: 'normal',
        status: 'delivered',
      },
      {
        id: '4ae13cab-9182-4dca-be39-68afbc259834',
        timestamp: '2026-08-24T12:00:00.000Z',
      },
    );
    const legacyOrder: Partial<(typeof orders)[number]> = { ...orders[0] };
    delete legacyOrder.archivedAt;

    const migrated = parseStoredProductionDrafts(
      JSON.stringify([legacyOrder]),
    )[0];

    expect(migrated.archivedAt).toBeNull();
    expect(migrated.negotiationId).toBeNull();
    expect(migrated.quantity).toBe(1);
  });
});
