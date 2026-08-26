import { useMemo, useState, type FormEvent } from 'react';
import {
  completeClientNegotiation,
  outstandingClientPayments,
} from '@/src/domain/clients/client';
import {
  archiveProductionOrder,
  changeProductionPriority,
  createProductionOrder,
  pendingNegotiationIdsForProduction,
  productionOrderInputSchema,
  productionPriorities,
  transitionProductionOrder,
  unarchiveProductionOrder,
  type ProductionOrderInput,
  type ProductionStatus,
} from '@/src/domain/production/production-order';
import {
  sortProductionQueue,
  type ProductionPriority,
} from '@/src/domain/production/sort-orders';
import { loadClientDrafts } from '@/src/infrastructure/clients/local-client-draft-repository';
import { safeLogger } from '@/src/infrastructure/logging/safe-logger';
import { persistProductionCompletion } from '@/src/infrastructure/production/local-production-completion-repository';
import {
  loadProductionDrafts,
  persistProductionDrafts,
} from '@/src/infrastructure/production/local-production-draft-repository';
import { loadPricingProductDrafts } from '@/src/modules/pricing/pricing-product-drafts';

const columnDefinitions: Array<{
  status: ProductionStatus;
  title: string;
  tone: string;
}> = [
  { status: 'approved', title: 'Aprovados', tone: 'bg-amber-400' },
  { status: 'producing', title: 'Em produção', tone: 'bg-sky-500' },
  { status: 'ready', title: 'Prontos', tone: 'bg-emerald-500' },
  { status: 'delivered', title: 'Entregues', tone: 'bg-stone-400' },
];

const priorityLabels: Record<ProductionPriority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baixa',
};

