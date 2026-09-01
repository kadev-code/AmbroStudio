export const BASIS_POINTS = 10_000;

export type PricingInput = {
  materialsCostCents: number;
  laborCostPerHourCents: number;
  fixedCostPerHourCents: number;
  productionMinutes: number;
  packagingCostCents: number;
  depreciationCostCents: number;
  wasteBasisPoints: number;
  desiredMarginBasisPoints: number;
  taxBasisPoints: number;
  channelFeeBasisPoints: number;
  channelFixedFeeCents: number;
};

export type PricingBreakdown = {
  materialsCostCents: number;
  wasteCostCents: number;
  laborCostCents: number;
  allocatedFixedCostCents: number;
  packagingCostCents: number;
  depreciationCostCents: number;
  productionCostCents: number;
  channelFixedFeeCents: number;
  suggestedPriceCents: number;
  estimatedTaxCents: number;
  estimatedChannelFeeCents: number;
  estimatedProfitCents: number;
  achievedMarginBasisPoints: number;
};

export class PricingCalculationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'INVALID_PERCENTAGE_TOTAL'
      | 'UNSAFE_NUMBER',
  ) {
    super(code);
    this.name = 'PricingCalculationError';
  }
}

function assertNonNegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PricingCalculationError(
      Number.isSafeInteger(value) ? 'INVALID_INPUT' : 'UNSAFE_NUMBER',
    );
  }
}

function percentageOf(valueCents: number, basisPoints: number) {
  return Math.round((valueCents * basisPoints) / BASIS_POINTS);
}

export function calculatePrice(input: PricingInput): PricingBreakdown {
  Object.values(input).forEach(assertNonNegativeInteger);

  const percentageTotal =
    input.desiredMarginBasisPoints +
    input.taxBasisPoints +
    input.channelFeeBasisPoints;

  assertNonNegativeInteger(percentageTotal);

  if (percentageTotal >= BASIS_POINTS) {
    throw new PricingCalculationError('INVALID_PERCENTAGE_TOTAL');
  }

  const laborCostCents = Math.round(
    (input.laborCostPerHourCents * input.productionMinutes) / 60,
  );
  const allocatedFixedCostCents = Math.round(
    (input.fixedCostPerHourCents * input.productionMinutes) / 60,
  );
  const wasteCostCents = percentageOf(
    input.materialsCostCents + laborCostCents + allocatedFixedCostCents,
    input.wasteBasisPoints,
  );

  const productionCostCents =
    input.materialsCostCents +
    wasteCostCents +
    laborCostCents +
    allocatedFixedCostCents +
    input.packagingCostCents +
    input.depreciationCostCents;

  const priceDenominator = BASIS_POINTS - percentageTotal;
  const suggestedPriceCents = Math.ceil(
    ((productionCostCents + input.channelFixedFeeCents) * BASIS_POINTS) /
      priceDenominator,
  );
  const estimatedTaxCents = percentageOf(
    suggestedPriceCents,
    input.taxBasisPoints,
  );
  const estimatedChannelFeeCents = percentageOf(
    suggestedPriceCents,
    input.channelFeeBasisPoints,
  );
  const estimatedProfitCents =
    suggestedPriceCents -
    productionCostCents -
    input.channelFixedFeeCents -
    estimatedTaxCents -
    estimatedChannelFeeCents;
  const achievedMarginBasisPoints =
    suggestedPriceCents === 0
      ? 0
      : Math.round(
          (estimatedProfitCents * BASIS_POINTS) / suggestedPriceCents,
        );

  [
    wasteCostCents,
    laborCostCents,
    allocatedFixedCostCents,
    productionCostCents,
    suggestedPriceCents,
    estimatedTaxCents,
    estimatedChannelFeeCents,
    estimatedProfitCents,
    achievedMarginBasisPoints,
  ].forEach(assertNonNegativeInteger);

  return {
    materialsCostCents: input.materialsCostCents,
    wasteCostCents,
    laborCostCents,
    allocatedFixedCostCents,
    packagingCostCents: input.packagingCostCents,
    depreciationCostCents: input.depreciationCostCents,
    productionCostCents,
    channelFixedFeeCents: input.channelFixedFeeCents,
    suggestedPriceCents,
    estimatedTaxCents,
    estimatedChannelFeeCents,
    estimatedProfitCents,
    achievedMarginBasisPoints,
  };
}
