export const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const decimal = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 4,
});

export function parseLocalizedNumber(value: string) {
  const trimmed = value.trim().replaceAll(' ', '');
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : trimmed;
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

export function decimalInputValue(value: number) {
  return String(value).replace('.', ',');
}

export function formatUnitCost(costCents: number, unit: string) {
  return `R$ ${decimal.format(costCents / 100)}/${unit}`;
}
