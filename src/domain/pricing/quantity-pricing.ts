import { z } from 'zod';
import {
  materialUsageCostCents,
  materialUsagesSchema,
  type MaterialUsage,
  type PricingMaterial,
} from './material';
import { BASIS_POINTS, calculatePrice } from './calculate-price';

export const pricingSheetUsageSchema = z
  .object({
    materialId: z.string().uuid(),
    itemWidthCm: z.number().finite().positive().max(1_000),
    itemHeightCm: z.number().finite().positive().max(1_000),
  })
  .strict();

export type PricingSheetUsage = z.infer<typeof pricingSheetUsageSchema>;

export type QuantityPricingInput = {
  quantity: number;
  materialUsages: MaterialUsage[];
  materials: PricingMaterial[];
  sheetUsage: PricingSheetUsage | null;
  legacyMaterialsCostCentsPerUnit: number | null;
  laborCostPerHourCents: number;
  fixedCostPerHourCents: number;
  productionMinutesPerUnit: number;
  legacyPackagingCostCentsPerUnit: number;
  wasteBasisPoints: number;
  desiredMarginBasisPoints: number;
  taxBasisPoints: number;
  channelFeeBasisPoints: number;
  channelFixedFeeCents: number;
};

const safeMoneySchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const quantityPricingBreakdownSchema = z
  .object({
    quantity: z.number().int().positive().max(100_000),
    materialsCostCents: safeMoneySchema,
    sheetCostCents: safeMoneySchema,
    sheetsNeeded: z.number().int().nonnegative().max(100_000),
    unitsPerSheet: z.number().int().positive().nullable(),
    productionCostCents: safeMoneySchema,
    unitProductionCostCents: safeMoneySchema,
    minimumUnitPriceCents: safeMoneySchema,
    suggestedUnitPriceCents: safeMoneySchema,
    saleTotalCents: safeMoneySchema,
    estimatedTaxCents: safeMoneySchema,
    estimatedChannelFeeCents: safeMoneySchema,
    estimatedProfitCents: safeMoneySchema,
    unitProfitCents: safeMoneySchema,
  })
  .strict();

export type QuantityPricingBreakdown = z.infer<
  typeof quantityPricingBreakdownSchema
>;

export class QuantityPricingError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_QUANTITY'
      | 'A4_MATERIAL_NOT_FOUND'
      | 'A4_MATERIAL_UNIT_INVALID'
      | 'A4_ITEM_DOES_NOT_FIT'
      | 'UNSAFE_QUANTITY_RESULT',
  ) {
    super(code);
    this.name = 'QuantityPricingError';
  }
}

function assertSafeNonNegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new QuantityPricingError('UNSAFE_QUANTITY_RESULT');
  }
}

function percentageOf(valueCents: number, basisPoints: number) {
  return Math.round((valueCents * basisPoints) / BASIS_POINTS);
}

function a4Usage(
  quantity: number,
  sheetUsage: PricingSheetUsage,
  materials: PricingMaterial[],
) {
  const usage = pricingSheetUsageSchema.parse(sheetUsage);
  const material = materials.find(({ id }) => id === usage.materialId);
  if (!material) throw new QuantityPricingError('A4_MATERIAL_NOT_FOUND');
  if (material.measurementUnit !== 'folha') {
    throw new QuantityPricingError('A4_MATERIAL_UNIT_INVALID');
  }

  const across = Math.floor(21 / usage.itemWidthCm);
  const down = Math.floor(29.7 / usage.itemHeightCm);
  const unitsPerSheet = across * down;
  if (unitsPerSheet < 1) {
    throw new QuantityPricingError('A4_ITEM_DOES_NOT_FIT');
  }

  const sheetsNeeded = Math.ceil(quantity / unitsPerSheet);
  return {
    unitsPerSheet,
    sheetsNeeded,
    sheetCostCents: materialUsageCostCents(material, sheetsNeeded),
  };
}

