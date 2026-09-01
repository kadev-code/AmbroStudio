import { z } from 'zod';
import { calculatePrice } from '../../domain/pricing/calculate-price';
import {
  materialUsagesCostCents,
  materialUsagesSchema,
  pricingMaterialsSchema,
  type MaterialUsage,
  type PricingMaterial,
} from '../../domain/pricing/material';
import {
  readStoredDocument,
  writeStoredDocument,
  writeStoredDocuments,
} from '../../infrastructure/persistence/document-storage';
import { PRICING_MATERIALS_STORAGE_KEY } from '../../infrastructure/pricing/local-material-catalog-repository';
import { pricingFormSchema, type PricingFormState } from './pricing-form-state';

export const PRICING_PRODUCTS_STORAGE_KEY =
  'ambro-studio:pricing-product-drafts:v1';

export const pricingProductDraftSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    form: pricingFormSchema,
    materialUsages: materialUsagesSchema.default([]),
    legacyMaterialsCostCents: z
      .number()
      .int()
      .nonnegative()
      .max(999_999_999)
      .nullable()
      .default(null),
    updatedAt: z.string().datetime(),
  })
  .strict();

const pricingProductDraftsSchema = z.array(pricingProductDraftSchema);

export type PricingProductDraft = z.infer<typeof pricingProductDraftSchema>;

export function parsePricingProductDrafts(serializedDrafts: string | null) {
  if (!serializedDrafts) return [];

  try {
    const raw = JSON.parse(serializedDrafts) as unknown;
    const migrated = Array.isArray(raw)
      ? raw.map((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return value;
          }
          const draft = value as Record<string, unknown>;
          const form = draft.form as Record<string, unknown> | undefined;
          const isLegacy = !Object.hasOwn(draft, 'materialUsages');
          return {
            ...draft,
            materialUsages: isLegacy ? [] : draft.materialUsages,
            legacyMaterialsCostCents: isLegacy
              ? Math.max(
                  0,
                  Math.round(Number(form?.materials ?? 0) * 100),
                ) || null
              : (draft.legacyMaterialsCostCents ?? null),
          };
        })
      : raw;
    const parsed = pricingProductDraftsSchema.safeParse(migrated);
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
    return true;
  } catch {
    // Rascunhos são opcionais e nunca devem impedir a simulação de preço.
    return false;
  }
}

export function persistPricingCatalogAndProductDrafts(
  materials: PricingMaterial[],
  drafts: PricingProductDraft[],
) {
  try {
    writeStoredDocuments([
      {
        key: PRICING_MATERIALS_STORAGE_KEY,
        serializedValue: JSON.stringify(pricingMaterialsSchema.parse(materials)),
      },
      {
        key: PRICING_PRODUCTS_STORAGE_KEY,
        serializedValue: JSON.stringify(pricingProductDraftsSchema.parse(drafts)),
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

export function savePricingProductDraft(
  drafts: PricingProductDraft[],
  input: {
    id?: string;
    name: string;
    form: PricingFormState;
    materialUsages?: MaterialUsage[];
    legacyMaterialsCostCents?: number | null;
    updatedAt?: string;
  },
) {
  const draft = pricingProductDraftSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    form: input.form,
    materialUsages: input.materialUsages ?? [],
    legacyMaterialsCostCents: input.legacyMaterialsCostCents ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
  const remainingDrafts = drafts.filter((item) => item.id !== draft.id);

  return [draft, ...remainingDrafts].sort((first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  );
}

export function pricingProductMaterialsCostCents(
  draft: Pick<
    PricingProductDraft,
    'form' | 'materialUsages' | 'legacyMaterialsCostCents'
  >,
  materials: PricingMaterial[],
) {
  if (draft.legacyMaterialsCostCents !== null) {
    return draft.legacyMaterialsCostCents;
  }
  return materialUsagesCostCents(draft.materialUsages, materials);
}

export function refreshPricingProductMaterialCosts(
  drafts: PricingProductDraft[],
  materials: PricingMaterial[],
) {
  return drafts.map((draft) => {
    if (draft.legacyMaterialsCostCents !== null) return draft;
    try {
      const materialsCostCents = pricingProductMaterialsCostCents(
        draft,
        materials,
      );
      return pricingProductDraftSchema.parse({
        ...draft,
        form: { ...draft.form, materials: materialsCostCents / 100 },
      });
    } catch {
      return draft;
    }
  });
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
