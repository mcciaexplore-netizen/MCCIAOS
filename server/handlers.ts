// Runtime-agnostic request handling. Consumed by both the Vite dev
// middleware (server/vite-plugin.ts) and the Vercel functions (api/*.ts),
// so dev and prod behave identically (TRD.md section 8).

import { importSchemaForSheet, schemaForSheet } from '../src/schemas/index.js';
import {
  EVENT_TYPES,
  eventSchema,
  eventUpdateSchema,
  participantImportSchema,
  participantSchema,
  participantUpdateSchema,
} from '../src/schemas/events.js';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import {
  DIMENSIONS,
  GRANULARITIES,
  METRICS,
  PERIODS,
  getActivity,
  getBreakdown,
  getCapacity,
  getSummary,
  getTimeseries,
} from './analytics.js';
import {
  EventError,
  addParticipant,
  createEvent,
  deleteEvent,
  deleteParticipant,
  getEvent,
  importParticipants,
  listEvents,
  listParticipants,
  nextCode,
  setAllAttendance,
  updateEvent,
  updateParticipant,
  type ParticipantWriteInput,
} from './events.js';
import { buildReport } from './reports.js';
import { NO_SQL_MESSAGE, hasSql } from './sql.js';
import {
  describeStore,
  insert,
  isValidSheet,
  listBySheet,
  patch,
  remove,
  removeBySheet,
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
    if (method === 'DELETE') {
      // Bulk wipe of one sheet, behind the Settings "Danger zone". The
      // Settings sheet itself stays out of reach — wiping it would destroy
      // every configured vocabulary rather than any module's records.
      const sheet = req.query.get('sheet') ?? '';
      if (!isValidSheet(sheet)) return json(400, { error: 'Unknown sheet' });
      if (sheet === 'Settings')
        return json(400, { error: 'The Settings sheet cannot be bulk-deleted' });
      const deleted = await removeBySheet(sheet);
      return json(200, { deleted });
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

  // ---- /api/events, /api/participants ------------------------------------
  // Same access position as everything above: unauthenticated, because the app
  // has no identity to scope by (see the note on /api/analytics).
  if (pathname.startsWith('/api/events') || pathname.startsWith('/api/participants')) {
    return handleEvents(req);
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
      case '/api/analytics/capacity':
        return json(200, { rows: await getCapacity(periodInput) });

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

// ---- Workshops & Events ----------------------------------------------------

/** CSV columns for the participant import template and the export file. */
export const PARTICIPANT_CSV_COLUMNS = [
  'name',
  'company',
  'designation',
  'email',
  'phone',
  'isMember',
  'attended',
] as const;

/**
 * Accepted spellings for each import column. Spreadsheets that people actually
 * keep say "Organisation" or "Mobile", and rejecting those would mean asking
 * the team to rewrite a header row by hand before every upload.
 */
const CSV_HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  fullname: 'name',
  participant: 'name',
  participantname: 'name',
  company: 'company',
  organisation: 'company',
  organization: 'company',
  firm: 'company',
  designation: 'designation',
  role: 'designation',
  jobtitle: 'designation',
  email: 'email',
  emailaddress: 'email',
  mail: 'email',
  phone: 'phone',
  mobile: 'phone',
  contact: 'phone',
  phonenumber: 'phone',
  ismember: 'isMember',
  member: 'isMember',
  mcciamember: 'isMember',
  attended: 'attended',
  attendance: 'attended',
  present: 'attended',
};

const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'attended', 'present', 'member']);
const truthy = (v: unknown) => TRUTHY.has(String(v ?? '').trim().toLowerCase());

/** Maps one raw CSV row onto the participant field names. */
function mapCsvRow(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = CSV_HEADER_ALIASES[normaliseHeader(key)];
    if (!field) continue;
    out[field] = field === 'isMember' || field === 'attended' ? truthy(value) : value.trim();
  }
  return out;
}