function normalMaterialsCostCents(
  quantity: number,
  usages: MaterialUsage[],
  materials: PricingMaterial[],
  excludedMaterialId?: string,
) {
  const validatedUsages = materialUsagesSchema.parse(usages);
  const uniqueIds = new Set(validatedUsages.map(({ materialId }) => materialId));
  if (uniqueIds.size !== validatedUsages.length) {
    throw new Error('DUPLICATED_MATERIAL_USAGE');
  }

  return validatedUsages.reduce((total, usage) => {
    if (usage.materialId === excludedMaterialId) return total;
    const material = materials.find(({ id }) => id === usage.materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');
    const usageForQuantity = usage.usedQuantity * quantity;
    const next = total + materialUsageCostCents(material, usageForQuantity);
    assertSafeNonNegativeInteger(next);
    return next;
  }, 0);
}

export function calculateQuantityMaterials(input: {
  quantity: number;
  materialUsages: MaterialUsage[];
  materials: PricingMaterial[];
  sheetUsage: PricingSheetUsage | null;
  legacyMaterialsCostCentsPerUnit: number | null;
}) {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 100_000
  ) {
    throw new QuantityPricingError('INVALID_QUANTITY');
  }

  const sheet = input.sheetUsage
    ? a4Usage(input.quantity, input.sheetUsage, input.materials)
    : { unitsPerSheet: null, sheetsNeeded: 0, sheetCostCents: 0 };
  const materialsCostCents =
    input.legacyMaterialsCostCentsPerUnit !== null
      ? input.legacyMaterialsCostCentsPerUnit * input.quantity
      : normalMaterialsCostCents(
          input.quantity,
          input.materialUsages,
          input.materials,
          input.sheetUsage?.materialId,
        ) + sheet.sheetCostCents;
  assertSafeNonNegativeInteger(materialsCostCents);
  return { ...sheet, materialsCostCents };
}

export function calculateQuantityPrice(
  input: QuantityPricingInput,
): QuantityPricingBreakdown {
  const materialCalculation = calculateQuantityMaterials(input);
  const { materialsCostCents } = materialCalculation;
  const productionMinutes =
    input.productionMinutesPerUnit * input.quantity;
  const legacyPackagingCostCents =
    input.legacyPackagingCostCentsPerUnit * input.quantity;

  [materialsCostCents, productionMinutes, legacyPackagingCostCents].forEach(
    assertSafeNonNegativeInteger,
  );

  const baseCalculationInput = {
    materialsCostCents,
    laborCostPerHourCents: input.laborCostPerHourCents,
    fixedCostPerHourCents: input.fixedCostPerHourCents,
    productionMinutes,
    packagingCostCents: legacyPackagingCostCents,
    depreciationCostCents: 0,
    wasteBasisPoints: input.wasteBasisPoints,
    taxBasisPoints: input.taxBasisPoints,
    channelFeeBasisPoints: input.channelFeeBasisPoints,
    channelFixedFeeCents: input.channelFixedFeeCents,
  };
  const suggested = calculatePrice({
    ...baseCalculationInput,
    desiredMarginBasisPoints: input.desiredMarginBasisPoints,
  });
  const minimum = calculatePrice({
    ...baseCalculationInput,
    desiredMarginBasisPoints: 0,
  });
  const suggestedUnitPriceCents = Math.ceil(
    suggested.suggestedPriceCents / input.quantity,
  );
  const saleTotalCents = suggestedUnitPriceCents * input.quantity;
  const estimatedTaxCents = percentageOf(
    saleTotalCents,
    input.taxBasisPoints,
  );
  const estimatedChannelFeeCents = percentageOf(
    saleTotalCents,
    input.channelFeeBasisPoints,
  );
  const estimatedProfitCents =
    saleTotalCents -
    suggested.productionCostCents -
    input.channelFixedFeeCents -
    estimatedTaxCents -
    estimatedChannelFeeCents;

  const result = quantityPricingBreakdownSchema.parse({
    quantity: input.quantity,
    materialsCostCents,
    sheetCostCents: materialCalculation.sheetCostCents,
    sheetsNeeded: materialCalculation.sheetsNeeded,
    unitsPerSheet: materialCalculation.unitsPerSheet,
    productionCostCents: suggested.productionCostCents,
    unitProductionCostCents: Math.round(
      suggested.productionCostCents / input.quantity,
    ),
    minimumUnitPriceCents: Math.ceil(
      minimum.suggestedPriceCents / input.quantity,
    ),
    suggestedUnitPriceCents,
    saleTotalCents,
    estimatedTaxCents,
    estimatedChannelFeeCents,
    estimatedProfitCents,
    unitProfitCents: Math.round(estimatedProfitCents / input.quantity),
  });
  Object.values(result)
    .filter((value): value is number => typeof value === 'number')
    .forEach(assertSafeNonNegativeInteger);
  return result;
}
