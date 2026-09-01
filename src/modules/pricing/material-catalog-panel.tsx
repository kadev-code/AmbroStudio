'use client';

import { useMemo, useState } from 'react';
import {
  createPricingMaterial,
  filterPricingMaterials,
  materialUnitCostCents,
  measurementUnitLabels,
  setPricingMaterialArchived,
  updatePricingMaterial,
  type MaterialInput,
  type PricingMaterial,
} from '@/src/domain/pricing/material';
import { MaterialForm } from './material-form';
import { formatUnitCost, money } from './pricing-format';

type MaterialCatalogPanelProps = {
  materials: PricingMaterial[];
  onChange(materials: PricingMaterial[]): Promise<void>;
};

export function MaterialCatalogPanel({
  materials,
  onChange,
}: MaterialCatalogPanelProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pendingMaterialId, setPendingMaterialId] = useState('');

  const visibleMaterials = useMemo(
    () =>
      [...filterPricingMaterials(materials, query)].sort(
        (first, second) =>
          Number(first.archived) - Number(second.archived) ||
          first.description.localeCompare(second.description, 'pt-BR'),
      ),
    [materials, query],
  );
  const editingMaterial = materials.find((item) => item.id === editingId);

  async function saveNew(input: MaterialInput) {
    const next = createPricingMaterial(materials, input);
    await onChange(next);
    setIsCreating(false);
    setFeedback('Material salvo e disponível nas simulações.');
  }

  async function saveEdit(input: MaterialInput) {
    if (!editingId) return;
    const next = updatePricingMaterial(materials, editingId, input);
    await onChange(next);
    setEditingId(null);
    setFeedback('Material atualizado. Os produtos vinculados foram recalculados.');
  }

  async function toggleArchived(material: PricingMaterial) {
    if (pendingMaterialId) return;
    setPendingMaterialId(material.id);
    const next = setPricingMaterialArchived(
      materials,
      material.id,
      !material.archived,
    );
    try {
      await onChange(next);
      setFeedback(
        material.archived
          ? 'Material reativado.'
          : 'Material arquivado. Ele continua preservado nos produtos existentes.',
      );
    } catch {
      setFeedback(
        'Não foi possível atualizar o material. O cadastro anterior foi preservado.',
      );
    } finally {
      setPendingMaterialId('');
    }
  }

  return (
    <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)] sm:p-6">
      <div className="flex flex-col gap-4 border-b border-[#eee4da] pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">
            Catálogo de custos
          </p>
          <h2 className="mt-1 text-xl font-bold">Materiais de uso</h2>
          <p className="mt-1 text-sm text-[#806b60]">
            Cadastre cada compra na mesma unidade usada na produção.
          </p>
        </div>
        <button
          className="rounded-xl bg-[#5c3d2e] px-4 py-3 text-sm font-bold text-white hover:bg-[#4c3125]"
          onClick={() => {
            setEditingId(null);
            setIsCreating(true);
            setFeedback('');
          }}
          type="button"
        >
          + Novo material
        </button>
      </div>

      {(isCreating || editingMaterial) && (
        <div className="mt-5">
          <MaterialForm
            initialMaterial={editingMaterial}
            key={editingMaterial?.id ?? 'new-material'}
            onCancel={() => {
              setIsCreating(false);
              setEditingId(null);
            }}
            onSave={editingMaterial ? saveEdit : saveNew}
          />
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          aria-label="Pesquisar materiais"
          className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] sm:max-w-sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pesquisar material..."
          type="search"
          value={query}
        />
        <p className="text-xs text-[#806b60]" role="status">
          {feedback || `${materials.length} ${materials.length === 1 ? 'material cadastrado' : 'materiais cadastrados'}`}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e2d6ca]">
        <table className="min-w-[920px] w-full border-collapse text-left text-sm">
          <thead className="bg-[#f5efe8] text-xs uppercase tracking-wide text-[#8a6756]">
            <tr>
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3">Preço pago</th>
              <th className="px-4 py-3">Quantidade</th>
              <th className="px-4 py-3">Custo unitário</th>
              <th className="px-4 py-3">Compra</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visibleMaterials.map((material) => (
              <tr
                className={`border-t border-[#eee4da] ${material.archived ? 'bg-[#faf8f5] text-[#96867d]' : 'bg-white'}`}
                key={material.id}
              >
                <td className="px-4 py-4">
                  <div className="font-bold text-[#3d2a22]">
                    {material.description}
                  </div>
                  <div className="mt-1 max-w-xs truncate text-xs">
                    {material.archived
                      ? 'Arquivado'
                      : material.notes || 'Sem observação'}
                  </div>
                </td>
                <td className="px-4 py-4 font-semibold">
                  {money.format(material.purchasePriceCents / 100)}
                </td>
                <td className="px-4 py-4">
                  {new Intl.NumberFormat('pt-BR', {
                    maximumFractionDigits: 4,
                  }).format(material.purchasedQuantity)}{' '}
                  {measurementUnitLabels[material.measurementUnit]}
                </td>
                <td className="px-4 py-4 font-bold text-[#7c552d]">
                  {formatUnitCost(
                    materialUnitCostCents(material),
                    material.measurementUnit,
                  )}
                </td>
                <td className="px-4 py-4">
                  {material.purchaseUrl ? (
                    <a
                      className="font-bold text-[#895c24] hover:underline"
                      href={material.purchaseUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Abrir link
                    </a>
                  ) : (
                    <span className="text-[#99887e]">Sem link</span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <button
                      className="rounded-lg border border-[#d8c7b7] px-3 py-2 text-xs font-bold text-[#6d4a39]"
                      onClick={() => {
                        setIsCreating(false);
                        setEditingId(material.id);
                        setFeedback('');
                      }}
                      type="button"
                    >
                      Editar
                    </button>
                    <button
                      className="rounded-lg border border-[#d8c7b7] px-3 py-2 text-xs font-bold text-[#6d4a39]"
                      disabled={Boolean(pendingMaterialId)}
                      onClick={() => void toggleArchived(material)}
                      type="button"
                    >
                      {pendingMaterialId === material.id
                        ? 'Salvando...'
                        : material.archived
                          ? 'Reativar'
                          : 'Arquivar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleMaterials.length === 0 && (
          <div className="p-10 text-center text-sm text-[#806b60]">
            {materials.length === 0
              ? 'Nenhum material cadastrado. Use “Novo material” para começar.'
              : 'Nenhum material encontrado nesta pesquisa.'}
          </div>
        )}
      </div>
    </section>
  );
}
