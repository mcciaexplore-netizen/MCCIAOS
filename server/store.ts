// Records store. Backed by Neon Postgres when DATABASE_URL is set, otherwise
// by a local JSON file at server/data/records.json so the app still runs with
// zero setup.
//
// Both backends implement RecordStore (server/store-types.ts), so
// server/handlers.ts never knows which one is active. The Postgres table shape
// is defined in db/migrations.sql.

import { fileStore } from './file-store.js';
import { createPgStore } from './pg-store.js';
import type { InsertInput, RecordStore, SheetName } from './store-types.js';

export type { SheetName, StoredRecord, InsertInput } from './store-types.js';
export { SHEET_ALLOWLIST, isValidSheet } from './store-types.js';

const connectionString = process.env.DATABASE_URL?.trim();

function selectBackend(): RecordStore {
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.info(
      '[store] DATABASE_URL not set — using the local file store ' +
        '(server/data/records.json). Data will not be shared between machines.',
    );
    return fileStore;
  }

  if (!/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error(
      'DATABASE_URL must be a postgres:// or postgresql:// connection string. ' +
        `Got "${connectionString.slice(0, 12)}...". ` +
        'Unset it to fall back to the local file store.',
    );
  }

  // eslint-disable-next-line no-console
  console.info(`[store] using Neon Postgres (${new URL(connectionString).host})`);
  return createPgStore(connectionString);
}

const backend: RecordStore = selectBackend();

export const listBySheet = (sheet: SheetName) => backend.listBySheet(sheet);
export const getById = (id: string) => backend.getById(id);
export const insert = (input: InsertInput) => backend.insert(input);
export const patch = (id: string, data: Record<string, unknown>) =>
  backend.patch(id, data);
export const remove = (id: string) => backend.remove(id);
