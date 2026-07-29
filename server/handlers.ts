// Runtime-agnostic request handling. Consumed by both the Vite dev
// middleware (server/vite-plugin.ts) and the Vercel functions (api/*.ts),
// so dev and prod behave identically (TRD.md section 8).

import { importSchemaForSheet, schemaForSheet } from '../src/schemas/index.js';
import {
  DIMENSIONS,
  GRANULARITIES,
  METRICS,
  PERIODS,
  getActivity,
  getBreakdown,
  getSummary,
  getTimeseries,
} from './analytics.js';
import { buildReport } from './reports.js';
import { NO_SQL_MESSAGE, hasSql } from './sql.js';
import {
  describeStore,
  insert,
  isValidSheet,
  listBySheet,
  patch,
  remove,
  type SheetName,
} from './store.js';

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
  /** Extra response headers, used by the export routes for Content-Disposition. */
  headers?: Record<string, string>;
  /**
   * When set, `body` is already-encoded bytes and must be written as-is.
   * Everything else in this file returns JSON, which both runtimes stringify;
   * a spreadsheet or PDF put through JSON.stringify would arrive corrupt.
   */
  binary?: boolean;
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

  // GET /api/health — is this deployment wired up correctly?
  // Every other route answers a failure with an opaque 500, which says nothing
  // about whether the database is unset, unreachable, or empty. This one
  // actually runs a read so the answer is real, and reports the host but never
  // the connection string.
  if (pathname === '/api/health' && method === 'GET') {
    const info = describeStore();
    try {
      const rows = await listBySheet('Settings');
      return json(200, {
        ok: true,
        ...info,
        dbReachable: true,
        settingsRecords: rows.length,
      });
    } catch (err) {
      return json(503, {
        ok: false,
        ...info,
        dbReachable: false,
        error: (err as Error).message,
      });
    }
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
    // Deliberately the lenient schema: a spreadsheet row with blanks still
    // imports, where the single-record POST above stays strict.
    const schema = importSchemaForSheet[body.sheet as SheetName];
    const created: unknown[] = [];
    const errors: { row: number; issues: unknown }[] = [];
    // Sequential rather than forEach: store inserts are async.
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

  // ---- /api/analytics ----------------------------------------------------
  // ACCESS CONTROL: this app has no authentication and no roles — identity is
  // whatever the client puts in x-user-name, and every route is already
  // unauthenticated (see /api/me above). There is therefore nothing to scope
  // results by, and these endpoints are exactly as open as /api/records
  // already is. Adding real auth is a separate piece of work; scoping
  // analytics alone would be security theatre while the raw records API
  // remains public.
  if (pathname.startsWith('/api/analytics/')) {
    if (method !== 'GET') return json(405, { error: 'Method not allowed' });
    return handleAnalytics(pathname, req.query);
  }

  return json(404, { error: 'Not found' });
}

/** Reads an enum query parameter, falling back when absent, 400 when invalid. */
function pickEnum<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T | null {
  if (!raw) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

async function handleAnalytics(
  pathname: string,
  query: URLSearchParams,
): Promise<ApiResponse> {
  if (!hasSql) return json(503, { error: NO_SQL_MESSAGE });

  const period = pickEnum(query.get('period'), PERIODS, 'month');
  if (!period) {
    return json(400, { error: `period must be one of ${PERIODS.join(', ')}` });
  }
  const periodInput = {
    period,
    from: query.get('from'),
    to: query.get('to'),
  };

  try {
    switch (pathname) {
      case '/api/analytics/summary':
        return json(200, await getSummary(periodInput));

      case '/api/analytics/timeseries': {
        const metric = pickEnum(query.get('metric'), METRICS, 'consultations');
        const granularity = pickEnum(query.get('granularity'), GRANULARITIES, 'day');
        if (!metric || !granularity) {
          return json(400, {
            error: `metric must be one of ${METRICS.join(', ')}; granularity one of ${GRANULARITIES.join(', ')}`,
          });
        }
        // Bucket counts follow the brief: 30 days, 12 weeks, 12 months.
        const buckets = granularity === 'day' ? 30 : 12;
        return json(200, {
          metric,
          granularity,
          points: await getTimeseries(metric, granularity, buckets),
        });
      }

      case '/api/analytics/breakdown': {
        const metric = pickEnum(query.get('metric'), METRICS, 'consultations');
        const dimension = pickEnum(query.get('dimension'), DIMENSIONS, 'status');
        if (!metric || !dimension) {
          return json(400, {
            error: `metric must be one of ${METRICS.join(', ')}; dimension one of ${DIMENSIONS.join(', ')}`,
          });
        }
        return json(200, {
          metric,
          dimension,
          rows: await getBreakdown(metric, dimension, periodInput),
        });
      }

      // Not in the original endpoint list, but the activity table on the page
      // needs its own paging and cannot ride along with the summary.
      case '/api/analytics/activity': {
        const limit = Math.min(Number(query.get('limit') ?? 20) || 20, 200);
        const offset = Math.max(Number(query.get('offset') ?? 0) || 0, 0);
        return json(200, await getActivity(periodInput, limit, offset));
      }

      case '/api/analytics/export': {
        const format = pickEnum(
          query.get('format'),
          ['csv', 'xlsx', 'pdf'] as const,
          'csv',
        );
        if (!format) return json(400, { error: 'format must be csv, xlsx or pdf' });
        const file = await buildReport(format, periodInput);
        return {
          status: 200,
          binary: true,
          body: file.bytes,
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': String(file.bytes.byteLength),
            'Cache-Control': 'no-store',
          },
        };
      }

      default:
        return json(404, { error: 'Not found' });
    }
  } catch (err) {
    // Bad custom ranges surface here as plain Errors; they are the caller's
    // fault, not a server fault, so answer 400 rather than letting the
    // outer handler turn them into a 500.
    const message = (err as Error).message || 'Analytics query failed';
    const isInput = /from|to|YYYY-MM-DD|custom period/i.test(message);
    return json(isInput ? 400 : 500, { error: message });
  }
}
