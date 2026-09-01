import { z } from 'zod';
import { decimalInputValue, parseLocalizedNumber } from './pricing-format';

export const PRICING_DRAFT_STORAGE_KEY = 'ambro-studio:pricing-draft:v1';

export const commercialUnits = ['unidade', 'kit', 'folha'] as const;

export const commercialUnitLabels: Record<(typeof commercialUnits)[number], string> = {
  unidade: 'Unidade',
  kit: 'Kit',
  folha: 'Folha',
};

export const pricingFormSchema = z
  .object({
    materials: z.number().finite().nonnegative(),
    laborHour: z.number().finite().nonnegative(),
    fixedHour: z.number().finite().nonnegative(),
    minutes: z.number().finite().nonnegative(),
    packaging: z.number().finite().nonnegative(),
    wastePercent: z.number().finite().nonnegative(),
    marginPercent: z.number().finite().nonnegative(),
    taxPercent: z.number().finite().nonnegative(),
    channelPercent: z.number().finite().nonnegative(),
    referenceQuantity: z.number().int().positive().max(100_000).default(1),
    minimumResaleQuantity: z.number().int().positive().max(100_000).default(10),
    commercialUnit: z.enum(commercialUnits).default('unidade'),
  })
  .strict();

export type PricingFormState = z.infer<typeof pricingFormSchema>;

export const pricingEditableFieldKeys = [
  'laborHour',
  'fixedHour',
  'minutes',
  'packaging',
  'wastePercent',
  'marginPercent',
  'taxPercent',
  'channelPercent',
  'referenceQuantity',
  'minimumResaleQuantity',
] as const;

export type PricingEditableField = (typeof pricingEditableFieldKeys)[number];

export type PricingFieldInputs = Record<PricingEditableField, string>;

export const DEFAULT_PRICING_FORM: PricingFormState = {
  materials: 0,
  laborHour: 24,
  fixedHour: 12,
  minutes: 30,
  packaging: 0,
  wastePercent: 5,
  marginPercent: 40,
  taxPercent: 6,
  channelPercent: 5,
  referenceQuantity: 1,
  minimumResaleQuantity: 10,
  commercialUnit: 'unidade',
};

export function pricingFieldInputsFromForm(
  form: PricingFormState,
): PricingFieldInputs {
  return Object.fromEntries(
    pricingEditableFieldKeys.map((key) => [key, decimalInputValue(form[key])]),
  ) as PricingFieldInputs;
}

export function pricingNumberFromInput(value: string) {
  if (!value.trim()) return 0;
  const parsed = parseLocalizedNumber(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function updatePricingFormFromInput(
  form: PricingFormState,
  key: PricingEditableField,
  value: string,
) {
  const numericValue = pricingNumberFromInput(value);
  if (
    (key === 'referenceQuantity' || key === 'minimumResaleQuantity') &&
    (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 100_000)
  ) {
    return form;
  }

  return pricingFormSchema.parse({
    ...form,
    [key]: numericValue,
  });
}

export function parsePricingDraft(serializedDraft: string | null) {
  if (!serializedDraft) return { ...DEFAULT_PRICING_FORM };

  try {
    const parsed = pricingFormSchema.safeParse(JSON.parse(serializedDraft));
    return parsed.success ? parsed.data : { ...DEFAULT_PRICING_FORM };
  } catch {
    return { ...DEFAULT_PRICING_FORM };
  }
}

export function loadPricingDraft() {
  if (typeof window === 'undefined') return { ...DEFAULT_PRICING_FORM };

  try {
    return parsePricingDraft(
      window.localStorage.getItem(PRICING_DRAFT_STORAGE_KEY),
    );
  } catch {
    return { ...DEFAULT_PRICING_FORM };
  }
}

export function persistPricingDraft(form: PricingFormState) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      PRICING_DRAFT_STORAGE_KEY,
      JSON.stringify(form),
    );
  } catch {
    // O cálculo continua funcionando mesmo se o navegador bloquear o storage.
  }
}
