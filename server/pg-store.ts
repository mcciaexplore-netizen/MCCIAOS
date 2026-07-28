// Neon Postgres store. Selected from server/store.ts when DATABASE_URL is set.
//
// Uses the Neon HTTP driver so the same module works in both runtimes the API
// runs under: the Vite dev middleware (Node) and the Vercel function.
// Table shape is defined in db/migrations.sql.

import { neon } from '@neondatabase/serverless';
import type {
  InsertInput,
  RecordStore,
  SheetName,
  StoredRecord,
} from './store-types.js';

// snake_case columns in Postgres, camelCase in the app.
interface Row {
  id: string;
  sheet: string;
  assigned_to: string | null;
  created_by: string | null;
  data: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

const iso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);

// Postgres throws on a malformed uuid literal, which would surface as a 500.
// The file store simply finds nothing, so guard here to keep both backends
// returning "not found" for an id that could never exist.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecord(row: Row): StoredRecord {
  return {
    id: row.id,
    sheet: row.sheet as SheetName,
    assignedTo: row.assigned_to,
    createdBy: row.created_by,
    data: row.data ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function createPgStore(connectionString: string): RecordStore {
  const sql = neon(connectionString);

  return {
    async listBySheet(sheet: SheetName) {
      const rows = (await sql`
        select * from records where sheet = ${sheet}
        order by created_at desc
      `) as Row[];
      return rows.map(toRecord);
    },

    async getById(id: string) {
      if (!UUID_RE.test(id)) return undefined;
      const rows = (await sql`
        select * from records where id = ${id}::uuid
      `) as Row[];
      return rows[0] ? toRecord(rows[0]) : undefined;
    },

    async insert(input: InsertInput) {
      const rows = (await sql`
        insert into records (sheet, assigned_to, created_by, data)
        values (
          ${input.sheet},
          ${input.assignedTo},
          ${input.createdBy},
          ${JSON.stringify(input.data)}::jsonb
        )
        returning *
      `) as Row[];
      return toRecord(rows[0]);
    },

    async patch(id: string, data: Record<string, unknown>) {
      if (!UUID_RE.test(id)) return undefined;
      // Shallow merge, matching the file store: `data || patch` overwrites
      // top-level keys and leaves untouched keys intact. assignedTo is
      // promoted to its own column only when the caller actually sent it.
      const setsAssignee = Object.prototype.hasOwnProperty.call(
        data,
        'assignedTo',
      );
      const assignee = setsAssignee
        ? ((data.assignedTo as string | null) ?? null)
        : null;

      const rows = (await sql`
        update records set
          data        = data || ${JSON.stringify(data)}::jsonb,
          assigned_to = case when ${setsAssignee} then ${assignee} else assigned_to end,
          updated_at  = now()
        where id = ${id}::uuid
        returning *
      `) as Row[];
      return rows[0] ? toRecord(rows[0]) : undefined;
    },

    async remove(id: string) {
      if (!UUID_RE.test(id)) return false;
      const rows = (await sql`
        delete from records where id = ${id}::uuid returning id
      `) as Row[];
      return rows.length > 0;
    },
  };
}
