// Runtime-agnostic request handling. Consumed by both the Vite dev
// middleware (server/vite-plugin.ts) and the Vercel functions (api/*.ts),
// so dev and prod behave identically (TRD.md section 8).

import { schemaForSheet } from '@/schemas';
import {
  insert,
  isValidSheet,
  listBySheet,
  patch,
  remove,
  type SheetName,
} from './store';

export interface ApiRequest {
  method: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

const json = (status: number, body: unknown): ApiResponse => ({ status, body });

function toEntity(row: {
  id: string;
  assignedTo: string | null;
  createdBy: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}) {
  // Flatten the generic row into the entity shape the client expects.
  return {
    id: row.id,
    ...row.data,
    assignedTo: row.assignedTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function handleApi(req: ApiRequest): Promise<ApiResponse> {
  const { method, pathname } = req;
  const userName = req.headers['x-user-name'] || null;

  // GET /api/me — echoes identity, no validation (TRD.md section 4).
  if (pathname === '/api/me' && method === 'GET') {
    return json(200, { name: userName });
  }

  // ---- /api/records ------------------------------------------------------
  if (pathname === '/api/records') {
    if (method === 'GET') {
      const sheet = req.query.get('sheet') ?? '';
      if (!isValidSheet(sheet)) return json(400, { error: 'Unknown sheet' });
      const rows = await listBySheet(sheet);
      return json(200, { records: rows.map(toEntity) });
    }
    if (method === 'POST') {
      const body = (req.body ?? {}) as { sheet?: string; data?: unknown };
      if (!body.sheet || !isValidSheet(body.sheet))
        return json(400, { error: 'Unknown sheet' });
      const parsed = schemaForSheet[body.sheet as SheetName].safeParse(
        body.data,
      );
      if (!parsed.success)
        return json(422, { error: 'Validation failed', issues: parsed.error.issues });
      const data = parsed.data as Record<string, unknown>;
      const assignedTo =
        (data.assignedTo as string | null | undefined) ?? userName ?? null;
      const row = await insert({
        sheet: body.sheet as SheetName,
        data,
        createdBy: userName,
        assignedTo,
      });
      return json(201, { record: toEntity(row) });
    }
    return json(405, { error: 'Method not allowed' });
  }

  // PATCH/DELETE /api/records/:id
  const recordMatch = pathname.match(/^\/api\/records\/([^/]+)$/);
  if (recordMatch) {
    const id = recordMatch[1];
    if (method === 'PATCH') {
      const body = (req.body ?? {}) as { data?: Record<string, unknown> };
      const row = await patch(id, body.data ?? {});
      if (!row) return json(404, { error: 'Not found' });
      return json(200, { record: toEntity(row) });
    }
    if (method === 'DELETE') {
      const ok = await remove(id);
      if (!ok) return json(404, { error: 'Not found' });
      return json(200, { success: true });
    }
    return json(405, { error: 'Method not allowed' });
  }

  // ---- /api/bulk ---------------------------------------------------------
  if (pathname === '/api/bulk' && method === 'POST') {
    const body = (req.body ?? {}) as {
      sheet?: string;
      records?: Record<string, unknown>[];
    };
    if (!body.sheet || !isValidSheet(body.sheet))
      return json(400, { error: 'Unknown sheet' });
    const schema = schemaForSheet[body.sheet as SheetName];
    const created: unknown[] = [];
    const errors: { row: number; issues: unknown }[] = [];
    // Sequential rather than forEach: inserts are async once the store is
    // backed by Convex.
    const incoming = body.records ?? [];
    for (let i = 0; i < incoming.length; i++) {
      const parsed = schema.safeParse(incoming[i]);
      if (!parsed.success) {
        errors.push({ row: i, issues: parsed.error.issues });
        continue;
      }
      const data = parsed.data as Record<string, unknown>;
      const row = await insert({
        sheet: body.sheet as SheetName,
        data,
        createdBy: userName,
        assignedTo: (data.assignedTo as string | null) ?? userName ?? null,
      });
      created.push(toEntity(row));
    }
    return json(200, { created: created.length, errors });
  }

  return json(404, { error: 'Not found' });
}
