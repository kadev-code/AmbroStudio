'use client';

import { useMemo, useState } from 'react';
import {
  materialInputSchema,
  measurementUnitLabels,
  measurementUnits,
  type MaterialInput,
  type MeasurementUnit,
  type PricingMaterial,
} from '@/src/domain/pricing/material';
import {
  decimalInputValue,
  formatUnitCost,
  parseLocalizedNumber,
} from './pricing-format';

type MaterialFormProps = {
  initialMaterial?: PricingMaterial;
  onCancel(): void;
  onSave(input: MaterialInput): void;
};

export function MaterialForm({
  initialMaterial,
  onCancel,
  onSave,
}: MaterialFormProps) {
  const [description, setDescription] = useState(
    initialMaterial?.description ?? '',
  );
  const [purchasePrice, setPurchasePrice] = useState(
    initialMaterial
      ? decimalInputValue(initialMaterial.purchasePriceCents / 100)
      : '',
  );
  const [purchasedQuantity, setPurchasedQuantity] = useState(
    initialMaterial
      ? decimalInputValue(initialMaterial.purchasedQuantity)
      : '',
  );
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>(
    initialMaterial?.measurementUnit ?? 'un',
  );
  const [purchaseUrl, setPurchaseUrl] = useState(
    initialMaterial?.purchaseUrl ?? '',
  );
  const [notes, setNotes] = useState(initialMaterial?.notes ?? '');
  const [feedback, setFeedback] = useState('');

  const unitCost = useMemo(() => {
    const price = parseLocalizedNumber(purchasePrice);
    const quantity = parseLocalizedNumber(purchasedQuantity);
    if (!(price > 0) || !(quantity > 0)) return null;
    return (price * 100) / quantity;
  }, [purchasePrice, purchasedQuantity]);

  function submit() {
    const parsed = materialInputSchema.safeParse({
      description,
      purchasePriceCents: Math.round(
        parseLocalizedNumber(purchasePrice) * 100,
      ),
      purchasedQuantity: parseLocalizedNumber(purchasedQuantity),
      measurementUnit,
      purchaseUrl: purchaseUrl.trim(),
      notes,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFeedback(
        issue?.message === 'HTTPS_REQUIRED'
          ? 'O link de compra precisa começar com https://.'
          : 'Revise descrição, preço e quantidade. Preço e quantidade precisam ser maiores que zero.',
      );
      return;
    }

    try {
      onSave(parsed.data);
    } catch {
      setFeedback('Não foi possível salvar o material. Tente novamente.');
    }
  }

  const inputClass =
    'w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15';

  return (
    <section className="rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">
            {initialMaterial ? 'Editar material' : 'Novo material'}
          </p>
          <h3 className="mt-1 text-lg font-bold">
            {initialMaterial?.description || 'Dados da compra'}
          </h3>
        </div>
        <button
          className="text-sm font-bold text-[#765f52]"
          onClick={onCancel}
          type="button"
        >
          Fechar
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Descrição *
          </span>
          <input
            className={inputClass}
            maxLength={120}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: Papel fotográfico"
            type="text"
            value={description}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Preço total pago *
          </span>
          <div className="flex items-center rounded-xl border border-[#d9cabc] bg-white focus-within:border-[#b8860b] focus-within:ring-3 focus-within:ring-[#c69a45]/15">
            <span className="pl-3 text-xs font-bold text-[#9a7f70]">R$</span>
            <input
              className="min-w-0 flex-1 bg-transparent px-2 py-3 text-right text-sm outline-none"
              inputMode="decimal"
              onChange={(event) => setPurchasePrice(event.target.value)}
              placeholder="0,00"
              value={purchasePrice}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Quantidade comprada *
          </span>
          <input
            className={inputClass + ' text-right'}
            inputMode="decimal"
            onChange={(event) => setPurchasedQuantity(event.target.value)}
            placeholder="0"
            value={purchasedQuantity}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Unidade de medida *
          </span>
          <select
            className={inputClass}
            onChange={(event) =>
              setMeasurementUnit(event.target.value as MeasurementUnit)
            }
            value={measurementUnit}
          >
            {measurementUnits.map((unit) => (
              <option key={unit} value={unit}>
                {measurementUnitLabels[unit]}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-xl border border-[#e0d2c3] bg-white px-3 py-3">
          <span className="block text-xs font-bold text-[#665147]">
            Custo por unidade
          </span>
          <strong className="mt-1 block text-sm text-[#5c3d2e]">
            {unitCost === null
              ? 'Informe preço e quantidade'
              : formatUnitCost(unitCost, measurementUnit)}
          </strong>
        </div>
        <label className="block lg:col-span-2">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Link de compra
          </span>
          <input
            className={inputClass}
            maxLength={1_000}
            onChange={(event) => setPurchaseUrl(event.target.value)}
            placeholder="https://..."
            type="url"
            value={purchaseUrl}
          />
        </label>
        <label className="block lg:col-span-4">
          <span className="mb-1.5 block text-xs font-bold text-[#665147]">
            Observação
          </span>
          <textarea
            className={inputClass + ' min-h-24 resize-y'}
            maxLength={2_000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Informações adicionais sobre este material..."
            value={notes}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[#806b60]" role="status">
          {feedback}
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl border border-[#ccbbaa] bg-white px-4 py-2.5 text-sm font-bold text-[#6d5448]"
            onClick={onCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="rounded-xl bg-[#5c3d2e] px-4 py-2.5 text-sm font-bold text-white"
            onClick={submit}
            type="button"
          >
            {initialMaterial ? 'Salvar alterações' : 'Salvar material'}
          </button>
        </div>
      </div>
    </section>
  );
}
