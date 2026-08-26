import {
  clientDraftsSchema,
  type ClientDraft,
} from '../../domain/clients/client';
import {
  productionOrdersSchema,
  type ProductionOrder,
} from '../../domain/production/production-order';
import { CLIENT_DRAFTS_STORAGE_KEY } from '../clients/local-client-draft-repository';
import { writeStoredDocuments } from '../persistence/document-storage';
import { PRODUCTION_DRAFTS_STORAGE_KEY } from './local-production-draft-repository';

export function persistProductionCompletion(
  orders: ProductionOrder[],
  clients: ClientDraft[],
) {
  try {
    writeStoredDocuments([
      {
        key: PRODUCTION_DRAFTS_STORAGE_KEY,
        serializedValue: JSON.stringify(productionOrdersSchema.parse(orders)),
      },
      {
        key: CLIENT_DRAFTS_STORAGE_KEY,
        serializedValue: JSON.stringify(clientDraftsSchema.parse(clients)),
      },
    ]);
    return true;
  } catch {
    return false;
  }
}