/**
 * Routes every /api/events and /api/participants request.
 *
 * Structured like handleAnalytics above: this function owns the routing and
 * validation, server/events.ts owns the SQL. Unexpected failures are logged
 * and answered with a fixed message — a raw Postgres error names columns and
 * constraints, which is nothing the client should see.
 */
async function handleEvents(req: ApiRequest): Promise<ApiResponse> {
  if (!hasSql) return json(503, { error: NO_SQL_MESSAGE });
  const { method, pathname } = req;

  try {
    // GET /api/events/next-code?type=WORKSHOP — the form's code preview.
    // Matched before the /:id routes, which would otherwise read "next-code"
    // as an id.
    if (pathname === '/api/events/next-code') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      const type = pickEnum(req.query.get('type'), EVENT_TYPES, 'WORKSHOP');
      if (!type) {
        return json(400, { error: `type must be one of ${EVENT_TYPES.join(', ')}` });
      }
      return json(200, { code: await nextCode(type) });
    }

    // ---- /api/events -------------------------------------------------------
    if (pathname === '/api/events') {
      if (method === 'GET') {
        const q = req.query;
        const bad = (name: string, allowed: readonly string[]) =>
          json(400, { error: `${name} must be one of ${allowed.join(', ')}` });

        // Absent means "no filter"; present but unrecognised is a mistake worth
        // reporting rather than silently ignoring.
        const type = q.get('type');
        if (type && !(EVENT_TYPES as readonly string[]).includes(type))
          return bad('type', EVENT_TYPES);
        const mode = q.get('mode');
        if (mode && !['ONLINE', 'OFFLINE', 'HYBRID'].includes(mode))
          return bad('mode', ['ONLINE', 'OFFLINE', 'HYBRID']);
        const status = q.get('status');
        if (status && !['UPCOMING', 'COMPLETED', 'CANCELLED'].includes(status))
          return bad('status', ['UPCOMING', 'COMPLETED', 'CANCELLED']);

        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        for (const key of ['from', 'to']) {
          const v = q.get(key);
          if (v && !DATE_RE.test(v))
            return json(400, { error: `${key} must be a YYYY-MM-DD date` });
        }

        return json(
          200,
          await listEvents({
            type,
            mode,
            status,
            topic: q.get('topic'),
            from: q.get('from'),
            to: q.get('to'),
            search: q.get('search'),
            sort: q.get('sort'),
            dir: q.get('dir'),
          }),
        );
      }

      if (method === 'POST') {
        const parsed = eventSchema.safeParse(req.body ?? {});
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        return json(201, { event: await createEvent(parsed.data) });
      }
      return json(405, { error: 'Method not allowed' });
    }

    // ---- /api/events/:id[/participants[/import|/export|/attendance]] -------
    const eventMatch = pathname.match(
      /^\/api\/events\/([^/]+)(?:\/participants(?:\/(import|export|attendance))?)?$/,
    );
    if (eventMatch) {
      const [, id, sub] = eventMatch;
      const isParticipants = pathname.includes('/participants');

      if (!isParticipants) {
        if (method === 'GET') {
          const event = await getEvent(id);
          if (!event) return json(404, { error: 'Not found' });
          return json(200, { event, participants: await listParticipants(id) });
        }
        if (method === 'PATCH') {
          const parsed = eventUpdateSchema.safeParse(req.body ?? {});
          if (!parsed.success)
            return json(422, { error: 'Validation failed', issues: parsed.error.issues });
          const event = await updateEvent(id, parsed.data);
          if (!event) return json(404, { error: 'Not found' });
          return json(200, { event });
        }
        if (method === 'DELETE') {
          // Participants go with it, via ON DELETE CASCADE.
          const ok = await deleteEvent(id);
          if (!ok) return json(404, { error: 'Not found' });
          return json(200, { success: true });
        }
        return json(405, { error: 'Method not allowed' });
      }

      if (sub === 'export') {
        if (method !== 'GET') return json(405, { error: 'Method not allowed' });
        const event = await getEvent(id);
        if (!event) return json(404, { error: 'Not found' });
        const rows = (await listParticipants(id)).map((p) => ({
          name: p.name,
          company: p.company ?? '',
          designation: p.designation ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
          isMember: p.isMember ? 'yes' : 'no',
          attended: p.attended ? 'yes' : 'no',
        }));
        // Leading BOM so Excel on Windows reads it as UTF-8 rather than the
        // system codepage, matching src/lib/spreadsheet.ts.
        const csv = '﻿' + toCsv(rows, [...PARTICIPANT_CSV_COLUMNS]);
        return {
          status: 200,
          binary: true,
          body: new TextEncoder().encode(csv),
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${event.code}-participants.csv"`,
            'Cache-Control': 'no-store',
          },
        };
      }

      if (sub === 'import') {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        const body = (req.body ?? {}) as { csv?: string; rows?: unknown[] };

        // Either raw CSV text or already-parsed rows. The UI sends the file
        // contents; the rows form exists so the endpoint is usable directly.
        const raw: Record<string, unknown>[] =
          typeof body.csv === 'string'
            ? parseCsv(body.csv).map(mapCsvRow)
            : Array.isArray(body.rows)
              ? (body.rows as Record<string, unknown>[])
              : [];

        if (raw.length === 0)
          return json(422, { error: 'No rows found in that file' });

        const valid: ParticipantWriteInput[] = [];
        const errors: { row: number; message: string }[] = [];
        raw.forEach((row, i) => {
          const parsed = participantImportSchema.safeParse(row);
          if (parsed.success) valid.push(parsed.data);
          // +2 puts the number back in spreadsheet terms: row 1 is the header.
          else errors.push({ row: i + 2, message: parsed.error.issues[0]?.message ?? 'Invalid row' });
        });

        const created = await importParticipants(id, valid);
        return json(200, { created, skipped: errors.length, errors });
      }

      if (sub === 'attendance') {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        const body = (req.body ?? {}) as { attended?: unknown };
        const attended = body.attended !== false;
        const event = await getEvent(id);
        if (!event) return json(404, { error: 'Not found' });
        return json(200, { updated: await setAllAttendance(id, attended) });
      }

      // /api/events/:id/participants
      if (method === 'GET') {
        const event = await getEvent(id);
        if (!event) return json(404, { error: 'Not found' });
        return json(200, { participants: await listParticipants(id) });
      }
      if (method === 'POST') {
        const parsed = participantSchema.safeParse(req.body ?? {});
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        const participant = await addParticipant(id, parsed.data);
        if (!participant) return json(404, { error: 'Not found' });
        return json(201, { participant });
      }
      return json(405, { error: 'Method not allowed' });
    }

    // ---- /api/participants/:id --------------------------------------------
    const participantMatch = pathname.match(/^\/api\/participants\/([^/]+)$/);
    if (participantMatch) {
      const id = participantMatch[1];
      if (method === 'PATCH') {
        const parsed = participantUpdateSchema.safeParse(req.body ?? {});
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        const participant = await updateParticipant(id, parsed.data);
        if (!participant) return json(404, { error: 'Not found' });
        return json(200, { participant });
      }
      if (method === 'DELETE') {
        const ok = await deleteParticipant(id);
        if (!ok) return json(404, { error: 'Not found' });
        return json(200, { success: true });
      }
      return json(405, { error: 'Method not allowed' });
    }

    return json(404, { error: 'Not found' });
  } catch (err) {
    // EventError is a fault the caller can fix and carries its own status.
    if (err instanceof EventError) return json(err.status, { error: err.message });
    // Anything else is ours. Log the detail, return none of it — a Postgres
    // error message names tables, columns and constraints.
    // eslint-disable-next-line no-console
    console.error('[events] error', err);
    return json(500, { error: 'Something went wrong handling that request' });
  }
}
