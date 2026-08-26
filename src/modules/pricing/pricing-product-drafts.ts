import { z } from 'zod';
import { calculatePrice } from '../../domain/pricing/calculate-price';
import {
  readStoredDocument,
  writeStoredDocument,
} from '../../infrastructure/persistence/document-storage';
import { pricingFormSchema, type PricingFormState } from './pricing-form-state';

export const PRICING_PRODUCTS_STORAGE_KEY =
  'ambro-studio:pricing-product-drafts:v1';

const pricingProductDraftSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    form: pricingFormSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

const pricingProductDraftsSchema = z.array(pricingProductDraftSchema);

export type PricingProductDraft = z.infer<typeof pricingProductDraftSchema>;

export function parsePricingProductDrafts(serializedDrafts: string | null) {
  if (!serializedDrafts) return [];

  try {
    const parsed = pricingProductDraftsSchema.safeParse(
      JSON.parse(serializedDrafts),
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadPricingProductDrafts() {
  return parsePricingProductDrafts(
    readStoredDocument(PRICING_PRODUCTS_STORAGE_KEY),
  );
}

export function persistPricingProductDrafts(drafts: PricingProductDraft[]) {
  try {
    writeStoredDocument(
      PRICING_PRODUCTS_STORAGE_KEY,
      JSON.stringify(drafts),
    );
  } catch {
    // Rascunhos são opcionais e nunca devem impedir a simulação de preço.
  }
}

export function savePricingProductDraft(
  drafts: PricingProductDraft[],
  input: {
    id?: string;
    name: string;
    form: PricingFormState;
    updatedAt?: string;
  },
) {
  const draft = pricingProductDraftSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    form: input.form,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
  const remainingDrafts = drafts.filter((item) => item.id !== draft.id);

  return [draft, ...remainingDrafts].sort((first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  );
}

export function suggestedPriceForProductDraft(
  draft: PricingProductDraft | undefined,
) {
  if (!draft) return null;

  try {
    return calculatePrice({
      materialsCostCents: Math.round(draft.form.materials * 100),
      laborCostPerHourCents: Math.round(draft.form.laborHour * 100),
      fixedCostPerHourCents: Math.round(draft.form.fixedHour * 100),
      productionMinutes: Math.round(draft.form.minutes),
      packagingCostCents: Math.round(draft.form.packaging * 100),
      depreciationCostCents: 0,
      wasteBasisPoints: Math.round(draft.form.wastePercent * 100),
      desiredMarginBasisPoints: Math.round(draft.form.marginPercent * 100),
      taxBasisPoints: Math.round(draft.form.taxPercent * 100),
      channelFeeBasisPoints: Math.round(draft.form.channelPercent * 100),
      channelFixedFeeCents: 0,
    }).suggestedPriceCents;
  } catch {
    return null;
  }
}
