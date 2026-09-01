import { z } from 'zod';
import {
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
import {
  calculateQuantityPrice,
  calculateQuantityMaterials,
  pricingSheetUsageSchema,
  quantityPricingBreakdownSchema,
  type PricingSheetUsage,
} from '../../domain/pricing/quantity-pricing';

export const PRICING_PRODUCTS_STORAGE_KEY =
  'ambro-studio:pricing-product-drafts:v1';

const pricingVersionResultsSchema = z
  .object({
    unit: quantityPricingBreakdownSchema,
    reference: quantityPricingBreakdownSchema,
    resale: quantityPricingBreakdownSchema,
  })
  .strict();

export const pricingProductVersionSchema = z
  .object({
    id: z.string().uuid(),
    versionNumber: z.number().int().positive().max(100_000),
    form: pricingFormSchema,
    materialUsages: materialUsagesSchema,
    sheetUsage: pricingSheetUsageSchema.nullable(),
    legacyMaterialsCostCents: z
      .number()
      .int()
      .nonnegative()
      .max(999_999_999)
      .nullable(),
    materials: pricingMaterialsSchema,
    results: pricingVersionResultsSchema,
    calculationRuleVersion: z.enum(['legacy-import-v1', 'quantity-v1']),
    createdBy: z.literal('local'),
    createdAt: z.string().datetime(),
  })
  .strict();

export type PricingProductVersion = z.infer<
  typeof pricingProductVersionSchema
>;

export const pricingProductDraftSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    form: pricingFormSchema,
    materialUsages: materialUsagesSchema.default([]),
    sheetUsage: pricingSheetUsageSchema.nullable().default(null),
    legacyMaterialsCostCents: z
      .number()
      .int()
      .nonnegative()
      .max(999_999_999)
      .nullable()
      .default(null),
    versions: z.array(pricingProductVersionSchema).max(100).default([]),
    updatedAt: z.string().datetime(),
  })
  .strict();

const pricingProductDraftsSchema = z.array(pricingProductDraftSchema);

export type PricingProductDraft = z.infer<typeof pricingProductDraftSchema>;

function pricingVersionCalculation(
  quantity: number,
  input: {
    form: PricingFormState;
    materialUsages: MaterialUsage[];
    sheetUsage: PricingSheetUsage | null;
    legacyMaterialsCostCents: number | null;
    materials: PricingMaterial[];
  },
) {
  return calculateQuantityPrice({
    quantity,
    materialUsages: input.materialUsages,
    materials: input.materials,
    sheetUsage: input.sheetUsage,
    legacyMaterialsCostCentsPerUnit: input.legacyMaterialsCostCents,
    laborCostPerHourCents: Math.round(input.form.laborHour * 100),
    fixedCostPerHourCents: Math.round(input.form.fixedHour * 100),
    productionMinutesPerUnit: Math.round(input.form.minutes),
    legacyPackagingCostCentsPerUnit: Math.round(input.form.packaging * 100),
    wasteBasisPoints: Math.round(input.form.wastePercent * 100),
    desiredMarginBasisPoints: Math.round(input.form.marginPercent * 100),
    taxBasisPoints: Math.round(input.form.taxPercent * 100),
    channelFeeBasisPoints: Math.round(input.form.channelPercent * 100),
    channelFixedFeeCents: 0,
  });
}

function costRelevantMaterials(
  materialUsages: MaterialUsage[],
  sheetUsage: PricingSheetUsage | null,
  materials: PricingMaterial[],
) {
  const relevantIds = new Set([
    ...materialUsages.map(({ materialId }) => materialId),
    ...(sheetUsage ? [sheetUsage.materialId] : []),
  ]);
  return materials
    .filter(({ id }) => relevantIds.has(id))
    .map((material) => ({ ...material, purchaseUrl: '', notes: '' }));
}

export function createPricingProductVersion(input: {
  id?: string;
  versionNumber: number;
  form: PricingFormState;
  materialUsages: MaterialUsage[];
  sheetUsage: PricingSheetUsage | null;
  legacyMaterialsCostCents: number | null;
  materials: PricingMaterial[];
  calculationRuleVersion?: 'legacy-import-v1' | 'quantity-v1';
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const materials = costRelevantMaterials(
    input.materialUsages,
    input.sheetUsage,
    input.materials,
  );
  const calculationInput = { ...input, materials };

  return pricingProductVersionSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    versionNumber: input.versionNumber,
    form: input.form,
    materialUsages: input.materialUsages,
    sheetUsage: input.sheetUsage,
    legacyMaterialsCostCents: input.legacyMaterialsCostCents,
    materials,
    results: {
      unit: pricingVersionCalculation(1, calculationInput),
      reference: pricingVersionCalculation(
        input.form.referenceQuantity,
        calculationInput,
      ),
      resale: pricingVersionCalculation(
        input.form.minimumResaleQuantity,
        calculationInput,
      ),
    },
    calculationRuleVersion: input.calculationRuleVersion ?? 'quantity-v1',
    createdBy: 'local',
    createdAt,
  });
}

