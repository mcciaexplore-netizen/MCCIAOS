// Raw SQL access for the analytics module.
//
// The RecordStore contract (server/store-types.ts) deliberately exposes only
// per-record CRUD, which is all the rest of the app needs. Analytics has to
// aggregate in the database rather than pulling rows into JS, so it needs the
// query interface directly — and therefore only works on the Postgres backend.
// The JSON file store has no query engine; counting there would mean loading
// every row into memory, which is exactly what this module exists to avoid.

import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL?.trim();

export const hasSql = Boolean(
  connectionString && /^postgres(ql)?:\/\//.test(connectionString),
);

export const sql = hasSql ? neon(connectionString as string) : null;

export const NO_SQL_MESSAGE =
  'Analytics requires the Postgres backend. Set DATABASE_URL — the local ' +
  'file store cannot run aggregate queries.';

/** Narrowing helper so callers get a non-null client or a clear failure. */
export function requireSql(): NonNullable<typeof sql> {
  if (!sql) throw new Error(NO_SQL_MESSAGE);
  return sql;
}
