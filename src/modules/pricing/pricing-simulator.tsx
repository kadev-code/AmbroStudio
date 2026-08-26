'use client';

import { useMemo, useState } from 'react';
import {
  calculatePrice,
  PricingCalculationError,
} from '@/src/domain/pricing/calculate-price';
import {
  loadPricingDraft,
  persistPricingDraft,
  type PricingFormState,
} from './pricing-form-state';
import {
  loadPricingProductDrafts,
  persistPricingProductDrafts,
  savePricingProductDraft,
} from './pricing-product-drafts';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const maximumMoneyValue = 9_999_999.99;
const maximumProductionMinutes = 100_000;
const maximumPercentage = 100;

const fields: Array<{
  key: keyof PricingFormState;
  label: string;
  suffix: string;
  max: number;
  step?: number;
}> = [
  { key: 'materials', label: 'Materiais por peça', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'laborHour', label: 'Mão de obra por hora', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'fixedHour', label: 'Custo fixo por hora', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'minutes', label: 'Tempo de produção', suffix: 'min', max: maximumProductionMinutes, step: 1 },
  { key: 'packaging', label: 'Embalagem por peça', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'wastePercent', label: 'Desperdício', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'marginPercent', label: 'Margem desejada', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'taxPercent', label: 'Impostos', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'channelPercent', label: 'Taxa do canal', suffix: '%', max: maximumPercentage, step: 0.1 },
];

function fieldLimitMessage(form: PricingFormState) {
  const exceededField = fields.find((field) => form[field.key] > field.max);
  if (!exceededField) return null;

  const formattedMaximum =
    exceededField.suffix === 'R$'
      ? money.format(exceededField.max)
      : `${new Intl.NumberFormat('pt-BR').format(exceededField.max)} ${exceededField.suffix}`;

  return `O campo “${exceededField.label}” aceita no máximo ${formattedMaximum}.`;
}

function calculationErrorMessage(error: unknown) {
  if (error instanceof PricingCalculationError) {
    if (error.code === 'INVALID_PERCENTAGE_TOTAL') {
      return 'A soma da margem, dos impostos e das taxas precisa ser menor que 100%.';
    }

    if (error.code === 'UNSAFE_NUMBER') {
      return 'Os valores informados geram um resultado acima do limite permitido.';
    }
  }

  return 'Revise os valores informados para calcular o preço.';
}

