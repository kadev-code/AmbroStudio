import { z } from 'zod';

export const measurementUnits = [
  'un',
  'folha',
  'ml',
  'l',
  'g',
  'kg',
  'cm',
  'm',
] as const;

export type MeasurementUnit = (typeof measurementUnits)[number];

export const measurementUnitLabels: Record<MeasurementUnit, string> = {
  un: 'Unidade',
  folha: 'Folha',
  ml: 'Mililitro (ml)',
  l: 'Litro (l)',
  g: 'Grama (g)',
  kg: 'Quilograma (kg)',
  cm: 'Centímetro (cm)',
  m: 'Metro (m)',
};

const optionalHttpsUrlSchema = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .max(1_000)
    .url()
    .refine((value) => value.startsWith('https://'), 'HTTPS_REQUIRED'),
]);

export const materialInputSchema = z
  .object({
    description: z.string().trim().min(1).max(120),
    purchasePriceCents: z.number().int().positive().max(999_999_999),
    purchasedQuantity: z.number().finite().positive().max(999_999_999),
    measurementUnit: z.enum(measurementUnits),
    purchaseUrl: optionalHttpsUrlSchema,
    notes: z.string().trim().max(2_000),
  })
  .strict();

export const pricingMaterialSchema = materialInputSchema
  .extend({
    id: z.string().uuid(),
    archived: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const pricingMaterialsSchema = z.array(pricingMaterialSchema).max(5_000);

export const materialUsageSchema = z
  .object({
    materialId: z.string().uuid(),
    usedQuantity: z.number().finite().positive().max(999_999_999),
  })
  .strict();

export const materialUsagesSchema = z.array(materialUsageSchema).max(200);

export type MaterialInput = z.infer<typeof materialInputSchema>;
export type PricingMaterial = z.infer<typeof pricingMaterialSchema>;
export type MaterialUsage = z.infer<typeof materialUsageSchema>;

export function createPricingMaterial(
  materials: PricingMaterial[],
  input: MaterialInput,
  options: { id?: string; timestamp?: string } = {},
) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const material = pricingMaterialSchema.parse({
    ...materialInputSchema.parse(input),
    id: options.id ?? crypto.randomUUID(),
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return [material, ...materials];
}

export function updatePricingMaterial(
  materials: PricingMaterial[],
  materialId: string,
  input: MaterialInput,
  timestamp = new Date().toISOString(),
) {
  const validatedInput = materialInputSchema.parse(input);
  return materials.map((material) =>
    material.id === materialId
      ? pricingMaterialSchema.parse({
          ...material,
          ...validatedInput,
          updatedAt: timestamp,
        })
      : material,
  );
}

export function setPricingMaterialArchived(
  materials: PricingMaterial[],
  materialId: string,
  archived: boolean,
  timestamp = new Date().toISOString(),
) {
  return materials.map((material) =>
    material.id === materialId
      ? pricingMaterialSchema.parse({ ...material, archived, updatedAt: timestamp })
      : material,
  );
}

export function materialUnitCostCents(material: PricingMaterial) {
  return material.purchasePriceCents / material.purchasedQuantity;
}

export function materialUsageCostCents(
  material: PricingMaterial,
  usedQuantity: number,
) {
  const usage = materialUsageSchema.parse({
    materialId: material.id,
    usedQuantity,
  });
  const value =
    (material.purchasePriceCents * usage.usedQuantity) /
    material.purchasedQuantity;
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) {
    throw new Error('UNSAFE_MATERIAL_COST');
  }
  return Math.round(value);
}

export function materialUsagesCostCents(
  usages: MaterialUsage[],
  materials: PricingMaterial[],
) {
  const validatedUsages = materialUsagesSchema.parse(usages);
  const uniqueIds = new Set(validatedUsages.map((usage) => usage.materialId));
  if (uniqueIds.size !== validatedUsages.length) {
    throw new Error('DUPLICATED_MATERIAL_USAGE');
  }

  return validatedUsages.reduce((total, usage) => {
    const material = materials.find((item) => item.id === usage.materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');
    const next = total + materialUsageCostCents(material, usage.usedQuantity);
    if (!Number.isSafeInteger(next)) throw new Error('UNSAFE_MATERIAL_COST');
    return next;
  }, 0);
}

export function filterPricingMaterials(
  materials: PricingMaterial[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalizedQuery) return materials;
  return materials.filter((material) =>
    material.description.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
  );
}