const priorityAccents: Record<ProductionPriority, string> = {
  urgent: 'border-l-rose-600',
  high: 'border-l-orange-500',
  normal: 'border-l-amber-400',
  low: 'border-l-stone-300',
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const paymentStatusTone = {
  Pendente: 'bg-rose-100 text-rose-800',
  'Pagou metade': 'bg-amber-100 text-amber-800',
} as const;

function localDateKey(value = new Date()) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function initialDueDate() {
  const value = new Date();
  value.setDate(value.getDate() + 7);
  return localDateKey(value);
}

function emptyOrderForm(): ProductionOrderInput {
  return {
    product: '',
    productDraftId: null,
    negotiationId: null,
    quantity: 1,
    clientId: null,
    dueDate: initialDueDate(),
    priority: 'normal',
    status: 'approved',
  };
}

function dueLabel(dueDate: string, status: ProductionStatus) {
  if (status === 'delivered') return 'Entregue';
  const today = localDateKey();
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dueDate}T12:00:00.000Z`));
  if (dueDate < today) return `Atrasado · ${formatted}`;
  if (dueDate === today) return 'Hoje';
  return formatted;
}

function transitionActions(status: ProductionStatus) {
  const actions: Record<
    ProductionStatus,
    Array<{ status: ProductionStatus; label: string; primary?: boolean }>
  > = {
    approved: [{ status: 'producing', label: 'Iniciar produção', primary: true }],
    producing: [
      { status: 'approved', label: 'Voltar' },
      { status: 'ready', label: 'Marcar pronto', primary: true },
    ],
    ready: [
      { status: 'producing', label: 'Voltar' },
      { status: 'delivered', label: 'Entregar', primary: true },
    ],
    delivered: [{ status: 'ready', label: 'Reabrir' }],
  };
  return actions[status];
}

export function ProductionBoard() {
  const [orders, setOrders] = useState(loadProductionDrafts);
  const [clients, setClients] = useState(loadClientDrafts);
  const [productDrafts] = useState(loadPricingProductDrafts);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [feedback, setFeedback] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<
    ProductionPriority | 'all'
  >('all');
  const [showArchived, setShowArchived] = useState(false);
  const desktopAvailable =
    typeof window !== 'undefined' && Boolean(window.ambroDesktop);

  const today = localDateKey();
  const activeOrders = orders.filter((order) => order.status !== 'delivered');
  const dueToday = activeOrders.filter((order) => order.dueDate === today).length;
  const overdue = activeOrders.filter((order) => order.dueDate < today).length;
  const highPriority = activeOrders.filter((order) =>
    ['urgent', 'high'].includes(order.priority),
  ).length;
  const archivedOrders = orders.filter((order) => order.archivedAt);
  const outstandingPayments = outstandingClientPayments(clients);
  const outstandingPaymentTotalCents = outstandingPayments.reduce(
    (total, payment) => total + payment.outstandingCents,
    0,
  );
  const formClient = clients.find((client) => client.id === orderForm.clientId);
  const pendingFormNegotiationIds = formClient
    ? pendingNegotiationIdsForProduction(
        orders,
        formClient.id,
        formClient.negotiations,
      )
    : [];
  const formClientNegotiations =
    formClient?.negotiations.filter((negotiation) =>
      pendingFormNegotiationIds.includes(negotiation.id),
    ) ?? [];
  const hasEligibleNegotiations = Boolean(
    formClient?.negotiations.some((negotiation) =>
      ['Aprovada', 'Concluída'].includes(negotiation.status),
    ),
  );
  const noAvailableClientNegotiation = Boolean(
    formClient && !formClientNegotiations.length,
  );

  const columns = useMemo(
    () =>
      columnDefinitions.map((column) => ({
        ...column,
        orders: sortProductionQueue(
          orders.filter(
            (order) =>
              !order.archivedAt &&
              order.status === column.status &&
              (priorityFilter === 'all' || order.priority === priorityFilter),
          ),
        ),
      })),
    [orders, priorityFilter],
  );

  function saveOrders(nextOrders: typeof orders) {
    setOrders(nextOrders);
    persistProductionDrafts(nextOrders);
  }

  function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = productionOrderInputSchema.safeParse(orderForm);
    if (!parsed.success) {
      setFeedback('Informe produto, prazo e prioridade válidos.');
      return;
    }

    const nextOrders = createProductionOrder(orders, parsed.data);
    saveOrders(nextOrders);
    setOrderForm(emptyOrderForm());
    setShowOrderForm(false);
    setFeedback('Pedido adicionado à fila de aprovados.');
  }

  function moveOrder(orderId: string, nextStatus: ProductionStatus) {
    try {
      saveOrders(transitionProductionOrder(orders, orderId, nextStatus));
      setFeedback('Etapa do pedido atualizada.');
    } catch {
      setFeedback('Essa mudança de etapa não é permitida.');
    }
  }

  function changePriority(orderId: string, priority: ProductionPriority) {
    saveOrders(changeProductionPriority(orders, orderId, priority));
    setFeedback('Prioridade atualizada e fila reordenada.');
  }

  function selectClient(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    const pendingNegotiationIds = client
      ? pendingNegotiationIdsForProduction(
          orders,
          client.id,
          client.negotiations,
        )
      : [];
    const firstNegotiation = client?.negotiations.find((negotiation) =>
      pendingNegotiationIds.includes(negotiation.id),
    );
    const firstProduct = productDrafts.find(
      (product) => product.id === firstNegotiation?.productDraftId,
    );

    setOrderForm((current) => ({
      ...current,
      clientId: client?.id ?? null,
      negotiationId: firstNegotiation?.id ?? null,
      productDraftId: firstProduct?.id ?? null,
      product: firstProduct?.name ?? firstNegotiation?.title ?? '',
      quantity: firstNegotiation?.quantity ?? 1,
    }));
  }

  function selectNegotiation(negotiationId: string) {
    const negotiation = formClient?.negotiations.find(
      (item) => item.id === negotiationId,
    );
    const product = productDrafts.find(
      (item) => item.id === negotiation?.productDraftId,
    );
    setOrderForm((current) => ({
      ...current,
      negotiationId: negotiation?.id ?? null,
      productDraftId: product?.id ?? null,
      product: product?.name ?? negotiation?.title ?? '',
      quantity: negotiation?.quantity ?? 1,
    }));
  }

  function archiveOrder(orderId: string) {
    try {
      const order = orders.find((item) => item.id === orderId);
      const nextOrders = archiveProductionOrder(orders, orderId);
      if (order?.clientId && order.negotiationId) {
        const nextClients = completeClientNegotiation(
          clients,
          order.clientId,
          order.negotiationId,
        );
        if (!persistProductionCompletion(nextOrders, nextClients)) {
          const incident = safeLogger.record({
            severity: 'error',
            eventCode: 'PRODUCTION_COMPLETION_SAVE_FAILED',
            module: 'production',
            operation: 'archive-and-complete-sale',
            result: 'failure',
            errorCode: 'LOCAL_STORAGE_WRITE_FAILED',
          });
          setFeedback(
            `Não foi possível arquivar. Diagnóstico: ${incident.incidentCode}.`,
          );
          return;
        }
        setOrders(nextOrders);
        setClients(nextClients);
        setFeedback(
          'Pedido arquivado e venda concluída. O pagamento continua sendo acompanhado.',
        );
        return;
      }

      saveOrders(nextOrders);
      setFeedback('Pedido arquivado e mantido no histórico do cliente.');
    } catch (error) {
      safeLogger.record(
        {
          severity: 'warning',
          eventCode: 'PRODUCTION_ORDER_ARCHIVE_FAILED',
          module: 'production',
          operation: 'archive-production-order',
          result: 'failure',
          errorCode: 'INVALID_PRODUCTION_ARCHIVE',
        },
        error,
      );
      setFeedback('Somente pedidos entregues podem ser arquivados.');
    }
  }

  function restoreArchivedOrder(orderId: string) {
    saveOrders(unarchiveProductionOrder(orders, orderId));
    setFeedback('Pedido restaurado para a coluna Entregues.');
  }

  return (
    <div className="space-y-6">
      <section
        aria-label="Resumo da produção"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          [String(activeOrders.length), 'Pedidos ativos', `${highPriority} com prioridade alta`],
          [String(dueToday), 'Entrega hoje', dueToday ? 'Atenção ao prazo' : 'Nenhuma entrega hoje'],
          [String(orders.filter((order) => order.status === 'producing').length), 'Em produção', 'Trabalhos iniciados'],
          [String(overdue), 'Pedidos atrasados', overdue ? 'Precisam de atenção' : 'Tudo sob controle'],
        ].map(([value, label, detail], index) => (
          <article key={label} className="rounded-2xl border border-[#ded2c5] bg-white p-4 shadow-[0_8px_24px_rgb(76_53_42/5%)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-3xl font-bold tracking-tight">{value}</p>
                <p className="mt-1 text-sm font-semibold">{label}</p>
              </div>
              <span className={`mt-1 h-3 w-3 rounded-full ${index === 1 || (index === 3 && overdue) ? 'bg-rose-500' : index === 3 ? 'bg-emerald-500' : 'bg-[#c69a45]'}`} />
            </div>
            <p className="mt-3 text-xs text-[#836e63]">{detail}</p>
          </article>
        ))}
      </section>

      {outstandingPayments.length > 0 ? (
        <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 shadow-[0_8px_24px_rgb(120_72_24/7%)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
                Atenção aos recebimentos
              </p>
              <h2 className="mt-1 text-lg font-bold text-amber-950">
                {outstandingPayments.length}{' '}
                {outstandingPayments.length === 1
                  ? 'pagamento precisa de acompanhamento'
                  : 'pagamentos precisam de acompanhamento'}
              </h2>
              <p className="mt-1 text-sm text-amber-900/75">
                Vendas aprovadas ou concluídas que ainda não foram totalmente pagas.
              </p>
            </div>
            <div className="rounded-2xl bg-white/75 px-4 py-3 text-right">
              <p className="text-xs font-bold text-amber-800">Total a receber</p>
              <p className="mt-1 text-xl font-black text-amber-950">
                {money.format(outstandingPaymentTotalCents / 100)}
              </p>
            </div>
          </div>

          <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
            {outstandingPayments.map((payment) => {
              const product = productDrafts.find(
                (item) => item.id === payment.productDraftId,
              );
              return (
                <article
                  className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={payment.negotiationId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#3d2a22]">
                      {product?.name || payment.title || 'Venda sem descrição'}
                    </p>
                    <p className="mt-1 text-xs text-[#806b60]">
                      {payment.clientName} · {payment.clientCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${paymentStatusTone[payment.paymentStatus]}`}
                    >
                      {payment.paymentStatus}
                    </span>
                    <div className="min-w-32 sm:text-right">
                      <p className="text-[11px] text-[#806b60]">Falta receber</p>
                      <p className="font-black text-[#4b3027]">
                        {money.format(payment.outstandingCents / 100)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {showOrderForm ? (
        <form className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)]" onSubmit={submitOrder}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Novo pedido de produção</h2>
              <p className="mt-1 text-sm text-[#826e63]">O pedido entrará na etapa Aprovados e receberá um código automático.</p>
            </div>
            <button className="rounded-lg px-3 py-2 text-sm font-bold text-[#765f52] hover:bg-[#f5efe8]" onClick={() => setShowOrderForm(false)} type="button">Fechar</button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Cliente cadastrado</span>
              <select autoFocus className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15" onChange={(event) => selectClient(event.target.value)} value={orderForm.clientId ?? ''}>
                <option value="">Sem cliente vinculado</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Negociação / produto *</span>
              {formClientNegotiations.length ? (
                <select className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15" onChange={(event) => selectNegotiation(event.target.value)} required value={orderForm.negotiationId ?? ''}>
                  {formClientNegotiations.map((negotiation) => {
                    const product = productDrafts.find((item) => item.id === negotiation.productDraftId);
                    const productName = product?.name || negotiation.title || 'Produto sem nome';
                    return <option key={negotiation.id} value={negotiation.id}>{productName} · {negotiation.quantity} un. · {negotiation.status}</option>;
                  })}
                </select>
              ) : formClient ? (
                <input className="w-full rounded-xl border border-[#d9cabc] bg-[#f3eee8] px-3 py-3 text-sm font-semibold text-[#806b60]" disabled placeholder={hasEligibleNegotiations ? 'Todas já foram enviadas à produção' : 'Nenhuma negociação aprovada ou concluída'} type="text" value="" />
              ) : (
                <input className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15" maxLength={140} onChange={(event) => setOrderForm((current) => ({ ...current, negotiationId: null, productDraftId: null, product: event.target.value, quantity: 1 }))} placeholder="Ex.: Kit festa personalizado" required type="text" value={orderForm.product} />
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Prazo de entrega *</span>
              <input className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15" min={today} onChange={(event) => setOrderForm((current) => ({ ...current, dueDate: event.target.value }))} required type="date" value={orderForm.dueDate} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Prioridade</span>
              <select className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15" onChange={(event) => setOrderForm((current) => ({ ...current, priority: event.target.value as ProductionPriority }))} value={orderForm.priority}>
                {productionPriorities.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#806b60]" role="status">{feedback}</p>
            <button className="rounded-xl bg-[#5c3d2e] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45" disabled={noAvailableClientNegotiation} type="submit">Adicionar à produção</button>
          </div>
        </form>
      ) : null}

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Pedidos por etapa</h2>
            <p className="text-sm text-[#836e63]">Atrasados aparecem primeiro; depois prioridade e prazo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Filtrar por prioridade" className="rounded-xl border border-[#d9cabc] bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#b8860b]" onChange={(event) => setPriorityFilter(event.target.value as ProductionPriority | 'all')} value={priorityFilter}>
              <option value="all">Todas as prioridades</option>
              {productionPriorities.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
            </select>
            <button className="rounded-xl border border-[#d9cabc] bg-white px-3 py-2.5 text-sm font-bold text-[#70574a]" onClick={() => setShowArchived((current) => !current)} type="button">Arquivados ({archivedOrders.length})</button>
            <button className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white" onClick={() => { setShowOrderForm(true); setFeedback(''); }} type="button">+ Novo pedido</button>
          </div>
        </div>

        <p className="mb-3 min-h-4 text-xs text-[#806b60]" role="status">{feedback}</p>
        <div className="grid gap-4 xl:grid-cols-4">
          {columns.map((column) => (
            <div key={column.status} className="min-w-0 rounded-2xl border border-[#ddd0c2] bg-[#eee5da] p-3">
              <div className="mb-3 flex items-center justify-between px-1 py-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${column.tone}`} />
                  <h3 className="text-sm font-bold">{column.title}</h3>
                </div>
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-[#725a4d]">{column.orders.length}</span>
              </div>

              <div className="space-y-3">
                {column.orders.map((order) => {
                  const client = clients.find((item) => item.id === order.clientId);
                  const due = dueLabel(order.dueDate, order.status);
                  return (
                    <article key={order.id} className={`min-w-0 rounded-xl border border-[#ded4ca] border-l-4 bg-white p-4 shadow-[0_6px_16px_rgb(76_53_42/6%)] ${priorityAccents[order.priority]}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-bold tracking-wide text-[#956f59]">{order.code}</p>
                        <select aria-label={`Prioridade de ${order.code}`} className="min-w-0 rounded-lg border border-[#e3d8ce] bg-[#f4eee7] px-2 py-1 text-[10px] font-bold text-[#70574a] outline-none" disabled={order.status === 'delivered'} onChange={(event) => changePriority(order.id, event.target.value as ProductionPriority)} value={order.priority}>
                          {productionPriorities.map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
                        </select>
                      </div>
                      <h4 className="mt-3 break-words text-sm font-bold leading-5">{order.product}</h4>
                      <p className="mt-1 text-xs font-semibold text-[#70594d]">{order.quantity} {order.quantity === 1 ? 'unidade' : 'unidades'}</p>
                      <p className="mt-1 truncate text-xs text-[#877166]">{client ? client.name : 'Sem cliente vinculado'}</p>
                      <div className="mt-4 flex items-center justify-between border-t border-[#eee7df] pt-3 text-xs">
                        <span className="text-[#8a7467]">Entrega</span>
                        <span className={`text-right font-bold ${due.startsWith('Atrasado') || due === 'Hoje' ? 'text-rose-600' : 'text-[#49352c]'}`}>{due}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {transitionActions(order.status).map((action) => (
                          <button key={action.status} className={action.primary ? 'rounded-lg bg-[#5c3d2e] px-2.5 py-2 text-[11px] font-bold text-white' : 'rounded-lg border border-[#d7c8ba] px-2.5 py-2 text-[11px] font-bold text-[#70574a]'} onClick={() => moveOrder(order.id, action.status)} type="button">{action.label}</button>
                        ))}
                        {order.status === 'delivered' ? (
                          <button className="rounded-lg border border-[#d7c8ba] px-2.5 py-2 text-[11px] font-bold text-[#70574a]" onClick={() => archiveOrder(order.id)} type="button">Arquivar</button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {column.orders.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#c9b8aa] px-3 py-5 text-center text-xs text-[#816a5e]">Nenhum pedido nesta etapa</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showArchived ? (
        <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Histórico de pedidos arquivados</h2>
              <p className="mt-1 text-sm text-[#826e63]">Ficam fora do quadro, mas continuam vinculados aos clientes.</p>
            </div>
            <span className="rounded-full bg-[#f0eadf] px-3 py-1.5 text-xs font-bold text-[#70594d]">{archivedOrders.length}</span>
          </div>
          <div className="mt-4 space-y-2">
            {archivedOrders.length ? archivedOrders.map((order) => {
              const client = clients.find((item) => item.id === order.clientId);
              return (
                <article key={order.id} className="flex flex-col gap-3 rounded-xl border border-[#e7ddd3] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold">{order.product}</p>
                    <p className="mt-1 text-xs text-[#826e63]">{order.quantity} {order.quantity === 1 ? 'unidade' : 'unidades'} · {order.code} · {client?.name ?? 'Sem cliente vinculado'}</p>
                  </div>
                  <button className="rounded-lg border border-[#d7c8ba] px-3 py-2 text-xs font-bold text-[#70574a]" onClick={() => restoreArchivedOrder(order.id)} type="button">Restaurar em Entregues</button>
                </article>
              );
            }) : <p className="rounded-xl border border-dashed border-[#d8c9bb] p-5 text-center text-sm text-[#826e63]">Nenhum pedido arquivado.</p>}
          </div>
        </section>
      ) : null}

      <p className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{desktopAvailable ? 'Os pedidos ficam no banco local deste computador e entram nos backups automáticos. Os logs técnicos não recebem o conteúdo dos pedidos.' : 'Modo de demonstração: use somente informações fictícias. Pedidos e vínculos ficam neste dispositivo e não são enviados aos logs técnicos.'}</p>
    </div>
  );
}
