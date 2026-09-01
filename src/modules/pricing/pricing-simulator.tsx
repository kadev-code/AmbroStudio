'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculatePrice,
  PricingCalculationError,
} from '@/src/domain/pricing/calculate-price';
import {
  createPricingMaterial,
  materialUsageCostCents,
  materialUsagesCostCents,
  measurementUnitLabels,
  type MaterialInput,
  type MaterialUsage,
  type PricingMaterial,
} from '@/src/domain/pricing/material';
import { safeLogger } from '@/src/infrastructure/logging/safe-logger';
import { loadPricingMaterials } from '@/src/infrastructure/pricing/local-material-catalog-repository';
import { MaterialCatalogPanel } from './material-catalog-panel';
import { MaterialSelectorDialog } from './material-selector-dialog';
import { money, parseLocalizedNumber } from './pricing-format';
import {
  loadPricingDraft,
  persistPricingDraft,
  pricingFieldInputsFromForm,
  updatePricingFormFromInput,
  type PricingEditableField,
  type PricingFieldInputs,
  type PricingFormState,
} from './pricing-form-state';
import {
  loadPricingProductDrafts,
  persistPricingCatalogAndProductDrafts,
  persistPricingProductDrafts,
  refreshPricingProductMaterialCosts,
  savePricingProductDraft,
} from './pricing-product-drafts';

const maximumMoneyValue = 9_999_999.99;
const maximumProductionMinutes = 100_000;
const maximumPercentage = 100;

const fields: Array<{
  key: PricingEditableField;
  label: string;
  suffix: string;
  max: number;
  step?: number;
}> = [
  { key: 'laborHour', label: 'Mão de obra por hora', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'fixedHour', label: 'Custo fixo por hora', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'minutes', label: 'Tempo de produção', suffix: 'min', max: maximumProductionMinutes, step: 1 },
  { key: 'packaging', label: 'Embalagem por peça', suffix: 'R$', max: maximumMoneyValue, step: 0.01 },
  { key: 'wastePercent', label: 'Desperdício', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'marginPercent', label: 'Margem desejada', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'taxPercent', label: 'Impostos', suffix: '%', max: maximumPercentage, step: 0.1 },
  { key: 'channelPercent', label: 'Taxa do canal', suffix: '%', max: maximumPercentage, step: 0.1 },
];

