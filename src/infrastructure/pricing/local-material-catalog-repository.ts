import {
  pricingMaterialsSchema,
  type PricingMaterial,
} from '../../domain/pricing/material';
import {
  readStoredDocument,
  writeStoredDocument,
} from '../persistence/document-storage';

export const PRICING_MATERIALS_STORAGE_KEY =
  'ambro-studio:pricing-materials:v1';

export function parseStoredPricingMaterials(serialized: string | null) {
  if (!serialized) return [];
  try {
    const parsed = pricingMaterialsSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadPricingMaterials() {
  return parseStoredPricingMaterials(
    readStoredDocument(PRICING_MATERIALS_STORAGE_KEY),
  );
}

export function persistPricingMaterials(materials: PricingMaterial[]) {
  writeStoredDocument(
    PRICING_MATERIALS_STORAGE_KEY,
    JSON.stringify(pricingMaterialsSchema.parse(materials)),
  );
}