export function PricingSimulator() {
  const [form, setForm] = useState(loadPricingDraft);
  const [productDrafts, setProductDrafts] = useState(loadPricingProductDrafts);
  const [activeProductId, setActiveProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [productFeedback, setProductFeedback] = useState('');

  const calculation = useMemo(() => {
    const limitError = fieldLimitMessage(form);
    if (limitError) return { result: null, errorMessage: limitError };

    try {
      return {
        result: calculatePrice({
          materialsCostCents: Math.round(form.materials * 100),
          laborCostPerHourCents: Math.round(form.laborHour * 100),
          fixedCostPerHourCents: Math.round(form.fixedHour * 100),
          productionMinutes: Math.round(form.minutes),
          packagingCostCents: Math.round(form.packaging * 100),
          depreciationCostCents: 0,
          wasteBasisPoints: Math.round(form.wastePercent * 100),
          desiredMarginBasisPoints: Math.round(form.marginPercent * 100),
          taxBasisPoints: Math.round(form.taxPercent * 100),
          channelFeeBasisPoints: Math.round(form.channelPercent * 100),
          channelFixedFeeCents: 0,
        }),
        errorMessage: null,
      };
    } catch (error) {
      return { result: null, errorMessage: calculationErrorMessage(error) };
    }
  }, [form]);

  function updateField(key: keyof PricingFormState, value: string) {
    const number = Number(value);
    setForm((current) => {
      const next = {
        ...current,
        [key]: Number.isFinite(number) && number >= 0 ? number : 0,
      };
      persistPricingDraft(next);
      return next;
    });
    setProductFeedback('');
  }

  function selectProductDraft(id: string) {
    setActiveProductId(id);
    setProductFeedback('');

    const selected = productDrafts.find((draft) => draft.id === id);
    if (!selected) {
      setProductName('');
      return;
    }

    setProductName(selected.name);
    setForm({ ...selected.form });
    persistPricingDraft(selected.form);
  }

  function startNewProduct() {
    setActiveProductId('');
    setProductName('');
    setProductFeedback('Informe o nome e salve os valores atuais como um novo produto.');
  }

  function saveProduct() {
    const normalizedName = productName.trim();
    if (!normalizedName) {
      setProductFeedback('Informe o nome do produto antes de salvar.');
      return;
    }

    if (!calculation.result) {
      setProductFeedback('Corrija os valores da simulação antes de salvar o produto.');
      return;
    }

    const nextDrafts = savePricingProductDraft(productDrafts, {
      id: activeProductId || undefined,
      name: normalizedName,
      form,
    });

    setProductDrafts(nextDrafts);
    setActiveProductId(nextDrafts[0].id);
    setProductName(nextDrafts[0].name);
    persistPricingProductDrafts(nextDrafts);
    setProductFeedback(
      activeProductId
        ? 'Produto atualizado neste dispositivo.'
        : 'Produto salvo neste dispositivo.',
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-3xl border border-[#ded2c5] bg-white p-5 shadow-[0_8px_24px_rgb(76_53_42/5%)] sm:p-6">
        <div className="flex flex-col gap-3 border-b border-[#eee4da] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9a6f57]">Simulação rápida</p>
            <h2 className="mt-1 text-xl font-bold">Calcule um preço seguro</h2>
          </div>
          <span className="rounded-full bg-[#f4eee7] px-3 py-1.5 text-xs font-bold text-[#765f52]">Margem sobre a venda</span>
        </div>

        <section aria-label="Produto da simulação" className="mt-5 rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto] lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Simulações salvas</span>
              <select
                className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                onChange={(event) => selectProductDraft(event.target.value)}
                value={activeProductId}
              >
                <option value="">Novo produto</option>
                {productDrafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>{draft.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">Nome do produto</span>
              <input
                className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                maxLength={80}
                onChange={(event) => {
                  setProductName(event.target.value);
                  setProductFeedback('');
                }}
                placeholder="Ex.: Kit festa personalizado"
                type="text"
                value={productName}
              />
            </label>

            <div className="flex gap-2">
              <button className="rounded-xl border border-[#ccbbaa] bg-white px-3 py-3 text-sm font-bold text-[#6d5448] hover:bg-[#fffdfa]" onClick={startNewProduct} type="button">Novo</button>
              <button className="rounded-xl bg-[#5c3d2e] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#4c3125]" onClick={saveProduct} type="button">
                {activeProductId ? 'Atualizar' : 'Salvar produto'}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1 text-xs text-[#806b60] sm:flex-row sm:items-center sm:justify-between">
            <p role="status">{productFeedback || 'Cada produto mantém seus próprios custos e margem.'}</p>
            <p>{productDrafts.length} {productDrafts.length === 1 ? 'produto salvo' : 'produtos salvos'} neste dispositivo</p>
          </div>
        </section>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1.5 block text-xs font-bold text-[#665147]">{field.label}</span>
              <div className="flex items-center rounded-xl border border-[#d9cabc] bg-[#fcfaf7] focus-within:border-[#b8860b] focus-within:ring-3 focus-within:ring-[#c69a45]/15">
                <span className="pl-3 text-xs font-bold text-[#9a7f70]">{field.suffix}</span>
                <input
                  aria-label={field.label}
                  className="min-w-0 flex-1 appearance-none bg-transparent px-2 py-3 text-right text-sm font-semibold outline-none"
                  max={field.max}
                  min="0"
                  onChange={(event) => updateField(field.key, event.target.value)}
                  step={field.step}
                  type="number"
                  value={form[field.key]}
                />
              </div>
            </label>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">Regra aplicada</p>
          <p className="mt-2 text-sm leading-6 text-[#6f5a4f]">Custo total dividido por 1 menos margem, impostos e taxas percentuais. Dinheiro é calculado em centavos para evitar erro de arredondamento.</p>
        </div>
      </section>

      <aside className="min-w-0 overflow-hidden rounded-3xl bg-[#4b3027] p-6 text-white shadow-[0_18px_48px_rgb(70_43_33/18%)]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d7b56f]">Preço sugerido</p>
        {calculation.result ? (
          <>
            <p className="mt-3 max-w-full break-all text-[clamp(1.75rem,3vw,2.25rem)] font-black leading-tight tracking-tight">{money.format(calculation.result.suggestedPriceCents / 100)}</p>
            <p className="mt-2 text-sm text-[#e0d0c6]">por peça, com a margem e taxas informadas</p>

            <dl className="mt-7 space-y-3 border-t border-white/15 pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="min-w-0 text-[#d8c6ba]">Custo de produção</dt>
                <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.productionCostCents / 100)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="min-w-0 text-[#d8c6ba]">Impostos estimados</dt>
                <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.estimatedTaxCents / 100)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="min-w-0 text-[#d8c6ba]">Taxa do canal</dt>
                <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.estimatedChannelFeeCents / 100)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-white/15 pt-3">
                <dt className="min-w-0 text-[#d8c6ba]">Lucro estimado</dt>
                <dd className="min-w-0 max-w-[58%] break-all text-right font-bold text-[#e2c479]">{money.format(calculation.result.estimatedProfitCents / 100)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-300/10 p-4 text-sm leading-6 text-rose-100">{calculation.errorMessage}</div>
        )}
      </aside>
    </div>
  );
}
