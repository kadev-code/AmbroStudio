'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { PricingCalculationError } from '@/src/domain/pricing/calculate-price';
import {
  createPricingMaterial,
  materialUsageCostCents,
  measurementUnitLabels,
  type MaterialInput,
  type MaterialUsage,
  type PricingMaterial,
} from '@/src/domain/pricing/material';
import {
  calculateQuantityMaterials,
  calculateQuantityPrice,
  QuantityPricingError,
  type QuantityPricingBreakdown,
  type QuantityPricingInput,
  type PricingSheetUsage,
} from '@/src/domain/pricing/quantity-pricing';
import { safeLogger } from '@/src/infrastructure/logging/safe-logger';
import { loadPricingMaterials } from '@/src/infrastructure/pricing/local-material-catalog-repository';
import { MaterialCatalogPanel } from './material-catalog-panel';
import { MaterialSelectorDialog } from './material-selector-dialog';
import { decimalInputValue, money, parseLocalizedNumber } from './pricing-format';
import {
  loadPricingDraft,
  persistPricingDraft,
  pricingFieldInputsFromForm,
  updatePricingFormFromInput,
  commercialUnitLabels,
  commercialUnits,
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
}> = [
  { key: 'laborHour', label: 'Mão de obra por hora', suffix: 'R$', max: maximumMoneyValue },
  { key: 'fixedHour', label: 'Custo fixo por hora', suffix: 'R$', max: maximumMoneyValue },
  { key: 'minutes', label: 'Tempo por unidade', suffix: 'min', max: maximumProductionMinutes },
  { key: 'wastePercent', label: 'Desperdício', suffix: '%', max: maximumPercentage },
  { key: 'marginPercent', label: 'Margem desejada', suffix: '%', max: maximumPercentage },
  { key: 'taxPercent', label: 'Impostos', suffix: '%', max: maximumPercentage },
  { key: 'channelPercent', label: 'Taxa do canal', suffix: '%', max: maximumPercentage },
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

  if (error instanceof QuantityPricingError) {
    if (error.code === 'INVALID_QUANTITY') {
      return 'Informe uma quantidade inteira entre 1 e 100.000.';
    }
    if (error.code === 'A4_ITEM_DOES_NOT_FIT') {
      return 'As dimensões informadas não cabem em uma folha A4 sem rotação.';
    }
    if (error.code === 'A4_MATERIAL_UNIT_INVALID') {
      return 'O material do aproveitamento A4 precisa estar cadastrado em folhas.';
    }
    if (error.code === 'A4_MATERIAL_NOT_FOUND') {
      return 'Selecione novamente o material usado no aproveitamento A4.';
    }
  }

  return 'Revise os valores informados para calcular o preço.';
}

function pricingSnapshot(
  name: string,
  form: PricingFormState,
  usages: MaterialUsage[],
  sheetUsage: { materialId: string; width: string; height: string } | null,
  legacyMaterialsCostCents: number | null,
) {
  return JSON.stringify({
    name,
    form,
    usages: [...usages].sort((first, second) =>
      first.materialId.localeCompare(second.materialId),
    ),
    sheetUsage,
    legacyMaterialsCostCents,
  });
}

function quantityPricingInput(
  quantity: number,
  form: PricingFormState,
  materialUsages: MaterialUsage[],
  materials: PricingMaterial[],
  sheetUsage: PricingSheetUsage | null,
  legacyMaterialsCostCents: number | null,
): QuantityPricingInput {
  return {
    quantity,
    materialUsages,
    materials,
    sheetUsage,
    legacyMaterialsCostCentsPerUnit: legacyMaterialsCostCents,
    laborCostPerHourCents: Math.round(form.laborHour * 100),
    fixedCostPerHourCents: Math.round(form.fixedHour * 100),
    productionMinutesPerUnit: Math.round(form.minutes),
    legacyPackagingCostCentsPerUnit: Math.round(form.packaging * 100),
    wasteBasisPoints: Math.round(form.wastePercent * 100),
    desiredMarginBasisPoints: Math.round(form.marginPercent * 100),
    taxBasisPoints: Math.round(form.taxPercent * 100),
    channelFeeBasisPoints: Math.round(form.channelPercent * 100),
    channelFixedFeeCents: 0,
  };
}

