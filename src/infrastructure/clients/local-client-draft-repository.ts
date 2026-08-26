import { clientDraftsSchema, type ClientDraft } from '../../domain/clients/client';
import {
  readStoredDocument,
  writeStoredDocument,
} from '../persistence/document-storage';

export const CLIENT_DRAFTS_STORAGE_KEY = 'ambro-studio:client-drafts:v1';

export function parseStoredClientDrafts(serializedDrafts: string | null) {
  if (!serializedDrafts) return [];

  try {
    const parsed = clientDraftsSchema.safeParse(JSON.parse(serializedDrafts));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function loadClientDrafts() {
  return parseStoredClientDrafts(readStoredDocument(CLIENT_DRAFTS_STORAGE_KEY));
}

export function persistClientDrafts(clients: ClientDraft[]) {
  try {
    writeStoredDocument(
      CLIENT_DRAFTS_STORAGE_KEY,
      JSON.stringify(clientDraftsSchema.parse(clients)),
    );
  } catch {
    // O modo de demonstração continua disponível mesmo sem armazenamento local.
  }
}
