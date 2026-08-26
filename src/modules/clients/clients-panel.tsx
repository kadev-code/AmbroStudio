import { useMemo, useState, type FormEvent } from 'react';
import {
  addClientNegotiationAttachments,
  addClientNegotiation,
  clientContactInputSchema,
  clientMetrics,
  createClientDraft,
  editClientDraft,
  editClientNegotiation,
  filterClientDrafts,
  findPhoneConflict,
  negotiationInputSchema,
  negotiationStatuses,
  removeClientNegotiationAttachment,
  type NegotiationAttachment,
  type NegotiationInput,
} from '@/src/domain/clients/client';
import {
  loadClientDrafts,
  persistClientDrafts,
} from '@/src/infrastructure/clients/local-client-draft-repository';
import { loadProductionDrafts } from '@/src/infrastructure/production/local-production-draft-repository';
import {
  loadPricingProductDrafts,
  suggestedPriceForProductDraft,
} from '@/src/modules/pricing/pricing-product-drafts';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const emptyClientForm = {
  name: '',
  phone: '',
  email: '',
  interestedProductIds: [] as string[],
};

function currentLocalDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

const emptyNegotiationForm = (): NegotiationInput => ({
  productDraftId: null,
  title: '',
  quantity: 1,
  status: 'Em negociação',
  amountCents: 0,
  occurredOn: currentLocalDate(),
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('pt-BR'))
    .join('');
}

