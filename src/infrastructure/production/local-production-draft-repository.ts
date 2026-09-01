import {
  productionOrdersSchema,
  type ProductionOrder,
} from '../../domain/production/production-order';
import {
  readStoredDocument,
  writeStoredDocument,
} from '../persistence/document-storage';

export const PRODUCTION_DRAFTS_STORAGE_KEY =
  'ambro-studio:production-drafts:v1';

export function parseStoredProductionDrafts(serializedDrafts: string | null) {
  if (!serializedDrafts) return [];

  try {
    const parsed = productionOrdersSchema.safeParse(JSON.parse(serializedDrafts));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadProductionDrafts() {
  return parseStoredProductionDrafts(
    readStoredDocument(PRODUCTION_DRAFTS_STORAGE_KEY),
  );
}

export async function persistProductionDrafts(orders: ProductionOrder[]) {
  try {
    await writeStoredDocument(
      PRODUCTION_DRAFTS_STORAGE_KEY,
      JSON.stringify(productionOrdersSchema.parse(orders)),
    );
    return true;
  } catch {
    return false;
  }
}
