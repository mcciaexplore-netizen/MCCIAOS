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

// Vercel and Lambda both expose a read-only filesystem outside /tmp, so the
// JSON file store cannot work there — it throws EROFS on the first mkdir,
// which surfaces as an opaque 500 on every page. Detect the platform so the
// cause can be named instead of guessed at.
const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

/** What the store is doing right now, for /api/health. Never includes secrets. */
export function describeStore(): {
  store: 'postgres' | 'file' | 'unconfigured';
  databaseUrlSet: boolean;
  host?: string;
  serverless: boolean;
} {
  if (!connectionString) {
    return {
      store: isServerless ? 'unconfigured' : 'file',
      databaseUrlSet: false,
      serverless: isServerless,
    };
  }
  let host: string | undefined;
  try {
    host = new URL(connectionString).host;
  } catch {
    host = undefined;
  }
  return { store: 'postgres', databaseUrlSet: true, host, serverless: isServerless };
}

const MISSING_URL_MESSAGE =
  'DATABASE_URL is not set on this deployment. Add it in your hosting ' +
  "provider's environment variables and redeploy — the local file store " +
  'cannot be used here because the filesystem is read-only.';

/** Stand-in store whose every call explains the misconfiguration. */
function unconfiguredStore(): RecordStore {
  const fail = async (): Promise<never> => {
    throw new Error(MISSING_URL_MESSAGE);
  };
  return {
    listBySheet: fail,
    getById: fail,
    insert: fail,
    patch: fail,
    remove: fail,
    removeBySheet: fail,
  };
}

function selectBackend(): RecordStore {
  if (!connectionString) {
    if (isServerless) {
      // eslint-disable-next-line no-console
      console.error(`[store] ${MISSING_URL_MESSAGE}`);
      return unconfiguredStore();
    }
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
export const removeBySheet = (sheet: SheetName) => backend.removeBySheet(sheet);