function fieldLimitMessage(
  form: PricingFormState,
  fieldInputs: PricingFieldInputs,
) {
  if (form.materials > maximumMoneyValue) {
    return `O custo dos materiais aceita no máximo ${money.format(maximumMoneyValue)}.`;
  }

  const invalidField = fields.find((field) => {
    const rawValue = fieldInputs[field.key];
    if (!rawValue.trim()) return false;
    const parsedValue = parseLocalizedNumber(rawValue);
    return !Number.isFinite(parsedValue) || parsedValue < 0;
  });
  if (invalidField) {
    return `Informe um número válido e maior ou igual a zero em “${invalidField.label}”.`;
  }

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

function pricingSnapshot(
  name: string,
  form: PricingFormState,
  usages: MaterialUsage[],
  legacyMaterialsCostCents: number | null,
) {
  return JSON.stringify({
    name,
    form,
    usages: [...usages].sort((first, second) =>
      first.materialId.localeCompare(second.materialId),
    ),
    legacyMaterialsCostCents,
  });
}

export function PricingSimulator() {
  const [initialState] = useState(() => {
    const form = loadPricingDraft();
    const legacyMaterialsCostCents =
      Math.round(form.materials * 100) || null;
    return {
      form,
      fieldInputs: pricingFieldInputsFromForm(form),
      legacyMaterialsCostCents,
      baseline: pricingSnapshot('', form, [], legacyMaterialsCostCents),
    };
  });
  const [activeTab, setActiveTab] = useState<'simulation' | 'materials'>(
    'simulation',
  );
  const [form, setForm] = useState(initialState.form);
  const [fieldInputs, setFieldInputs] = useState(initialState.fieldInputs);
  const [materials, setMaterials] = useState(loadPricingMaterials);
  const [materialUsages, setMaterialUsages] = useState<MaterialUsage[]>([]);
  const [legacyMaterialsCostCents, setLegacyMaterialsCostCents] = useState<
    number | null
  >(initialState.legacyMaterialsCostCents);
  const [productDrafts, setProductDrafts] = useState(loadPricingProductDrafts);
  const [activeProductId, setActiveProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [baseline, setBaseline] = useState(initialState.baseline);
  const [productFeedback, setProductFeedback] = useState('');
  const [productSaving, setProductSaving] = useState(false);
  const productSavingRef = useRef(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const materialsCostCents = useMemo(() => {
    if (legacyMaterialsCostCents !== null) return legacyMaterialsCostCents;
    try {
      return materialUsagesCostCents(materialUsages, materials);
    } catch {
      return 0;
    }
  }, [legacyMaterialsCostCents, materialUsages, materials]);

  const effectiveForm = useMemo(
    () => ({ ...form, materials: materialsCostCents / 100 }),
    [form, materialsCostCents],
  );
  const deferredEffectiveForm = useDeferredValue(effectiveForm);

  useEffect(() => {
    const persistenceTimer = window.setTimeout(
      () => persistPricingDraft(effectiveForm),
      250,
    );
    return () => window.clearTimeout(persistenceTimer);
  }, [effectiveForm]);

  const hasUnsavedChanges =
    pricingSnapshot(
      productName,
      effectiveForm,
      materialUsages,
      legacyMaterialsCostCents,
    ) !== baseline;

  const calculation = useMemo(() => {
    const limitError = fieldLimitMessage(deferredEffectiveForm, fieldInputs);
    if (limitError) return { result: null, errorMessage: limitError };

    try {
      return {
        result: calculatePrice({
          materialsCostCents,
          laborCostPerHourCents: Math.round(deferredEffectiveForm.laborHour * 100),
          fixedCostPerHourCents: Math.round(deferredEffectiveForm.fixedHour * 100),
          productionMinutes: Math.round(deferredEffectiveForm.minutes),
          packagingCostCents: Math.round(deferredEffectiveForm.packaging * 100),
          depreciationCostCents: 0,
          wasteBasisPoints: Math.round(deferredEffectiveForm.wastePercent * 100),
          desiredMarginBasisPoints: Math.round(deferredEffectiveForm.marginPercent * 100),
          taxBasisPoints: Math.round(deferredEffectiveForm.taxPercent * 100),
          channelFeeBasisPoints: Math.round(deferredEffectiveForm.channelPercent * 100),
          channelFixedFeeCents: 0,
        }),
        errorMessage: null,
      };
    } catch (error) {
      return { result: null, errorMessage: calculationErrorMessage(error) };
    }
  }, [deferredEffectiveForm, fieldInputs, materialsCostCents]);

  function confirmDiscardChanges() {
    return (
      !hasUnsavedChanges ||
      window.confirm(
        'Existem alterações não salvas neste produto. Deseja descartá-las?',
      )
    );
  }

  function updateField(key: PricingEditableField, value: string) {
    setFieldInputs((current) => ({ ...current, [key]: value }));
    setForm((current) => {
      return updatePricingFormFromInput(
        { ...current, materials: materialsCostCents / 100 },
        key,
        value,
      );
    });
    setProductFeedback('');
  }

  function selectProductDraft(id: string) {
    if (id === activeProductId) return;
    if (!confirmDiscardChanges()) return;

    setProductFeedback('');
    const selected = productDrafts.find((draft) => draft.id === id);
    if (!selected) {
      const nextForm = { ...effectiveForm, materials: 0 };
      setActiveProductId('');
      setProductName('');
      setForm(nextForm);
      setFieldInputs(pricingFieldInputsFromForm(nextForm));
      setMaterialUsages([]);
      setLegacyMaterialsCostCents(null);
      persistPricingDraft(nextForm);
      setBaseline(pricingSnapshot('', nextForm, [], null));
      return;
    }

    setActiveProductId(selected.id);
    setProductName(selected.name);
    setForm({ ...selected.form });
    setFieldInputs(pricingFieldInputsFromForm(selected.form));
    setMaterialUsages([...selected.materialUsages]);
    setLegacyMaterialsCostCents(selected.legacyMaterialsCostCents);
    persistPricingDraft(selected.form);
    setBaseline(
      pricingSnapshot(
        selected.name,
        selected.form,
        selected.materialUsages,
        selected.legacyMaterialsCostCents,
      ),
    );
  }

  function startNewProduct() {
    if (!confirmDiscardChanges()) return;
    const nextForm = { ...effectiveForm, materials: 0 };
    setActiveProductId('');
    setProductName('');
    setForm(nextForm);
    setFieldInputs(pricingFieldInputsFromForm(nextForm));
    setMaterialUsages([]);
    setLegacyMaterialsCostCents(null);
    persistPricingDraft(nextForm);
    setBaseline(pricingSnapshot('', nextForm, [], null));
    setProductFeedback(
      'Informe o nome, selecione os materiais e salve como um novo produto.',
    );
  }

  async function saveProduct() {
    if (productSavingRef.current) return;
    const normalizedName = productName.trim();
    if (!normalizedName) {
      setProductFeedback('Informe o nome do produto antes de salvar.');
      return;
    }

    if (!calculation.result) {
      setProductFeedback('Corrija os valores da simulação antes de salvar o produto.');
      return;
    }

    productSavingRef.current = true;
    setProductSaving(true);
    try {
      const savedForm = { ...effectiveForm };
      const nextDrafts = savePricingProductDraft(productDrafts, {
        id: activeProductId || undefined,
        name: normalizedName,
        form: savedForm,
        materialUsages,
        legacyMaterialsCostCents,
      });
      const saved = nextDrafts[0];

      if (!(await persistPricingProductDrafts(nextDrafts))) {
        const incident = safeLogger.record({
          severity: 'error',
          eventCode: 'PRICING_PRODUCT_SAVE_FAILED',
          module: 'pricing',
          operation: 'save-pricing-product',
          result: 'failure',
          errorCode: 'LOCAL_STORAGE_WRITE_FAILED',
        });
        setProductFeedback(
          `Não foi possível salvar o produto. Diagnóstico: ${incident.incidentCode}.`,
        );
        return;
      }

      setProductDrafts(nextDrafts);
      setActiveProductId(saved.id);
      setProductName(saved.name);
      setForm(saved.form);
      setFieldInputs(pricingFieldInputsFromForm(saved.form));
      persistPricingDraft(saved.form);
      setBaseline(
        pricingSnapshot(
          saved.name,
          saved.form,
          saved.materialUsages,
          saved.legacyMaterialsCostCents,
        ),
      );
      setProductFeedback(
        activeProductId
          ? 'Produto e materiais atualizados neste dispositivo.'
          : 'Produto e materiais salvos neste dispositivo.',
      );
    } finally {
      productSavingRef.current = false;
      setProductSaving(false);
    }
  }

  async function changeMaterialsCatalog(nextMaterials: PricingMaterial[]) {
    try {
      const wasDirty = hasUnsavedChanges;
      const refreshedDrafts = refreshPricingProductMaterialCosts(
        productDrafts,
        nextMaterials,
      );
      if (
        !(await persistPricingCatalogAndProductDrafts(
          nextMaterials,
          refreshedDrafts,
        ))
      ) {
        throw new Error('PRICING_CATALOG_WRITE_FAILED');
      }
      setMaterials(nextMaterials);
      setProductDrafts(refreshedDrafts);

      if (legacyMaterialsCostCents === null) {
        const nextCost = materialUsagesCostCents(
          materialUsages,
          nextMaterials,
        );
        setForm((current) => {
          const next = { ...current, materials: nextCost / 100 };
          persistPricingDraft(next);
          return next;
        });
        if (!wasDirty) {
          setBaseline(
            pricingSnapshot(
              productName,
              { ...form, materials: nextCost / 100 },
              materialUsages,
              null,
            ),
          );
        }
      }
    } catch (error) {
      safeLogger.record(
        {
          severity: 'error',
          eventCode: 'PRICING_MATERIAL_CATALOG_SAVE_FAILED',
          module: 'pricing',
          operation: 'save-material-catalog',
          result: 'failure',
          errorCode: 'LOCAL_STORAGE_WRITE_FAILED',
        },
        error,
      );
      throw error;
    }
  }

  async function createMaterialFromSelector(input: MaterialInput) {
    const next = createPricingMaterial(materials, input);
    await changeMaterialsCatalog(next);
    return next[0];
  }

  function confirmMaterialSelection(usages: MaterialUsage[]) {
    try {
      const nextCost = materialUsagesCostCents(usages, materials);
      const nextForm = { ...form, materials: nextCost / 100 };
      setMaterialUsages(usages);
      setLegacyMaterialsCostCents(null);
      setForm(nextForm);
      persistPricingDraft(nextForm);
      setSelectorOpen(false);
      setProductFeedback(
        usages.length === 0
          ? 'Receita de materiais removida.'
          : 'Materiais aplicados. Salve o produto para manter esta receita.',
      );
    } catch (error) {
      safeLogger.record(
        {
          severity: 'warning',
          eventCode: 'PRICING_MATERIAL_RECIPE_INVALID',
          module: 'pricing',
          operation: 'apply-material-recipe',
          result: 'failure',
          errorCode: 'INVALID_MATERIAL_RECIPE',
        },
        error,
      );
      setProductFeedback('Não foi possível aplicar os materiais selecionados.');
    }
  }

  return (
    <div>
      <nav
        aria-label="Seções da precificação"
        className="mb-5 inline-flex rounded-2xl border border-[#ded2c5] bg-white p-1 shadow-sm"
      >
        <button
          className={`rounded-xl px-4 py-2.5 text-sm font-bold ${activeTab === 'simulation' ? 'bg-[#5c3d2e] text-white' : 'text-[#6d5448]'}`}
          onClick={() => setActiveTab('simulation')}
          type="button"
        >
          Simulação rápida
        </button>
        <button
          className={`rounded-xl px-4 py-2.5 text-sm font-bold ${activeTab === 'materials' ? 'bg-[#5c3d2e] text-white' : 'text-[#6d5448]'}`}
          onClick={() => setActiveTab('materials')}
          type="button"
        >
          Materiais de uso
        </button>
      </nav>

      {activeTab === 'materials' ? (
        <MaterialCatalogPanel
          materials={materials}
          onChange={changeMaterialsCatalog}
        />
      ) : (
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
                  <button className="rounded-xl bg-[#5c3d2e] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#4c3125] disabled:cursor-wait disabled:opacity-60" disabled={productSaving} onClick={() => void saveProduct()} type="button">
                    {productSaving
                      ? 'Salvando...'
                      : activeProductId
                        ? 'Atualizar'
                        : 'Salvar produto'}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1 text-xs text-[#806b60] sm:flex-row sm:items-center sm:justify-between">
                <p role="status">{productFeedback || (hasUnsavedChanges ? 'Existem alterações não salvas neste produto.' : 'Cada produto mantém seus próprios custos, materiais e margem.')}</p>
                <p>{productDrafts.length} {productDrafts.length === 1 ? 'produto salvo' : 'produtos salvos'} neste dispositivo</p>
              </div>
            </section>

            <section className="mt-5 rounded-2xl border border-[#e2d6ca] bg-[#fcfaf7] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold text-[#665147]">Materiais por peça</p>
                  <p className="mt-1 text-sm text-[#806b60]">
                    {legacyMaterialsCostCents !== null
                      ? 'Custo manual de uma versão anterior. Converta para vincular materiais.'
                      : materialUsages.length === 0
                        ? 'Nenhum material selecionado.'
                        : `${materialUsages.length} ${materialUsages.length === 1 ? 'material vinculado' : 'materiais vinculados'} à receita.`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <strong className="text-lg text-[#5c3d2e]">
                    {money.format(materialsCostCents / 100)}
                  </strong>
                  <button
                    className="rounded-xl border border-[#c7ab8f] bg-white px-4 py-2.5 text-sm font-bold text-[#6d4a39]"
                    onClick={() => setSelectorOpen(true)}
                    type="button"
                  >
                    {legacyMaterialsCostCents !== null ? 'Converter' : 'Selecionar materiais'}
                  </button>
                </div>
              </div>

              {legacyMaterialsCostCents === null && materialUsages.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {materialUsages.map((usage) => {
                    const material = materials.find(
                      (item) => item.id === usage.materialId,
                    );
                    if (!material) return null;
                    return (
                      <div className="rounded-xl border border-[#e2d6ca] bg-white px-3 py-2.5" key={usage.materialId}>
                        <p className="truncate text-xs font-bold text-[#4b3027]">{material.description}</p>
                        <p className="mt-1 text-xs text-[#806b60]">
                          {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(usage.usedQuantity)} {measurementUnitLabels[material.measurementUnit]} · {money.format(materialUsageCostCents(material, usage.usedQuantity) / 100)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
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
                      inputMode="decimal"
                      onChange={(event) => updateField(field.key, event.target.value)}
                      type="text"
                      value={fieldInputs[field.key]}
                    />
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">Regra aplicada</p>
              <p className="mt-2 text-sm leading-6 text-[#6f5a4f]">Custo total dividido por 1 menos margem, impostos e taxas percentuais. Os materiais são calculados pela quantidade usada em cada peça.</p>
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
      )}

      {selectorOpen && (
        <MaterialSelectorDialog
          initialUsages={materialUsages}
          materials={materials}
          onCancel={() => setSelectorOpen(false)}
          onConfirm={confirmMaterialSelection}
          onCreateMaterial={createMaterialFromSelector}
        />
      )}
    </div>
  );
}
