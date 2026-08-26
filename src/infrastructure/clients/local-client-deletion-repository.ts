import {
  clientDraftsSchema,
  type ClientDraft,
} from '../../domain/clients/client';
import {
  productionOrdersSchema,
  type ProductionOrder,
} from '../../domain/production/production-order';
import { writeStoredDocumentsAndRemoveAttachments } from '../persistence/document-storage';
import { PRODUCTION_DRAFTS_STORAGE_KEY } from '../production/local-production-draft-repository';
import { CLIENT_DRAFTS_STORAGE_KEY } from './local-client-draft-repository';

export function persistClientDeletion(
  clients: ClientDraft[],
  productionOrders: ProductionOrder[],
  attachmentIds: string[],
) {
  writeStoredDocumentsAndRemoveAttachments(
    [
      {
        key: CLIENT_DRAFTS_STORAGE_KEY,
        serializedValue: JSON.stringify(clientDraftsSchema.parse(clients)),
      },
      {
        key: PRODUCTION_DRAFTS_STORAGE_KEY,
        serializedValue: JSON.stringify(
          productionOrdersSchema.parse(productionOrders),
        ),
      },
    ],
    attachmentIds,
  );
}
