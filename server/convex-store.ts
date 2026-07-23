// Convex-backed store. Talks to the deployed `convex/records.ts` functions
// over HTTP, so the same code path works in Vite dev middleware and in the
// Vercel serverless functions.

import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type {
  InsertInput,
  RecordStore,
  SheetName,
  StoredRecord,
} from './store-types';

// Referenced by name rather than through convex/_generated/api so this file
// typechecks and builds before `npx convex dev` has run codegen.
const fn = {
  listBySheet: makeFunctionReference<'query'>('records:listBySheet'),
  getById: makeFunctionReference<'query'>('records:getById'),
  insert: makeFunctionReference<'mutation'>('records:insert'),
  patch: makeFunctionReference<'mutation'>('records:patch'),
  remove: makeFunctionReference<'mutation'>('records:remove'),
};

interface ConvexDoc {
  _id: string;
  sheet: SheetName;
  assignedTo: string | null;
  createdBy: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Convex exposes `_id`; the rest of the app expects `id`.
function toStored(doc: ConvexDoc): StoredRecord {
  return {
    id: doc._id,
    sheet: doc.sheet,
    assignedTo: doc.assignedTo ?? null,
    createdBy: doc.createdBy ?? null,
    data: doc.data ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function createConvexStore(url: string): RecordStore {
  const client = new ConvexHttpClient(url);

  return {
    async listBySheet(sheet: SheetName) {
      const docs = (await client.query(fn.listBySheet, { sheet })) as ConvexDoc[];
      return (docs ?? []).map(toStored);
    },

    async getById(id: string) {
      const doc = (await client.query(fn.getById, { id })) as ConvexDoc | null;
      return doc ? toStored(doc) : undefined;
    },

    async insert(input: InsertInput) {
      const doc = (await client.mutation(fn.insert, {
        sheet: input.sheet,
        data: input.data,
        createdBy: input.createdBy,
        assignedTo: input.assignedTo,
      })) as ConvexDoc;
      return toStored(doc);
    },

    async patch(id: string, data: Record<string, unknown>) {
      const doc = (await client.mutation(fn.patch, { id, data })) as ConvexDoc | null;
      return doc ? toStored(doc) : undefined;
    },

    async remove(id: string) {
      return (await client.mutation(fn.remove, { id })) as boolean;
    },
  };
}