function tryCalculateQuantityPrice(input: QuantityPricingInput) {
  try {
    return calculateQuantityPrice(input);
  } catch {
    return null;
  }
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
      baseline: pricingSnapshot('', form, [], null, legacyMaterialsCostCents),
    };
  });
  const [activeTab, setActiveTab] = useState<'simulation' | 'materials'>(
    'simulation',
  );
  const [form, setForm] = useState(initialState.form);
  const [fieldInputs, setFieldInputs] = useState(initialState.fieldInputs);
  const [materials, setMaterials] = useState(loadPricingMaterials);
  const [materialUsages, setMaterialUsages] = useState<MaterialUsage[]>([]);
  const [sheetMaterialId, setSheetMaterialId] = useState('');
  const [sheetWidthInput, setSheetWidthInput] = useState('');
  const [sheetHeightInput, setSheetHeightInput] = useState('');
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

  const sheetUsage = useMemo<PricingSheetUsage | null>(() => {
    if (!sheetMaterialId) return null;
    return {
      materialId: sheetMaterialId,
      itemWidthCm: parseLocalizedNumber(sheetWidthInput),
      itemHeightCm: parseLocalizedNumber(sheetHeightInput),
    };
  }, [sheetHeightInput, sheetMaterialId, sheetWidthInput]);
  const deferredForm = useDeferredValue(form);
  const referenceQuantity = parseLocalizedNumber(fieldInputs.referenceQuantity);
  const minimumResaleQuantity = parseLocalizedNumber(
    fieldInputs.minimumResaleQuantity,
  );

  const calculation = useMemo(() => {
    const limitError = fieldLimitMessage(deferredForm, fieldInputs);
    if (limitError) return { result: null, errorMessage: limitError };

    try {
      return {
        result: calculateQuantityPrice(
          quantityPricingInput(
            referenceQuantity,
            deferredForm,
            materialUsages,
            materials,
            sheetUsage,
            legacyMaterialsCostCents,
          ),
        ),
        errorMessage: null,
      };
    } catch (error) {
      return { result: null, errorMessage: calculationErrorMessage(error) };
    }
  }, [deferredForm, fieldInputs, legacyMaterialsCostCents, materialUsages, materials, referenceQuantity, sheetUsage]);

  const resaleCalculation = useMemo(
    () =>
      tryCalculateQuantityPrice(
        quantityPricingInput(
          minimumResaleQuantity,
          deferredForm,
          materialUsages,
          materials,
          sheetUsage,
          legacyMaterialsCostCents,
        ),
      ),
    [
      deferredForm,
      legacyMaterialsCostCents,
      materialUsages,
      materials,
      minimumResaleQuantity,
      sheetUsage,
    ],
  );

  const simulationRows = useMemo(() => {
    const quantities = [...new Set([1, 10, 20, 50, 100, referenceQuantity])]
      .filter(
        (quantity) =>
          Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100_000,
      )
      .sort((first, second) => first - second);

    return quantities
      .map((quantity) =>
        tryCalculateQuantityPrice(
          quantityPricingInput(
            quantity,
            deferredForm,
            materialUsages,
            materials,
            sheetUsage,
            legacyMaterialsCostCents,
          ),
        ),
      )
      .filter((row): row is QuantityPricingBreakdown => row !== null);
  }, [
    deferredForm,
    legacyMaterialsCostCents,
    materialUsages,
    materials,
    referenceQuantity,
    sheetUsage,
  ]);

  const materialsCostCents = calculation.result
    ? Math.round(
        calculation.result.materialsCostCents / calculation.result.quantity,
      )
    : legacyMaterialsCostCents ?? Math.round(form.materials * 100);
  const effectiveForm = useMemo(
    () => ({ ...form, materials: materialsCostCents / 100 }),
    [form, materialsCostCents],
  );

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
      sheetMaterialId
        ? { materialId: sheetMaterialId, width: sheetWidthInput, height: sheetHeightInput }
        : null,
      legacyMaterialsCostCents,
    ) !== baseline;

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

  function materialCostPerUnitFor(
    usages: MaterialUsage[],
    catalog: PricingMaterial[],
    selectedSheet: PricingSheetUsage | null,
    quantity = form.referenceQuantity,
  ) {
    try {
      return Math.round(
        calculateQuantityMaterials({
          quantity,
          materialUsages: usages,
          materials: catalog,
          sheetUsage: selectedSheet,
          legacyMaterialsCostCentsPerUnit: null,
        }).materialsCostCents / quantity,
      );
    } catch {
      return 0;
    }
  }

  function selectProductDraft(id: string) {
    if (id === activeProductId) return;
    if (!confirmDiscardChanges()) return;

    setProductFeedback('');
    const selected = productDrafts.find((draft) => draft.id === id);
    if (!selected) {
      const nextForm = {
        ...effectiveForm,
        materials: 0,
        packaging: 0,
        referenceQuantity: 1,
        minimumResaleQuantity: 10,
        commercialUnit: 'unidade' as const,
      };
      setActiveProductId('');
      setProductName('');
      setForm(nextForm);
      setFieldInputs(pricingFieldInputsFromForm(nextForm));
      setMaterialUsages([]);
      setSheetMaterialId('');
      setSheetWidthInput('');
      setSheetHeightInput('');
      setLegacyMaterialsCostCents(null);
      persistPricingDraft(nextForm);
      setBaseline(pricingSnapshot('', nextForm, [], null, null));
      return;
    }

    setActiveProductId(selected.id);
    setProductName(selected.name);
    setForm({ ...selected.form });
    setFieldInputs(pricingFieldInputsFromForm(selected.form));
    setMaterialUsages([...selected.materialUsages]);
    setSheetMaterialId(selected.sheetUsage?.materialId ?? '');
    setSheetWidthInput(
      selected.sheetUsage ? decimalInputValue(selected.sheetUsage.itemWidthCm) : '',
    );
    setSheetHeightInput(
      selected.sheetUsage ? decimalInputValue(selected.sheetUsage.itemHeightCm) : '',
    );
    setLegacyMaterialsCostCents(selected.legacyMaterialsCostCents);
    persistPricingDraft(selected.form);
    setBaseline(
      pricingSnapshot(
        selected.name,
        selected.form,
        selected.materialUsages,
        selected.sheetUsage
          ? {
              materialId: selected.sheetUsage.materialId,
              width: decimalInputValue(selected.sheetUsage.itemWidthCm),
              height: decimalInputValue(selected.sheetUsage.itemHeightCm),
            }
          : null,
        selected.legacyMaterialsCostCents,
      ),
    );
  }

  function startNewProduct() {
    if (!confirmDiscardChanges()) return;
    const nextForm = {
      ...effectiveForm,
      materials: 0,
      packaging: 0,
      referenceQuantity: 1,
      minimumResaleQuantity: 10,
      commercialUnit: 'unidade' as const,
    };
    setActiveProductId('');
    setProductName('');
    setForm(nextForm);
    setFieldInputs(pricingFieldInputsFromForm(nextForm));
    setMaterialUsages([]);
    setSheetMaterialId('');
    setSheetWidthInput('');
    setSheetHeightInput('');
    setLegacyMaterialsCostCents(null);
    persistPricingDraft(nextForm);
    setBaseline(pricingSnapshot('', nextForm, [], null, null));
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

    if (
      !Number.isSafeInteger(minimumResaleQuantity) ||
      minimumResaleQuantity < 1 ||
      minimumResaleQuantity > 100_000
    ) {
      setProductFeedback(
        'Informe uma quantidade mínima para revenda entre 1 e 100.000.',
      );
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
        sheetUsage,
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
          saved.sheetUsage
            ? {
                materialId: saved.sheetUsage.materialId,
                width: decimalInputValue(saved.sheetUsage.itemWidthCm),
                height: decimalInputValue(saved.sheetUsage.itemHeightCm),
              }
            : null,
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
        const nextCost = materialCostPerUnitFor(
          materialUsages,
          nextMaterials,
          sheetUsage,
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
              sheetMaterialId
                ? { materialId: sheetMaterialId, width: sheetWidthInput, height: sheetHeightInput }
                : null,
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
      const nextCost = materialCostPerUnitFor(usages, materials, sheetUsage);
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

  const sheetMaterials = materials.filter(
    (material) =>
      material.measurementUnit === 'folha' &&
      (!material.archived || material.id === sheetMaterialId),
  );

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
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
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
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">Precificações salvas</span>
                  <select
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    onChange={(event) => selectProductDraft(event.target.value)}
                    value={activeProductId}
                  >
                    <option value="">Nova precificação</option>
                    {productDrafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>{draft.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">Nome da precificação</span>
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
                        ? 'Atualizar precificação'
                        : 'Salvar precificação'}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">Quantidade analisada</span>
                  <input
                    aria-label="Quantidade analisada"
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    inputMode="numeric"
                    onChange={(event) => updateField('referenceQuantity', event.target.value)}
                    type="text"
                    value={fieldInputs.referenceQuantity}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">Unidade comercial</span>
                  <select
                    aria-label="Unidade comercial"
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        commercialUnit: event.target.value as PricingFormState['commercialUnit'],
                      }));
                      setProductFeedback('');
                    }}
                    value={form.commercialUnit}
                  >
                    {commercialUnits.map((unit) => (
                      <option key={unit} value={unit}>{commercialUnitLabels[unit]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#665147]">Quantidade mínima para revenda</span>
                  <input
                    aria-label="Quantidade mínima para revenda"
                    className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#b8860b] focus:ring-3 focus:ring-[#c69a45]/15"
                    inputMode="numeric"
                    onChange={(event) => updateField('minimumResaleQuantity', event.target.value)}
                    type="text"
                    value={fieldInputs.minimumResaleQuantity}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-col gap-1 text-xs text-[#806b60] sm:flex-row sm:items-center sm:justify-between">
                <p role="status">{productFeedback || (hasUnsavedChanges ? 'Existem alterações não salvas neste produto.' : 'Cada produto mantém seus próprios custos, materiais e margem.')}</p>
                <p>{productDrafts.length} {productDrafts.length === 1 ? 'produto salvo' : 'produtos salvos'} neste dispositivo</p>
              </div>
            </section>

            <section className="mt-5 rounded-2xl border border-[#e2d6ca] bg-[#fcfaf7] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold text-[#665147]">Materiais por unidade</p>
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
                          {new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(usage.usedQuantity)} {measurementUnitLabels[material.measurementUnit]}
                          {usage.materialId === sheetMaterialId
                            ? ' · custo calculado pelo aproveitamento A4'
                            : ` · ${money.format(materialUsageCostCents(material, usage.usedQuantity) / 100)}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="mt-4 rounded-2xl border border-[#e2d6ca] bg-[#fcfaf7] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold text-[#665147]">Aproveitamento em folha A4</p>
                  <p className="mt-1 text-sm text-[#806b60]">Informe o tamanho final de uma unidade. O sistema calcula quantas cabem em 21 × 29,7 cm, sem rotação.</p>
                </div>
                <button
                  aria-pressed={Boolean(sheetMaterialId)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${sheetMaterialId ? 'border-[#5c3d2e] bg-[#5c3d2e] text-white' : 'border-[#c7ab8f] bg-white text-[#6d4a39]'}`}
                  disabled={!sheetMaterialId && sheetMaterials.length === 0}
                  onClick={() => {
                    if (sheetMaterialId) {
                      setSheetMaterialId('');
                      setSheetWidthInput('');
                      setSheetHeightInput('');
                    } else {
                      setSheetMaterialId(sheetMaterials[0]?.id ?? '');
                    }
                    setProductFeedback('');
                  }}
                  type="button"
                >
                  {sheetMaterialId ? 'Desativar A4' : 'Usar aproveitamento A4'}
                </button>
              </div>

              {sheetMaterialId && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-[#665147]">Papel em folhas</span>
                    <select
                      aria-label="Papel em folhas"
                      className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-[#b8860b]"
                      onChange={(event) => setSheetMaterialId(event.target.value)}
                      value={sheetMaterialId}
                    >
                      {sheetMaterials.map((material) => (
                        <option key={material.id} value={material.id}>{material.description}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-[#665147]">Largura da unidade (cm)</span>
                    <input
                      aria-label="Largura da unidade em centímetros"
                      className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#b8860b]"
                      inputMode="decimal"
                      onChange={(event) => setSheetWidthInput(event.target.value)}
                      placeholder="Ex.: 10"
                      type="text"
                      value={sheetWidthInput}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-[#665147]">Altura da unidade (cm)</span>
                    <input
                      aria-label="Altura da unidade em centímetros"
                      className="w-full rounded-xl border border-[#d9cabc] bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#b8860b]"
                      inputMode="decimal"
                      onChange={(event) => setSheetHeightInput(event.target.value)}
                      placeholder="Ex.: 10"
                      type="text"
                      value={sheetHeightInput}
                    />
                  </label>
                  {calculation.result?.unitsPerSheet && (
                    <div className="sm:col-span-3 rounded-xl bg-[#f4eee7] px-3 py-2 text-sm text-[#6d5448]">
                      <strong>{calculation.result.unitsPerSheet} por folha</strong> · {calculation.result.sheetsNeeded} {calculation.result.sheetsNeeded === 1 ? 'folha necessária' : 'folhas necessárias'} · {money.format(calculation.result.sheetCostCents / 100)} em papel
                    </div>
                  )}
                </div>
              )}

              {!sheetMaterialId && sheetMaterials.length === 0 && (
                <p className="mt-3 text-xs text-[#8a6d5e]">Cadastre primeiro um material com unidade “Folha” na aba Materiais de uso.</p>
              )}
            </section>

            {form.packaging > 0 && (
              <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-amber-950">Custo legado de embalagem: {money.format(form.packaging)}</p>
                  <p className="mt-1 text-xs text-amber-900">Este valor antigo foi preservado. Nas novas precificações, cadastre a embalagem como material.</p>
                </div>
                <button
                  className="rounded-xl border border-amber-400 bg-white px-4 py-2 text-sm font-bold text-amber-950"
                  onClick={() => {
                    setForm((current) => ({ ...current, packaging: 0 }));
                    setFieldInputs((current) => ({ ...current, packaging: '0' }));
                    setProductFeedback('Custo legado removido. Salve a precificação para confirmar.');
                  }}
                  type="button"
                >
                  Remover custo legado
                </button>
              </section>
            )}

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

            <section className="mt-6 rounded-2xl border border-[#e2d6ca] bg-white p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-[#4b3027]">Simulação por quantidade</p>
                  <p className="mt-1 text-xs text-[#806b60]">Compare as quantidades padrão e a quantidade analisada acima.</p>
                </div>
                {resaleCalculation && (
                  <p className="text-xs text-[#6d5448]">
                    Revenda a partir de <strong>{resaleCalculation.quantity}</strong>: <strong>{money.format(resaleCalculation.suggestedUnitPriceCents / 100)} por {commercialUnitLabels[form.commercialUnit].toLocaleLowerCase('pt-BR')}</strong>
                  </p>
                )}
              </div>
              <div className="mt-4 overflow-x-auto rounded-xl border border-[#eadfd4]">
                <table className="min-w-[850px] w-full border-collapse text-right text-xs">
                  <thead className="bg-[#f4eee7] text-[#6d5448]">
                    <tr>
                      <th className="px-3 py-3 text-left">Quantidade</th>
                      <th className="px-3 py-3">Custo total</th>
                      <th className="px-3 py-3">Custo unitário</th>
                      <th className="px-3 py-3">Preço mínimo/un.</th>
                      <th className="px-3 py-3">Preço sugerido/un.</th>
                      <th className="px-3 py-3">Venda total</th>
                      <th className="px-3 py-3">Lucro total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulationRows.map((row) => (
                      <tr
                        className={`border-t border-[#eee4da] ${row.quantity === referenceQuantity ? 'bg-[#fff8e8]' : 'bg-white'}`}
                        key={row.quantity}
                      >
                        <th className="px-3 py-3 text-left font-bold text-[#4b3027]">
                          {row.quantity}
                          {row.quantity === referenceQuantity && <span className="ml-2 rounded-full bg-[#c99a3d] px-2 py-0.5 text-[10px] text-white">analisada</span>}
                        </th>
                        <td className="px-3 py-3">{money.format(row.productionCostCents / 100)}</td>
                        <td className="px-3 py-3">{money.format(row.unitProductionCostCents / 100)}</td>
                        <td className="px-3 py-3">{money.format(row.minimumUnitPriceCents / 100)}</td>
                        <td className="px-3 py-3 font-bold text-[#5c3d2e]">{money.format(row.suggestedUnitPriceCents / 100)}</td>
                        <td className="px-3 py-3">{money.format(row.saleTotalCents / 100)}</td>
                        <td className="px-3 py-3 font-bold text-[#8a650c]">{money.format(row.estimatedProfitCents / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="mt-6 rounded-2xl border border-[#e2d6ca] bg-[#f8f3ed] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9a6f57]">Regra aplicada</p>
              <p className="mt-2 text-sm leading-6 text-[#6f5a4f]">Custo total dividido por 1 menos margem, impostos e taxas percentuais. Os materiais são calculados pela quantidade usada em cada peça.</p>
            </div>
          </section>

          <aside className="min-w-0 overflow-hidden rounded-3xl bg-[#4b3027] p-6 text-white shadow-[0_18px_48px_rgb(70_43_33/18%)]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d7b56f]">Preço sugerido</p>
            {calculation.result ? (
              <>
                <p className="mt-3 max-w-full break-all text-[clamp(1.75rem,3vw,2.25rem)] font-black leading-tight tracking-tight">{money.format(calculation.result.suggestedUnitPriceCents / 100)}</p>
                <p className="mt-2 text-sm text-[#e0d0c6]">por {commercialUnitLabels[form.commercialUnit].toLocaleLowerCase('pt-BR')}, para {calculation.result.quantity} {calculation.result.quantity === 1 ? 'unidade' : 'unidades'}</p>

                <dl className="mt-7 space-y-3 border-t border-white/15 pt-5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="min-w-0 text-[#d8c6ba]">Custo total</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.productionCostCents / 100)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="min-w-0 text-[#d8c6ba]">Custo por unidade</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.unitProductionCostCents / 100)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="min-w-0 text-[#d8c6ba]">Preço mínimo/un.</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.minimumUnitPriceCents / 100)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="min-w-0 text-[#d8c6ba]">Venda total</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold">{money.format(calculation.result.saleTotalCents / 100)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-white/15 pt-3">
                    <dt className="min-w-0 text-[#d8c6ba]">Lucro total</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold text-[#e2c479]">{money.format(calculation.result.estimatedProfitCents / 100)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="min-w-0 text-[#d8c6ba]">Lucro por unidade</dt>
                    <dd className="min-w-0 max-w-[58%] break-all text-right font-bold text-[#e2c479]">{money.format(calculation.result.unitProfitCents / 100)}</dd>
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
