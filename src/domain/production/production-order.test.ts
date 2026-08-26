import { describe, expect, it } from 'vitest';
import {
  archiveProductionOrder,
  changeProductionPriority,
  createProductionOrder,
  pendingNegotiationIdsForProduction,
  transitionProductionOrder,
  unarchiveProductionOrder,
} from './production-order';

const orderId = 'd4546561-f3ed-47ab-9422-cd8b358cbad5';

function createOrder() {
  return createProductionOrder(
    [],
    {
      product: 'Kit festa personalizado',
      clientId: null,
      dueDate: '2026-08-30',
      priority: 'normal',
      status: 'approved',
    },
    { id: orderId, timestamp: '2026-08-25T12:00:00.000Z' },
  );
}

describe('production orders', () => {
  it('gera código e permite avançar pela transição válida', () => {
    const orders = createOrder();
    const producing = transitionProductionOrder(
      orders,
      orderId,
      'producing',
      '2026-08-25T13:00:00.000Z',
    );

    expect(orders[0].code).toBe('PED-2026-0001');
    expect(producing[0].status).toBe('producing');
  });

  it('recusa pular diretamente de aprovado para pronto', () => {
    expect(() =>
      transitionProductionOrder(createOrder(), orderId, 'ready'),
    ).toThrow('INVALID_PRODUCTION_TRANSITION');
  });

  it('altera a prioridade sem modificar o restante do pedido', () => {
    const urgent = changeProductionPriority(
      createOrder(),
      orderId,
      'urgent',
      '2026-08-25T13:00:00.000Z',
    );

    expect(urgent[0].priority).toBe('urgent');
    expect(urgent[0].product).toBe('Kit festa personalizado');
  });

  it('arquiva somente pedidos entregues e permite restaurá-los', () => {
    const producing = transitionProductionOrder(
      createOrder(),
      orderId,
      'producing',
      '2026-08-25T13:00:00.000Z',
    );
    const ready = transitionProductionOrder(
      producing,
      orderId,
      'ready',
      '2026-08-25T14:00:00.000Z',
    );
    const delivered = transitionProductionOrder(
      ready,
      orderId,
      'delivered',
      '2026-08-25T15:00:00.000Z',
    );
    const archived = archiveProductionOrder(
      delivered,
      orderId,
      '2026-08-25T16:00:00.000Z',
    );

    expect(archived[0].archivedAt).toBe('2026-08-25T16:00:00.000Z');
    expect(unarchiveProductionOrder(archived, orderId)[0].archivedAt).toBeNull();
    expect(() => archiveProductionOrder(createOrder(), orderId)).toThrow(
      'ONLY_DELIVERED_ORDERS_CAN_BE_ARCHIVED',
    );
  });

  it('oferece somente negociações aprovadas ou concluídas ainda não convertidas', () => {
    const clientId = '3403507e-58f4-4ccd-9a3a-463ece19c018';
    const linkedNegotiationId = 'b16ac789-9f72-4620-ac9a-72a2858fbd69';
    const pendingNegotiationId = '23ad9bea-c81c-419b-81fd-d1eabda2273d';
    const negotiatingId = '3bba71bc-43a7-4d4c-92d2-c0c94b97c5fe';
    const orders = createProductionOrder(
      [],
      {
        product: 'Kit festa',
        negotiationId: linkedNegotiationId,
        quantity: 12,
        clientId,
        dueDate: '2026-08-30',
        priority: 'normal',
        status: 'approved',
      },
      { id: orderId, timestamp: '2026-08-25T12:00:00.000Z' },
    );

    expect(
      pendingNegotiationIdsForProduction(orders, clientId, [
        { id: linkedNegotiationId, status: 'Concluída' },
        { id: pendingNegotiationId, status: 'Aprovada' },
        { id: negotiatingId, status: 'Em negociação' },
      ]),
    ).toEqual([pendingNegotiationId]);
  });

  it('não oferece novamente uma negociação depois que o pedido é arquivado', () => {
    const clientId = '3403507e-58f4-4ccd-9a3a-463ece19c018';
    const negotiationId = 'b16ac789-9f72-4620-ac9a-72a2858fbd69';
    let orders = createProductionOrder(
      [],
      {
        product: 'Kit festa',
        negotiationId,
        clientId,
        dueDate: '2026-08-30',
        priority: 'normal',
        status: 'approved',
      },
      { id: orderId, timestamp: '2026-08-25T12:00:00.000Z' },
    );
    orders = transitionProductionOrder(orders, orderId, 'producing');
    orders = transitionProductionOrder(orders, orderId, 'ready');
    orders = transitionProductionOrder(orders, orderId, 'delivered');
    orders = archiveProductionOrder(orders, orderId);

    expect(
      pendingNegotiationIdsForProduction(orders, clientId, [
        { id: negotiationId, status: 'Concluída' },
      ]),
    ).toEqual([]);
  });
});
