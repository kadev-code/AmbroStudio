import { describe, expect, it } from 'vitest';
import { createPricingMaterial } from './material';
import {
  calculateQuantityPrice,
  QuantityPricingError,
  type QuantityPricingInput,
} from './quantity-pricing';

const timestamp = '2026-09-01T12:00:00.000Z';
const paper = createPricingMaterial(
  [],
  {
    description: 'Papel A4',
    purchasePriceCents: 1_000,
    purchasedQuantity: 10,
    measurementUnit: 'folha',
    purchaseUrl: '',
    notes: '',
  },
  { id: '11111111-1111-4111-8111-111111111111', timestamp },
)[0];
const glue = createPricingMaterial(
  [],
  {
    description: 'Cola',
    purchasePriceCents: 1_000,
    purchasedQuantity: 200,
    measurementUnit: 'ml',
    purchaseUrl: '',
    notes: '',
  },
  { id: '22222222-2222-4222-8222-222222222222', timestamp },
)[0];

const baseInput: QuantityPricingInput = {
  quantity: 10,
  materialUsages: [{ materialId: glue.id, usedQuantity: 5 }],
  materials: [paper, glue],
  sheetUsage: null,
  legacyMaterialsCostCentsPerUnit: null,
  laborCostPerHourCents: 2_400,
  fixedCostPerHourCents: 1_200,
  productionMinutesPerUnit: 6,
  legacyPackagingCostCentsPerUnit: 0,
  wasteBasisPoints: 500,
  desiredMarginBasisPoints: 4_000,
  taxBasisPoints: 600,
  channelFeeBasisPoints: 0,
  channelFixedFeeCents: 0,
};

describe('calculateQuantityPrice', () => {
  it('multiplica consumo, tempo e custos pela quantidade analisada', () => {
    const result = calculateQuantityPrice(baseInput);

    expect(result.materialsCostCents).toBe(250);
    expect(result.productionCostCents).toBe(4_043);
    expect(result.saleTotalCents).toBeGreaterThanOrEqual(7_490);
    expect(result.estimatedProfitCents).toBeGreaterThan(0);
  });

  it('cobra a folha A4 exclusivamente pelo aproveitamento', () => {
    const withA4 = {
      ...baseInput,
      materialUsages: [
        ...baseInput.materialUsages,
        { materialId: paper.id, usedQuantity: 1 },
      ],
      sheetUsage: {
        materialId: paper.id,
        itemWidthCm: 10,
        itemHeightCm: 10,
      },
    };

    const batch = calculateQuantityPrice(withA4);
    const oneUnit = calculateQuantityPrice({ ...withA4, quantity: 1 });

    expect(batch.unitsPerSheet).toBe(4);
    expect(batch.sheetsNeeded).toBe(3);
    expect(batch.sheetCostCents).toBe(300);
    expect(batch.materialsCostCents).toBe(550);
    expect(oneUnit.sheetsNeeded).toBe(1);
    expect(oneUnit.sheetCostCents).toBe(100);
  });

  it('recusa um item que não cabe na folha sem rotação automática', () => {
    expect(() =>
      calculateQuantityPrice({
        ...baseInput,
        sheetUsage: {
          materialId: paper.id,
          itemWidthCm: 22,
          itemHeightCm: 10,
        },
      }),
    ).toThrowError(QuantityPricingError);
  });
});