function formatStoredDate(value: string | null) {
  return value
    ? date.format(new Date(`${value}T12:00:00.000Z`))
    : 'Sem compra';
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientsPanel() {
  const desktopAvailable =
    typeof window !== 'undefined' && Boolean(window.ambroDesktop);
  const [clients, setClients] = useState(loadClientDrafts);
  const [productDrafts] = useState(loadPricingProductDrafts);
  const [productionOrders] = useState(loadProductionDrafts);
  const [query, setQuery] = useState('');
  const [showClientForm, setShowClientForm] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [editingClientId, setEditingClientId] = useState('');
  const [clientFeedback, setClientFeedback] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showNegotiationForm, setShowNegotiationForm] = useState(false);
  const [negotiationForm, setNegotiationForm] = useState(emptyNegotiationForm);
  const [editingNegotiationId, setEditingNegotiationId] = useState('');
  const [negotiationFeedback, setNegotiationFeedback] = useState('');

  const visibleClients = useMemo(
    () => filterClientDrafts(clients, query),
    [clients, query],
  );
  const selectedClient = clients.find(
    (client) => client.id === selectedClientId,
  );
  const selectedClientProducts = productDrafts.filter((product) =>
    selectedClient?.interestedProductIds.includes(product.id),
  );
  const archivedClientOrders = productionOrders.filter(
    (order) => order.clientId === selectedClientId && order.archivedAt,
  );
  const openNegotiations = clients.reduce(
    (total, client) => total + clientMetrics(client).openNegotiations,
    0,
  );
  const recurrentClients = clients.filter(
    (client) => clientMetrics(client).purchases > 1,
  ).length;

  function saveClients(nextClients: typeof clients) {
    setClients(nextClients);
    persistClientDrafts(nextClients);
  }

  function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = clientContactInputSchema.safeParse(clientForm);
    if (!parsed.success) {
      setClientFeedback(
        'Informe nome, telefone e um e-mail válido quando preenchido.',
      );
      return;
    }

    const duplicateClient = findPhoneConflict(
      clients,
      parsed.data.phone,
      editingClientId,
    );
    if (duplicateClient) {
      setSelectedClientId(duplicateClient.id);
      setClientFeedback(
        `Este telefone já pertence ao cadastro ${duplicateClient.code}. Abra o histórico e edite o cliente existente.`,
      );
      return;
    }

    const nextClients = editingClientId
      ? editClientDraft(clients, editingClientId, parsed.data)
      : createClientDraft(clients, parsed.data);
    saveClients(nextClients);
    setSelectedClientId(editingClientId || nextClients[0].id);
    setClientForm(emptyClientForm);
    setEditingClientId('');
    setShowClientForm(false);
    setClientFeedback(
      editingClientId
        ? 'Cadastro do cliente atualizado.'
        : 'Cliente salvo neste dispositivo.',
    );
  }

  function startNewClient() {
    setEditingClientId('');
    setClientForm(emptyClientForm);
    setClientFeedback('');
    setShowClientForm(true);
  }

  function startEditingClient(clientId = selectedClientId) {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    setSelectedClientId(client.id);
    setEditingClientId(client.id);
    setClientForm({
      name: client.name,
      phone: client.phone,
      email: client.email,
      interestedProductIds: [...client.interestedProductIds],
    });
    setClientFeedback('Altere os dados desejados e salve.');
    setShowClientForm(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById('client-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function toggleProductInterest(productId: string) {
    setClientForm((current) => ({
      ...current,
      interestedProductIds: current.interestedProductIds.includes(productId)
        ? current.interestedProductIds.filter((id) => id !== productId)
        : [...current.interestedProductIds, productId],
    }));
  }

  function submitNegotiation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClient) return;

    if (!negotiationForm.productDraftId) {
      setNegotiationFeedback('Selecione o produto desta negociação.');
      return;
    }

    const parsed = negotiationInputSchema.safeParse(negotiationForm);
    if (!parsed.success) {
      setNegotiationFeedback(
        'Revise o produto, a quantidade, o valor, a data e a situação.',
      );
      return;
    }

    const nextClients = editingNegotiationId
      ? editClientNegotiation(
          clients,
          selectedClient.id,
          editingNegotiationId,
          parsed.data,
        )
      : addClientNegotiation(clients, selectedClient.id, parsed.data);
    saveClients(nextClients);
    setNegotiationForm(emptyNegotiationForm());
    setEditingNegotiationId('');
    setShowNegotiationForm(false);
    setNegotiationFeedback(
      editingNegotiationId
        ? 'Negociação atualizada. A situação do cliente foi recalculada.'
        : 'Negociação vinculada ao cliente.',
    );
  }

  function startNewNegotiation() {
    setEditingNegotiationId('');
    const initialProduct = selectedClientProducts[0];
    setNegotiationForm({
      ...emptyNegotiationForm(),
      productDraftId: initialProduct?.id ?? null,
      amountCents: suggestedPriceForProductDraft(initialProduct) ?? 0,
    });
    setShowNegotiationForm(true);
    setNegotiationFeedback('');
  }

  function startEditingNegotiation(negotiationId: string) {
    const negotiation = selectedClient?.negotiations.find(
      (item) => item.id === negotiationId,
    );
    if (!negotiation) return;

    setEditingNegotiationId(negotiation.id);
    setNegotiationForm({
      productDraftId: negotiation.productDraftId,
      title: negotiation.title,
      quantity: negotiation.quantity,
      status: negotiation.status,
      amountCents: negotiation.amountCents,
      occurredOn: negotiation.occurredOn,
    });
    setShowNegotiationForm(true);
    setNegotiationFeedback('Altere os campos desejados e salve.');
  }

  function suggestedNegotiationTotal(productId: string | null, quantity: number) {
    const product = productDrafts.find((item) => item.id === productId);
    const unitPrice = suggestedPriceForProductDraft(product);
    if (unitPrice === null) return null;

    const total = unitPrice * quantity;
    return Number.isSafeInteger(total) && total <= 999_999_999 ? total : null;
  }

  function changeNegotiationProduct(productId: string) {
    setNegotiationForm((current) => ({
      ...current,
      productDraftId: productId || null,
      amountCents:
        suggestedNegotiationTotal(productId || null, current.quantity ?? 1) ??
        current.amountCents,
    }));
  }

  function changeNegotiationQuantity(value: string) {
    const quantity = Math.max(1, Math.min(100_000, Math.round(Number(value) || 1)));
    setNegotiationForm((current) => ({
      ...current,
      quantity,
      amountCents:
        suggestedNegotiationTotal(current.productDraftId ?? null, quantity) ??
        current.amountCents,
    }));
  }

  async function addNegotiationAttachments(
    negotiationId: string,
    currentAttachments: NegotiationAttachment[],
  ) {
    if (!selectedClient || !window.ambroDesktop) return;
    const remainingSlots = 20 - currentAttachments.length;
    if (remainingSlots <= 0) {
      setNegotiationFeedback('Esta negociação já possui o limite de 20 anexos.');
      return;
    }

    try {
      const result = await window.ambroDesktop.attachments.add(remainingSlots);
      if (result.status !== 'success') return;
      const nextClients = addClientNegotiationAttachments(
        clients,
        selectedClient.id,
        negotiationId,
        result.attachments,
      );
      saveClients(nextClients);
      setNegotiationFeedback(
        `${result.attachments.length} ${result.attachments.length === 1 ? 'anexo adicionado' : 'anexos adicionados'}.`,
      );
    } catch {
      setNegotiationFeedback(
        'Não foi possível adicionar o anexo. Use arquivos de até 25 MB.',
      );
    }
  }

  async function openNegotiationAttachment(attachmentId: string) {
    try {
      await window.ambroDesktop?.attachments.open(attachmentId);
    } catch {
      setNegotiationFeedback('Não foi possível abrir este anexo.');
    }
  }

  async function removeNegotiationAttachment(
    negotiationId: string,
    attachment: NegotiationAttachment,
  ) {
    if (!selectedClient || !window.ambroDesktop) return;
    if (!window.confirm(`Remover o anexo “${attachment.fileName}”?`)) return;

    try {
      await window.ambroDesktop.attachments.remove(attachment.id);
      saveClients(
        removeClientNegotiationAttachment(
          clients,
          selectedClient.id,
          negotiationId,
          attachment.id,
        ),
      );
      setNegotiationFeedback('Anexo removido da negociação.');
    } catch {
      setNegotiationFeedback('Não foi possível remover este anexo.');
    }
  }

  return (
    <div className="space-y-5">
      <section
        aria-label="Resumo dos clientes"
        className="grid gap-4 md:grid-cols-3"
      >
        {[
          [
            String(clients.length),
            'Clientes cadastrados',
            desktopAvailable ? 'Registros neste computador' : 'Rascunhos neste dispositivo',
          ],
          [
            String(openNegotiations),
            'Negociações abertas',
            'Vinculadas aos clientes',
          ],
          [
            String(recurrentClients),
            'Clientes recorrentes',
            'Mais de uma compra aprovada',
          ],
        ].map(([value, label, detail]) => (
          <article
            key={label}
            className="rounded-2xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)]"
          >
            <p className="text-3xl font-black">{value}</p>
            <p className="mt-1 text-sm font-bold">{label}</p>
            <p className="mt-3 text-xs text-[#826e63]">{detail}</p>
          </article>
        ))}
      </section>

      {showClientForm ? (
        <form
          id="client-form"
          className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)]"
          onSubmit={submitClient}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">
                {editingClientId ? 'Editar cliente' : 'Novo cliente'}
              </h2>
              <p className="mt-1 text-sm text-[#826e63]">
                Um único cadastro pode reunir vários produtos, negociações e compras.
              </p>
            </div>
                          <button
              className="rounded-lg px-3 py-2 text-sm font-bold text-[#765f52] hover:bg-[#f5efe8]"
              onClick={() => {
                setShowClientForm(false);
                setEditingClientId('');
                setClientForm(emptyClientForm);
              }}
              type="button"
            >
              Fechar
            </button>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                Nome *
              </span>
              <input
                autoFocus
                className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                maxLength={120}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                type="text"
                value={clientForm.name}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                Telefone *
              </span>
              <input
                className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                inputMode="tel"
                maxLength={30}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="(00) 00000-0000"
                required
                type="tel"
                value={clientForm.phone}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                E-mail
              </span>
              <input
                className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                maxLength={160}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                type="email"
                value={clientForm.email}
              />
            </label>
            <fieldset className="block md:col-span-3">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                Produtos que o cliente procura
              </span>
              {productDrafts.length ? (
                <div className="grid gap-2 rounded-xl border border-[#d9cabc] bg-[#fcfaf7] p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {productDrafts.map((product) => {
                    const selected = clientForm.interestedProductIds.includes(
                      product.id,
                    );
                    return (
                      <label
                        key={product.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ${selected ? 'border-[#b8860b] bg-[#f3e7cf] text-[#5c3d2e]' : 'border-[#e5dbd1] bg-white text-[#705f55]'}`}
                      >
                        <input
                          checked={selected}
                          className="h-4 w-4 accent-[#7b542e]"
                          onChange={() => toggleProductInterest(product.id)}
                          type="checkbox"
                        />
                        <span className="min-w-0 truncate">{product.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm text-[#806b60]">
                  Cadastre primeiro os produtos na área de Precificação.
                </p>
              )}
              <p className="mt-2 text-xs text-[#806b60]">
                Marque todos os produtos de interesse; eles aparecerão ao criar um pedido.
              </p>
            </fieldset>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[#806b60]" role="status">
              {clientFeedback}
            </p>
            <button
              className="rounded-xl bg-[#5c3d2e] px-5 py-3 text-sm font-bold text-white"
              type="submit"
            >
              {editingClientId ? 'Salvar alterações' : 'Salvar cliente'}
            </button>
          </div>
        </form>
      ) : null}

      <section className="overflow-hidden rounded-3xl border border-[#ded2c5] bg-white shadow-[0_8px_24px_rgb(76_53_42/5%)]">
        <div className="flex flex-col gap-3 border-b border-[#e9dfd5] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">
              Clientes e histórico de vendas
            </h2>
            <p className="mt-1 text-sm text-[#826e63]">
              Pesquise pelo nome, telefone, e-mail ou código.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Pesquisar clientes"
              className="min-w-0 rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-2.5 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar..."
              type="search"
              value={query}
            />
            <button
              className="shrink-0 rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white"
              onClick={startNewClient}
              type="button"
            >
              + Cliente
            </button>
          </div>
        </div>

        {visibleClients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-[#f5efe8] text-xs uppercase tracking-wide text-[#836b5e]">
                <tr>
                  <th className="px-5 py-3 font-bold">Cliente</th>
                  <th className="px-5 py-3 font-bold">Compras</th>
                  <th className="px-5 py-3 font-bold">Em negociação</th>
                  <th className="px-5 py-3 font-bold">Última compra</th>
                  <th className="px-5 py-3 font-bold">Situação</th>
                  <th className="px-5 py-3 text-right font-bold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((client) => {
                  const metrics = clientMetrics(client);
                  return (
                    <tr key={client.id} className="border-t border-[#eee5dc]">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ead9bf] text-xs font-black text-[#5c3d2e]">
                            {initials(client.name)}
                          </span>
                          <div>
                            <p className="font-bold">{client.name}</p>
                            <p className="text-xs text-[#927b6f]">
                              {client.code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {metrics.purchases}
                      </td>
                      <td className="px-5 py-4 font-semibold">
                        {metrics.openNegotiations}
                      </td>
                      <td className="px-5 py-4 text-[#6f5b50]">
                        {formatStoredDate(metrics.lastPurchaseOn)}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[#f0eadf] px-2.5 py-1 text-xs font-bold text-[#70594d]">
                          {metrics.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            className="font-bold text-[#8b5f24] hover:underline"
                            onClick={() => startEditingClient(client.id)}
                            type="button"
                          >
                            Editar
                          </button>
                          <button
                            className="font-bold text-[#8b5f24] hover:underline"
                            onClick={() => {
                              setSelectedClientId(client.id);
                              setShowNegotiationForm(false);
                              setEditingNegotiationId('');
                              setNegotiationFeedback('');
                            }}
                            type="button"
                          >
                            Abrir histórico
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center">
            <p className="text-base font-bold">
              {query
                ? 'Nenhum cliente encontrado'
                : 'Nenhum cliente cadastrado'}
            </p>
            <p className="mt-2 text-sm text-[#826e63]">
              {query
                ? 'Tente outra pesquisa.'
                : 'Cadastre o primeiro cliente para iniciar o histórico.'}
            </p>
          </div>
        )}
      </section>

      {selectedClient ? (
        <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">
                Histórico {selectedClient.code}
              </p>
              <h2 className="mt-1 text-xl font-bold">{selectedClient.name}</h2>
              <p className="mt-1 text-sm text-[#826e63]">
                {selectedClient.phone}
                {selectedClient.email ? ` · ${selectedClient.email}` : ''}
              </p>
              <p className="mt-2 text-xs font-semibold text-[#8b5f24]">
                {selectedClientProducts.length
                  ? `Interesse: ${selectedClientProducts.map((product) => product.name).join(', ')}`
                  : 'Nenhum produto de interesse vinculado'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-[#d7c8ba] bg-white px-4 py-2.5 text-sm font-bold text-[#70574a]"
                onClick={() => startEditingClient(selectedClient.id)}
                type="button"
              >
                Editar cliente
              </button>
              <button
                className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white"
                onClick={startNewNegotiation}
                type="button"
              >
                + Negociação ou venda
              </button>
            </div>
          </div>

          {!showNegotiationForm && negotiationFeedback ? (
            <p className="mt-3 text-xs font-semibold text-[#7a6459]" role="status">
              {negotiationFeedback}
            </p>
          ) : null}

          {showNegotiationForm ? (
            <form
              className="mt-5 rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4"
              onSubmit={submitNegotiation}
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Produto *
                  </span>
                  <select
                    autoFocus
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    disabled={productDrafts.length === 0}
                    onChange={(event) => changeNegotiationProduct(event.target.value)}
                    required
                    value={negotiationForm.productDraftId ?? ''}
                  >
                    <option value="">
                      {productDrafts.length
                        ? 'Selecione um produto'
                        : 'Cadastre um produto em Precificação'}
                    </option>
                    {productDrafts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Quantidade
                  </span>
                  <input
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    max="100000"
                    min="1"
                    onChange={(event) => changeNegotiationQuantity(event.target.value)}
                    step="1"
                    type="number"
                    value={negotiationForm.quantity ?? 1}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Descrição
                  </span>
                  <input
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    maxLength={120}
                    onChange={(event) =>
                      setNegotiationForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Observação opcional"
                    type="text"
                    value={negotiationForm.title}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Situação
                  </span>
                  <select
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    onChange={(event) =>
                      setNegotiationForm((current) => ({
                        ...current,
                        status: event.target.value as NegotiationInput['status'],
                      }))
                    }
                    value={negotiationForm.status}
                  >
                    {negotiationStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Valor sugerido
                  </span>
                  <div className="flex items-center rounded-xl border border-[#d9cabc] bg-white focus-within:border-[#b8860b] focus-within:ring-3 focus-within:ring-[#c69a45]/15">
                    <span className="pl-3 text-xs font-bold text-[#9a7f70]">
                      R$
                    </span>
                    <input
                      className="min-w-0 flex-1 bg-transparent px-2 py-3 text-right text-sm font-semibold outline-none"
                      max="9999999.99"
                      min="0"
                      onChange={(event) =>
                        setNegotiationForm((current) => ({
                          ...current,
                          amountCents: Math.round(
                            Math.max(0, Number(event.target.value) || 0) * 100,
                          ),
                        }))
                      }
                      step="0.01"
                      type="number"
                      value={negotiationForm.amountCents / 100}
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">
                    Data
                  </span>
                  <input
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    onChange={(event) =>
                      setNegotiationForm((current) => ({
                        ...current,
                        occurredOn: event.target.value,
                      }))
                    }
                    required
                    type="date"
                    value={negotiationForm.occurredOn}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[#806b60]" role="status">
                  {negotiationFeedback}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-xl border border-[#ccbbaa] bg-white px-4 py-2.5 text-sm font-bold text-[#6d5448]"
                    onClick={() => {
                      setShowNegotiationForm(false);
                      setEditingNegotiationId('');
                      setNegotiationForm(emptyNegotiationForm());
                    }}
                    type="button"
                  >
                    Cancelar
                  </button>
                  <button
                    className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white"
                    type="submit"
                  >
                    {editingNegotiationId ? 'Salvar alterações' : 'Salvar no histórico'}
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          <div className="mt-5 space-y-3">
            {selectedClient.negotiations.length > 0 ? (
              selectedClient.negotiations.map((negotiation) => (
                <article
                  key={negotiation.id}
                  className="flex flex-col gap-3 rounded-2xl border border-[#e7ddd3] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {productDrafts.find(
                        (product) => product.id === negotiation.productDraftId,
                      )?.name ??
                        (negotiation.title || 'Negociação sem produto vinculado')}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#8b5f24]">
                      {negotiation.quantity} {negotiation.quantity === 1 ? 'unidade' : 'unidades'}
                    </p>
                    {negotiation.productDraftId && negotiation.title ? (
                      <p className="mt-1 text-xs text-[#6f5b50]">
                        {negotiation.title}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-[#826e63]">
                      {formatStoredDate(negotiation.occurredOn)}
                    </p>
                    {negotiation.attachments.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {negotiation.attachments.map((attachment) => (
                          <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[#e1d5c9] bg-[#faf7f3] px-2 py-1 text-xs">
                            <button className="max-w-52 truncate font-semibold text-[#7b542e] hover:underline" onClick={() => openNegotiationAttachment(attachment.id)} title={`Abrir ${attachment.fileName}`} type="button">{attachment.fileName}</button>
                            <span className="shrink-0 text-[#998277]">{formatFileSize(attachment.sizeBytes)}</span>
                            {desktopAvailable ? (
                              <button aria-label={`Remover ${attachment.fileName}`} className="ml-1 shrink-0 font-black text-rose-600" onClick={() => removeNegotiationAttachment(negotiation.id, attachment)} title="Remover anexo" type="button">×</button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end sm:text-right">
                    {desktopAvailable ? (
                      <button
                        className="rounded-lg border border-[#d7c8ba] px-2.5 py-1.5 text-xs font-bold text-[#8b5f24] hover:bg-[#f8f3ed]"
                        onClick={() => addNegotiationAttachments(negotiation.id, negotiation.attachments)}
                        type="button"
                      >
                        + Anexo
                      </button>
                    ) : null}
                    <button
                      className="rounded-lg border border-[#d7c8ba] px-2.5 py-1.5 text-xs font-bold text-[#8b5f24] hover:bg-[#f8f3ed]"
                      onClick={() => startEditingNegotiation(negotiation.id)}
                      type="button"
                    >
                      Editar
                    </button>
                    <span className="rounded-full bg-[#f0eadf] px-2.5 py-1 text-xs font-bold text-[#70594d]">
                      {negotiation.status}
                    </span>
                    <p className="min-w-24 font-black">
                      {money.format(negotiation.amountCents / 100)}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-[#d8c9bb] p-6 text-center text-sm text-[#826e63]">
                Nenhuma negociação ou venda vinculada a este cliente.
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-[#e9dfd5] pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">Pedidos arquivados</h3>
                <p className="mt-1 text-xs text-[#826e63]">
                  Entregas retiradas do quadro de produção.
                </p>
              </div>
              <span className="rounded-full bg-[#f0eadf] px-2.5 py-1 text-xs font-bold text-[#70594d]">
                {archivedClientOrders.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {archivedClientOrders.length ? (
                archivedClientOrders.map((order) => (
                  <article
                    key={order.id}
                    className="flex flex-col gap-2 rounded-xl border border-[#e7ddd3] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-bold">{order.product}</p>
                      <p className="mt-1 text-xs text-[#826e63]">
                        {order.quantity}{' '}
                        {order.quantity === 1 ? 'unidade' : 'unidades'} ·{' '}
                        {order.code}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-[#70594d]">
                      Entregue e arquivado
                    </span>
                  </article>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-[#d8c9bb] p-4 text-center text-sm text-[#826e63]">
                  Nenhum pedido arquivado para este cliente.
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <p className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        {desktopAvailable
          ? 'Os cadastros ficam no banco local deste computador e entram nos backups automáticos. Nome, telefone, e-mail e negociações nunca são enviados aos logs técnicos.'
          : 'Modo de demonstração: use apenas informações fictícias. Os dados ficam somente neste dispositivo e não são enviados aos logs.'}
      </p>
    </div>
  );
}
