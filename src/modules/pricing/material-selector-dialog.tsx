'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  filterPricingMaterials,
  materialUsageCostCents,
  materialUsagesCostCents,
  materialUsagesSchema,
  measurementUnitLabels,
  type MaterialInput,
  type MaterialUsage,
  type PricingMaterial,
} from '@/src/domain/pricing/material';
import { MaterialForm } from './material-form';
import {
  decimalInputValue,
  money,
  parseLocalizedNumber,
} from './pricing-format';

type MaterialSelectorDialogProps = {
  materials: PricingMaterial[];
  initialUsages: MaterialUsage[];
  onCancel(): void;
  onConfirm(usages: MaterialUsage[]): void;
  onCreateMaterial(input: MaterialInput): PricingMaterial;
};

export function MaterialSelectorDialog({
  materials,
  initialUsages,
  onCancel,
  onConfirm,
  onCreateMaterial,
}: MaterialSelectorDialogProps) {
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialUsages.map((usage) => [
        usage.materialId,
        decimalInputValue(usage.usedQuantity),
      ]),
    ),
  );

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  const selectedIds = useMemo(
    () => new Set(Object.keys(quantities)),
    [quantities],
  );
  const selectableMaterials = useMemo(
    () =>
      [...filterPricingMaterials(
        materials.filter(
          (material) => !material.archived || selectedIds.has(material.id),
        ),
        query,
      )].sort((first, second) =>
        first.description.localeCompare(second.description, 'pt-BR'),
      ),
    [materials, query, selectedIds],
  );

  const validUsages = useMemo(
    () =>
      Object.entries(quantities).flatMap(([materialId, rawQuantity]) => {
        const usedQuantity = parseLocalizedNumber(rawQuantity);
        return Number.isFinite(usedQuantity) && usedQuantity > 0
          ? [{ materialId, usedQuantity }]
          : [];
      }),
    [quantities],
  );
  const totalCents = useMemo(() => {
    try {
      return materialUsagesCostCents(validUsages, materials);
    } catch {
      return 0;
    }
  }, [materials, validUsages]);

  function toggle(materialId: string) {
    setQuantities((current) => {
      if (Object.hasOwn(current, materialId)) {
        const next = { ...current };
        delete next[materialId];
        return next;
      }
      return { ...current, [materialId]: '1' };
    });
    setFeedback('');
  }

  function confirm() {
    const rawUsages = Object.entries(quantities).map(
      ([materialId, rawQuantity]) => ({
        materialId,
        usedQuantity: parseLocalizedNumber(rawQuantity),
      }),
    );
    const parsed = materialUsagesSchema.safeParse(rawUsages);
    if (!parsed.success) {
      setFeedback('Informe uma quantidade maior que zero para cada material selecionado.');
      return;
    }
    onConfirm(parsed.data);
  }

  function createMaterial(input: MaterialInput) {
    const material = onCreateMaterial(input);
    setQuantities((current) => ({ ...current, [material.id]: '1' }));
    setShowCreate(false);
    setFeedback('Material cadastrado e selecionado. Ajuste a quantidade usada.');
  }

  return (
    <div
      aria-labelledby="material-selector-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2c1b15]/55 p-3 sm:p-6"
      role="dialog"
    >
      <section className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-[#ded2c5] bg-white shadow-2xl">
        <header className="flex flex-col gap-3 border-b border-[#eee4da] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">
              Receita do produto
            </p>
            <h2 className="mt-1 text-xl font-bold" id="material-selector-title">
              Selecionar materiais por peça
            </h2>
            <p className="mt-1 text-sm text-[#806b60]">
              Marque os materiais e informe quanto é usado para produzir uma peça.
            </p>
          </div>
          <button
            className="text-sm font-bold text-[#765f52]"
            onClick={onCancel}
            type="button"
          >
            Fechar
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {showCreate && (
            <div className="mb-5">
              <MaterialForm
                onCancel={() => setShowCreate(false)}
                onSave={createMaterial}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              aria-label="Pesquisar material para selecionar"
              autoFocus
              className="w-full rounded-xl border border-[#d9cabc] bg-[#fcfaf7] px-3 py-3 text-sm outline-none focus:border-[#b8860b] sm:max-w-md"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar papel, cola, caixa..."
              type="search"
              value={query}
            />
            <button
              className="rounded-xl border border-[#ccbbaa] bg-white px-4 py-3 text-sm font-bold text-[#6d5448]"
              onClick={() => setShowCreate(true)}
              type="button"
            >
              + Cadastrar material
            </button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e2d6ca]">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#f5efe8] text-xs uppercase tracking-wide text-[#8a6756]">
                <tr>
                  <th className="w-14 px-4 py-3">Usar</th>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Custo base</th>
                  <th className="px-4 py-3">Quantidade usada</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectableMaterials.map((material) => {
                  const isSelected = selectedIds.has(material.id);
                  const quantity = parseLocalizedNumber(
                    quantities[material.id] ?? '',
                  );
                  let subtotal = 0;
                  if (isSelected && quantity > 0) {
                    try {
                      subtotal = materialUsageCostCents(material, quantity);
                    } catch {
                      subtotal = 0;
                    }
                  }
                  return (
                    <tr className="border-t border-[#eee4da]" key={material.id}>
                      <td className="px-4 py-4">
                        <input
                          aria-label={`Usar ${material.description}`}
                          checked={isSelected}
                          className="h-5 w-5 accent-[#7d552f]"
                          onChange={() => toggle(material.id)}
                          type="checkbox"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <strong className="text-[#3d2a22]">{material.description}</strong>
                        {material.archived && (
                          <span className="ml-2 rounded-full bg-[#eee8e1] px-2 py-1 text-[10px] font-bold uppercase">
                            Arquivado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-[#6f5a4f]">
                        {money.format(material.purchasePriceCents / 100)} por{' '}
                        {new Intl.NumberFormat('pt-BR', {
                          maximumFractionDigits: 4,
                        }).format(material.purchasedQuantity)}{' '}
                        {material.measurementUnit}
                      </td>
                      <td className="px-4 py-4">
                        <div className={`flex max-w-48 items-center rounded-xl border border-[#d9cabc] bg-[#fcfaf7] ${isSelected ? '' : 'opacity-50'}`}>
                          <input
                            aria-label={`Quantidade de ${material.description}`}
                            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-right font-semibold outline-none"
                            disabled={!isSelected}
                            inputMode="decimal"
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [material.id]: event.target.value,
                              }))
                            }
                            value={quantities[material.id] ?? ''}
                          />
                          <span className="pr-3 text-xs font-bold text-[#8a7568]">
                            {measurementUnitLabels[material.measurementUnit]}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-[#7c552d]">
                        {isSelected ? money.format(subtotal / 100) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selectableMaterials.length === 0 && (
              <div className="p-10 text-center text-sm text-[#806b60]">
                {materials.length === 0
                  ? 'Nenhum material cadastrado. Cadastre o primeiro sem sair desta janela.'
                  : 'Nenhum material encontrado.'}
              </div>
            )}
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#eee4da] bg-[#faf7f3] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs text-[#806b60]" role="status">
              {feedback || `${selectedIds.size} ${selectedIds.size === 1 ? 'material selecionado' : 'materiais selecionados'}`}
            </p>
            <p className="mt-1 text-lg font-black text-[#4b3027]">
              Total por peça: {money.format(totalCents / 100)}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="rounded-xl border border-[#ccbbaa] bg-white px-4 py-3 text-sm font-bold text-[#6d5448]"
              onClick={onCancel}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="rounded-xl bg-[#5c3d2e] px-4 py-3 text-sm font-bold text-white"
              onClick={confirm}
              type="button"
            >
              Confirmar materiais
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
