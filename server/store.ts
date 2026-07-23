// Records store. Picks its backend from the environment:
//   CONVEX_URL set  -> Convex deployment (see convex/records.ts)
//   otherwise       -> local JSON file at server/data/records.json
// The RecordStore interface is identical either way, so handlers.ts and every
// caller above it are unaffected by the choice.

import { createConvexStore } from './convex-store';
import { fileStore } from './file-store';
import type { InsertInput, RecordStore, SheetName } from './store-types';

export type { SheetName, StoredRecord, InsertInput } from './store-types';
export { SHEET_ALLOWLIST, isValidSheet } from './store-types';

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? '';

let store: RecordStore | null = null;

function backend(): RecordStore {
  if (store) return store;
  store = CONVEX_URL ? createConvexStore(CONVEX_URL) : fileStore;
  return store;
}

export const usingConvex = Boolean(CONVEX_URL);

export const listBySheet = (sheet: SheetName) => backend().listBySheet(sheet);
export const getById = (id: string) => backend().getById(id);
export const insert = (input: InsertInput) => backend().insert(input);
export const patch = (id: string, data: Record<string, unknown>) =>
  backend().patch(id, data);
export const remove = (id: string) => backend().remove(id);