function importedVersion(draft: PricingProductDraft) {
  return createPricingProductVersion({
    id: draft.id,
    versionNumber: 1,
    form: draft.form,
    materialUsages: draft.materialUsages,
    sheetUsage: draft.sheetUsage,
    legacyMaterialsCostCents: Math.round(draft.form.materials * 100),
    materials: [],
    calculationRuleVersion: 'legacy-import-v1',
    createdAt: draft.updatedAt,
  });
}

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
            versions: draft.versions ?? [],
          };
        })
      : raw;
    const parsed = pricingProductDraftsSchema.safeParse(migrated);
    if (!parsed.success) return [];

    return parsed.data.map((draft) => {
      if (draft.versions.length > 0) return draft;
      try {
        return pricingProductDraftSchema.parse({
          ...draft,
          versions: [importedVersion(draft)],
        });
      } catch {
        return draft;
      }
    });
  } catch {
    return [];
  }
}

export function loadPricingProductDrafts() {
  return parsePricingProductDrafts(
    readStoredDocument(PRICING_PRODUCTS_STORAGE_KEY),
  );
}

export async function persistPricingProductDrafts(drafts: PricingProductDraft[]) {
  try {
    await writeStoredDocument(
      PRICING_PRODUCTS_STORAGE_KEY,
      JSON.stringify(drafts),
    );
    return true;
  } catch {
    // Rascunhos são opcionais e nunca devem impedir a simulação de preço.
    return false;
  }
}

export async function persistPricingCatalogAndProductDrafts(
  materials: PricingMaterial[],
  drafts: PricingProductDraft[],
) {
  try {
    await writeStoredDocuments([
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
    sheetUsage?: PricingSheetUsage | null;
    legacyMaterialsCostCents?: number | null;
    materials?: PricingMaterial[];
    createVersion?: boolean;
    updatedAt?: string;
  },
) {
  const existing = input.id
    ? drafts.find((item) => item.id === input.id)
    : undefined;
  const materialUsages = input.materialUsages ?? [];
  const sheetUsage = input.sheetUsage ?? null;
  const legacyMaterialsCostCents = input.legacyMaterialsCostCents ?? null;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const previousVersions = existing?.versions ?? [];
  const versionNumber =
    previousVersions.reduce(
      (highest, version) => Math.max(highest, version.versionNumber),
      0,
    ) + 1;
  const versionLegacyMaterialsCostCents =
    legacyMaterialsCostCents ??
    (materialUsages.length === 0 && sheetUsage === null
      ? Math.round(input.form.materials * 100)
      : null);
  const versions =
    input.createVersion === false
      ? previousVersions
      : [
          createPricingProductVersion({
            versionNumber,
            form: input.form,
            materialUsages,
            sheetUsage,
            legacyMaterialsCostCents: versionLegacyMaterialsCostCents,
            materials: input.materials ?? [],
            createdAt: updatedAt,
          }),
          ...previousVersions,
        ].slice(0, 100);
  const draft = pricingProductDraftSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    form: input.form,
    materialUsages,
    sheetUsage,
    legacyMaterialsCostCents,
    versions,
    updatedAt,
  });
  const remainingDrafts = drafts.filter((item) => item.id !== draft.id);

  return [draft, ...remainingDrafts].sort((first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  );
}

export function pricingProductMaterialsCostCents(
  draft: Pick<
    PricingProductDraft,
    'form' | 'materialUsages' | 'sheetUsage' | 'legacyMaterialsCostCents'
  >,
  materials: PricingMaterial[],
) {
  if (draft.legacyMaterialsCostCents !== null) {
    return draft.legacyMaterialsCostCents;
  }
  return Math.round(
    calculateQuantityMaterials({
      quantity: draft.form.referenceQuantity,
      materialUsages: draft.materialUsages,
      materials,
      sheetUsage: draft.sheetUsage,
      legacyMaterialsCostCentsPerUnit: null,
    }).materialsCostCents / draft.form.referenceQuantity,
  );
}

export function latestPricingProductVersion(
  draft: PricingProductDraft | undefined,
) {
  if (!draft || draft.versions.length === 0) return null;
  return draft.versions.reduce((latest, version) =>
    version.versionNumber > latest.versionNumber ? version : latest,
  );
}

export function suggestedPriceForProductDraft(
  draft: PricingProductDraft | undefined,
) {
  if (!draft) return null;

  const latestVersion = latestPricingProductVersion(draft);
  if (latestVersion) {
    return latestVersion.results.unit.suggestedUnitPriceCents;
  }

  try {
    return calculateQuantityPrice({
      quantity: draft.form.referenceQuantity,
      materialUsages: [],
      materials: [],
      sheetUsage: null,
      legacyMaterialsCostCentsPerUnit: Math.round(draft.form.materials * 100),
      laborCostPerHourCents: Math.round(draft.form.laborHour * 100),
      fixedCostPerHourCents: Math.round(draft.form.fixedHour * 100),
      productionMinutesPerUnit: Math.round(draft.form.minutes),
      legacyPackagingCostCentsPerUnit: Math.round(draft.form.packaging * 100),
      wasteBasisPoints: Math.round(draft.form.wastePercent * 100),
      desiredMarginBasisPoints: Math.round(draft.form.marginPercent * 100),
      taxBasisPoints: Math.round(draft.form.taxPercent * 100),
      channelFeeBasisPoints: Math.round(draft.form.channelPercent * 100),
      channelFixedFeeCents: 0,
    }).suggestedUnitPriceCents;
  } catch {
    return null;
  }
}
