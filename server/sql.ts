// Raw SQL access for the modules backed by their own tables.
//
// The RecordStore contract (server/store-types.ts) deliberately exposes only
// per-record CRUD over the generic `records` sheet. Workshops & Events and the
// Daily Work Log have real relational schemas — foreign keys, CHECK
// constraints, aggregate counts — so they need the query interface directly,
// and therefore only work on the Postgres backend. The JSON file store has no
// query engine.
//
// This originally existed for the Analytics module, which has since been
// removed; the two current callers inherited it unchanged.

import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL?.trim();

export const hasSql = Boolean(
  connectionString && /^postgres(ql)?:\/\//.test(connectionString),
);

export const sql = hasSql ? neon(connectionString as string) : null;

export const NO_SQL_MESSAGE =
  'This module requires the Postgres backend. Set DATABASE_URL — the local ' +
  'file store cannot run the queries it needs.';

/** Narrowing helper so callers get a non-null client or a clear failure. */
export function requireSql(): NonNullable<typeof sql> {
  if (!sql) throw new Error(NO_SQL_MESSAGE);
  return sql;
}
