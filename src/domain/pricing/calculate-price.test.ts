import { describe, expect, it } from 'vitest';
import {
  calculatePrice,
  PricingCalculationError,
  type PricingInput,
} from './calculate-price';

const baseInput: PricingInput = {
  materialsCostCents: 800,
  laborCostPerHourCents: 2400,
  fixedCostPerHourCents: 1200,
  productionMinutes: 30,
  packagingCostCents: 100,
  depreciationCostCents: 50,
  wasteBasisPoints: 500,
  desiredMarginBasisPoints: 4000,
  taxBasisPoints: 600,
  channelFeeBasisPoints: 500,
  channelFixedFeeCents: 0,
};

describe('calculatePrice', () => {
  it('calcula o preço usando margem sobre a venda', () => {
    const result = calculatePrice(baseInput);

    expect(result.productionCostCents).toBe(2790);
    expect(result.suggestedPriceCents).toBe(5694);
    expect(result.estimatedProfitCents).toBeGreaterThanOrEqual(2276);
    expect(result.achievedMarginBasisPoints).toBeGreaterThanOrEqual(3998);
  });

  it('inclui taxa fixa no numerador', () => {
    const withoutFee = calculatePrice(baseInput);
    const withFee = calculatePrice({
      ...baseInput,
      channelFixedFeeCents: 200,
    });

    expect(withFee.suggestedPriceCents).toBeGreaterThan(
      withoutFee.suggestedPriceCents,
    );
  });

  it('recusa percentuais que eliminam o denominador', () => {
    expect(() =>
      calculatePrice({
        ...baseInput,
        desiredMarginBasisPoints: 9000,
        taxBasisPoints: 500,
        channelFeeBasisPoints: 500,
      }),
    ).toThrowError(PricingCalculationError);
  });

  it('recusa resultados acima do limite seguro de inteiros', () => {
    expect(() =>
      calculatePrice({
        ...baseInput,
        materialsCostCents: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrowError(PricingCalculationError);
  });
});
