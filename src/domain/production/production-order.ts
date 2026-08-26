import { z } from 'zod';
import type { ProductionPriority } from './sort-orders';

export const productionStatuses = [
  'approved',
  'producing',
  'ready',
  'delivered',
] as const;

export const productionPriorities = [
  'urgent',
  'high',
  'normal',
  'low',
] as const satisfies readonly ProductionPriority[];

export type ProductionStatus = (typeof productionStatuses)[number];

export const productionOrderInputSchema = z.object({
  product: z.string().trim().min(2).max(140),
  productDraftId: z.string().uuid().nullable().default(null),
  negotiationId: z.string().uuid().nullable().default(null),
  quantity: z.number().int().min(1).max(100_000).default(1),
  clientId: z.string().uuid().nullable(),
  dueDate: z.string().date(),
  priority: z.enum(productionPriorities),
  status: z.enum(productionStatuses),
});

export const productionOrderSchema = productionOrderInputSchema.extend({
  id: z.string().uuid(),
  code: z.string().regex(/^PED-\d{4}-\d{4,}$/),
  manualRank: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productionOrdersSchema = z.array(productionOrderSchema);

export type ProductionOrderInput = z.input<typeof productionOrderInputSchema>;
export type ProductionOrder = z.infer<typeof productionOrderSchema>;

const allowedTransitions: Record<ProductionStatus, ProductionStatus[]> = {
  approved: ['producing'],
  producing: ['approved', 'ready'],
  ready: ['producing', 'delivered'],
  delivered: ['ready'],
};

function nextOrderCode(orders: ProductionOrder[], year: number) {
  const prefix = `PED-${year}-`;
  const largestSequence = orders.reduce((largest, order) => {
    if (!order.code.startsWith(prefix)) return largest;
    const sequence = Number(order.code.slice(prefix.length));
    return Number.isSafeInteger(sequence) ? Math.max(largest, sequence) : largest;
  }, 0);

  return `${prefix}${String(largestSequence + 1).padStart(4, '0')}`;
}

export function createProductionOrder(
  orders: ProductionOrder[],
  input: ProductionOrderInput,
  options: { id?: string; timestamp?: string } = {},
) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const year = new Date(timestamp).getUTCFullYear();
  const order = productionOrderSchema.parse({
    ...productionOrderInputSchema.parse(input),
    id: options.id ?? crypto.randomUUID(),
    code: nextOrderCode(orders, year),
    manualRank: orders.length,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return [order, ...orders];
}

export function transitionProductionOrder(
  orders: ProductionOrder[],
  orderId: string,
  nextStatus: ProductionStatus,
  timestamp = new Date().toISOString(),
) {
  return orders.map((order) => {
    if (order.id !== orderId) return order;
    if (!allowedTransitions[order.status].includes(nextStatus)) {
      throw new Error('INVALID_PRODUCTION_TRANSITION');
    }

    return productionOrderSchema.parse({
      ...order,
      status: nextStatus,
      archivedAt: nextStatus === 'ready' ? null : order.archivedAt,
      updatedAt: timestamp,
    });
  });
}

export function archiveProductionOrder(
  orders: ProductionOrder[],
  orderId: string,
  timestamp = new Date().toISOString(),
) {
  return orders.map((order) => {
    if (order.id !== orderId) return order;
    if (order.status !== 'delivered') {
      throw new Error('ONLY_DELIVERED_ORDERS_CAN_BE_ARCHIVED');
    }

    return productionOrderSchema.parse({
      ...order,
      archivedAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

export function unarchiveProductionOrder(
  orders: ProductionOrder[],
  orderId: string,
  timestamp = new Date().toISOString(),
) {
  return orders.map((order) =>
    order.id === orderId
      ? productionOrderSchema.parse({
          ...order,
          archivedAt: null,
          updatedAt: timestamp,
        })
      : order,
  );
}

export function pendingNegotiationIdsForProduction(
  orders: ProductionOrder[],
  clientId: string,
  negotiations: ReadonlyArray<{ id: string; status: string }>,
) {
  const linkedNegotiationIds = new Set(
    orders
      .filter(
        (order) =>
          order.clientId === clientId &&
          order.negotiationId,
      )
      .map((order) => order.negotiationId),
  );

  return negotiations
    .filter(
      (negotiation) =>
        ['Aprovada', 'Concluída'].includes(negotiation.status) &&
        !linkedNegotiationIds.has(negotiation.id),
    )
    .map((negotiation) => negotiation.id);
}

export function changeProductionPriority(
  orders: ProductionOrder[],
  orderId: string,
  priority: ProductionPriority,
  timestamp = new Date().toISOString(),
) {
  return orders.map((order) =>
    order.id === orderId
      ? productionOrderSchema.parse({ ...order, priority, updatedAt: timestamp })
      : order,
  );
}
