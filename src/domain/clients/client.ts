import { z } from 'zod';

export const negotiationStatuses = [
  'Em negociação',
  'Aprovada',
  'Concluída',
  'Perdida',
] as const;

export const paymentStatuses = [
  'Pendente',
  'Pagou metade',
  'Pago',
] as const;

export const clientContactInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.union([z.literal(''), z.string().trim().email().max(160)]),
  interestedProductIds: z.array(z.string().uuid()).max(20).default([]),
});

export const negotiationInputSchema = z.object({
  productDraftId: z.string().uuid().nullable().default(null),
  title: z.string().trim().max(120).default(''),
  quantity: z.number().int().min(1).max(100_000).default(1),
  status: z.enum(negotiationStatuses),
  paymentStatus: z.enum(paymentStatuses).default('Pendente'),
  amountCents: z.number().int().nonnegative().max(999_999_999),
  occurredOn: z.string().date(),
});

export const negotiationAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
    addedAt: z.string().datetime(),
  })
  .strict();

const negotiationSchema = negotiationInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  attachments: z.array(negotiationAttachmentSchema).max(20).default([]),
});

export const clientDraftSchema = clientContactInputSchema.extend({
  id: z.string().uuid(),
  code: z.string().regex(/^CLI-\d{4,}$/),
  negotiations: z.array(negotiationSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const clientDraftsSchema = z.array(clientDraftSchema);

export type ClientContactInput = z.input<typeof clientContactInputSchema>;
export type NegotiationInput = z.input<typeof negotiationInputSchema>;
export type NegotiationAttachment = z.infer<
  typeof negotiationAttachmentSchema
>;
export type ClientDraft = z.infer<typeof clientDraftSchema>;
export type PaymentStatus = (typeof paymentStatuses)[number];

export type OutstandingClientPayment = {
  clientId: string;
  clientCode: string;
  clientName: string;
  negotiationId: string;
  productDraftId: string | null;
  title: string;
  paymentStatus: Exclude<PaymentStatus, 'Pago'>;
  amountCents: number;
  outstandingCents: number;
  occurredOn: string;
};

function nextClientCode(clients: ClientDraft[]) {
  const largestSequence = clients.reduce((largest, client) => {
    const sequence = Number(client.code.replace('CLI-', ''));
    return Number.isSafeInteger(sequence) ? Math.max(largest, sequence) : largest;
  }, 0);

  return `CLI-${String(largestSequence + 1).padStart(4, '0')}`;
}

export function createClientDraft(
  clients: ClientDraft[],
  input: ClientContactInput,
  options: { id?: string; timestamp?: string } = {},
) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const client = clientDraftSchema.parse({
    ...clientContactInputSchema.parse(input),
    id: options.id ?? crypto.randomUUID(),
    code: nextClientCode(clients),
    negotiations: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return [client, ...clients];
}

export function editClientDraft(
  clients: ClientDraft[],
  clientId: string,
  input: ClientContactInput,
  timestamp = new Date().toISOString(),
) {
  const validatedInput = clientContactInputSchema.parse(input);

  return clients.map((client) =>
    client.id === clientId
      ? clientDraftSchema.parse({
          ...client,
          ...validatedInput,
          updatedAt: timestamp,
        })
      : client,
  );
}

export function deleteClientDrafts(
  clients: ClientDraft[],
  clientIds: ReadonlySet<string>,
) {
  return clients.filter((client) => !clientIds.has(client.id));
}

export function clientAttachmentIds(
  clients: ClientDraft[],
  clientIds: ReadonlySet<string>,
) {
  return clients
    .filter((client) => clientIds.has(client.id))
    .flatMap((client) =>
      client.negotiations.flatMap((negotiation) =>
        negotiation.attachments.map((attachment) => attachment.id),
      ),
    );
}

export function addClientNegotiation(
  clients: ClientDraft[],
  clientId: string,
  input: NegotiationInput,
  options: { id?: string; timestamp?: string } = {},
) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const negotiation = negotiationSchema.parse({
    ...negotiationInputSchema.parse(input),
    id: options.id ?? crypto.randomUUID(),
    createdAt: timestamp,
  });

  return clients.map((client) =>
    client.id === clientId
      ? clientDraftSchema.parse({
          ...client,
          interestedProductIds: negotiation.productDraftId
            ? Array.from(
                new Set([
                  ...client.interestedProductIds,
                  negotiation.productDraftId,
                ]),
              )
            : client.interestedProductIds,
          negotiations: [negotiation, ...client.negotiations],
          updatedAt: timestamp,
        })
      : client,
  );
}

export function editClientNegotiation(
  clients: ClientDraft[],
  clientId: string,
  negotiationId: string,
  input: NegotiationInput,
  timestamp = new Date().toISOString(),
) {
  const validatedInput = negotiationInputSchema.parse(input);

  return clients.map((client) =>
    client.id === clientId
      ? clientDraftSchema.parse({
          ...client,
          interestedProductIds: validatedInput.productDraftId
            ? Array.from(
                new Set([
                  ...client.interestedProductIds,
                  validatedInput.productDraftId,
                ]),
              )
            : client.interestedProductIds,
          negotiations: client.negotiations.map((negotiation) =>
            negotiation.id === negotiationId
              ? { ...negotiation, ...validatedInput }
              : negotiation,
          ),
          updatedAt: timestamp,
        })
      : client,
  );
}

export function completeClientNegotiation(
  clients: ClientDraft[],
  clientId: string,
  negotiationId: string,
  timestamp = new Date().toISOString(),
) {
  return clients.map((client) =>
    client.id === clientId
      ? clientDraftSchema.parse({
          ...client,
          negotiations: client.negotiations.map((negotiation) =>
            negotiation.id === negotiationId
              ? { ...negotiation, status: 'Concluída' as const }
              : negotiation,
          ),
          updatedAt: timestamp,
        })
      : client,
  );
}

export function outstandingClientPayments(clients: ClientDraft[]) {
  return clients
    .flatMap((client) =>
      client.negotiations.flatMap((negotiation) => {
        if (
          !['Aprovada', 'Concluída'].includes(negotiation.status) ||
          negotiation.paymentStatus === 'Pago'
        ) {
          return [];
        }

        return [
          {
            clientId: client.id,
            clientCode: client.code,
            clientName: client.name,
            negotiationId: negotiation.id,
            productDraftId: negotiation.productDraftId,
            title: negotiation.title,
            paymentStatus: negotiation.paymentStatus,
            amountCents: negotiation.amountCents,
            outstandingCents:
              negotiation.paymentStatus === 'Pagou metade'
                ? Math.ceil(negotiation.amountCents / 2)
                : negotiation.amountCents,
            occurredOn: negotiation.occurredOn,
          } satisfies OutstandingClientPayment,
        ];
      }),
    )
    .sort(
      (first, second) =>
        first.occurredOn.localeCompare(second.occurredOn) ||
        first.clientName.localeCompare(second.clientName, 'pt-BR'),
    );
}

export function addClientNegotiationAttachments(
  clients: ClientDraft[],
  clientId: string,
  negotiationId: string,
  attachments: NegotiationAttachment[],
  timestamp = new Date().toISOString(),
) {
  const validatedAttachments = z
    .array(negotiationAttachmentSchema)
    .max(20)
    .parse(attachments);

  return clients.map((client) => {
    if (client.id !== clientId) return client;
    return clientDraftSchema.parse({
      ...client,
      negotiations: client.negotiations.map((negotiation) => {
        if (negotiation.id !== negotiationId) return negotiation;
        const merged = [...negotiation.attachments, ...validatedAttachments].filter(
          (attachment, index, all) =>
            all.findIndex((item) => item.id === attachment.id) === index,
        );
        if (merged.length > 20) throw new Error('TOO_MANY_ATTACHMENTS');
        return { ...negotiation, attachments: merged };
      }),
      updatedAt: timestamp,
    });
  });
}

export function removeClientNegotiationAttachment(
  clients: ClientDraft[],
  clientId: string,
  negotiationId: string,
  attachmentId: string,
  timestamp = new Date().toISOString(),
) {
  return clients.map((client) =>
    client.id === clientId
      ? clientDraftSchema.parse({
          ...client,
          negotiations: client.negotiations.map((negotiation) =>
            negotiation.id === negotiationId
              ? {
                  ...negotiation,
                  attachments: negotiation.attachments.filter(
                    (attachment) => attachment.id !== attachmentId,
                  ),
                }
              : negotiation,
          ),
          updatedAt: timestamp,
        })
      : client,
  );
}

export function filterClientDrafts(clients: ClientDraft[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalizedQuery) return clients;

  return clients.filter((client) =>
    [client.name, client.phone, client.email, client.code].some((value) =>
      value.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
    ),
  );
}

function normalizedPhone(value: string) {
  return value.replace(/\D/g, '');
}

export function findPhoneConflict(
  clients: ClientDraft[],
  phone: string,
  editingClientId = '',
) {
  const targetPhone = normalizedPhone(phone);
  const editingClient = clients.find((client) => client.id === editingClientId);

  if (
    editingClient &&
    normalizedPhone(editingClient.phone) === targetPhone
  ) {
    return undefined;
  }

  return clients.find(
    (client) =>
      client.id !== editingClientId &&
      normalizedPhone(client.phone) === targetPhone,
  );
}

export function clientMetrics(client: ClientDraft) {
  const purchases = client.negotiations.filter((negotiation) =>
    ['Aprovada', 'Concluída'].includes(negotiation.status),
  );
  const openNegotiations = client.negotiations.filter(
    (negotiation) => negotiation.status === 'Em negociação',
  );
  const lastPurchase = [...purchases].sort((first, second) =>
    second.occurredOn.localeCompare(first.occurredOn),
  )[0];

  return {
    purchases: purchases.length,
    openNegotiations: openNegotiations.length,
    lastPurchaseOn: lastPurchase?.occurredOn ?? null,
    status:
      openNegotiations.length > 0
        ? 'Em negociação'
        : purchases.length > 1
          ? 'Recorrente'
          : 'Ativo',
  } as const;
}
