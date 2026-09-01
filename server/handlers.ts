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
import {
  LOG_CATEGORIES,
  LOG_STATUSES,
  carryForwardSchema,
  checkinSchema,
  completeLogSchema,
  dailyLogSchema,
  dailyLogUpdateSchema,
} from '../src/schemas/dailyLogs.js';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { istToday, isIsoDate, shiftDate } from '../src/lib/ist.js';
import {
  DailyError,
  carryForward,
  completeLog,
  createLog,
  deleteLog,
  getDayStats,
  // Aliased for clarity: this file routes three modules.
  getSummary as getDailySummary,
  listCheckins,
  listLogs,
  listUsers,
  syncUsersFromSettings,
  updateLog,
  upsertCheckin,
} from './daily-logs.js';
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

/** Postgres undefined_table — the module's migration has not been run. */
const UNDEFINED_TABLE = '42P01';

/**
 * Last-resort handler for a module backed by its own tables.
 *
 * A missing table is a deployment step that has not been done, not a bug, and
 * naming it is the difference between "Something went wrong" and knowing which
 * file to run. This follows the reasoning already written into
 * api/[...path].ts: the failures this internal tool actually hits are
 * configuration ones, and a generic string leaves whoever is on call with
 * nothing to act on.
 *
 * Everything else stays opaque on purpose — a raw Postgres error names tables,
 * columns and constraints, which is nothing the client should see.
 */
function moduleFailure(err: unknown, label: string, migration: string): ApiResponse {
  if ((err as { code?: string }).code === UNDEFINED_TABLE) {
    // eslint-disable-next-line no-console
    console.error(`[${label}] missing tables — run ${migration}`, err);
    return json(503, {
      error: `The ${label} tables have not been created yet. Run ${migration} against the database, then reload.`,
    });
  }
  // eslint-disable-next-line no-console
  console.error(`[${label}] error`, err);
  return json(500, { error: 'Something went wrong handling that request' });
}

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

  // ---- /api/events, /api/participants ------------------------------------
  // Same access position as everything above: unauthenticated, because the app
  // has no identity to scope by — every route in this file is unauthenticated.
  if (pathname.startsWith('/api/events') || pathname.startsWith('/api/participants')) {
    return handleEvents(req);
  }

  // ---- /api/daily-logs, /api/daily-checkins, /api/users ------------------
  // ACCESS CONTROL: the brief asks for "a user edits only their own entries,
  // admins edit anyone's". That cannot be enforced here — the app has no
  // session, so there is no caller to compare an entry's owner against, and a
  // client-supplied identity would be trivially forgeable. `users.role` is
  // stored and the ownership rule is applied in the UI only. Enforcing it for
  // real needs the authentication described in the README.
  if (
    pathname.startsWith('/api/daily-logs') ||
    pathname.startsWith('/api/daily-checkins') ||
    pathname.startsWith('/api/users')
  ) {
    return handleDailyLogs(req);
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
 * Structured like handleEvents above: this function owns the routing and
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
    return moduleFailure(err, 'Workshops & Events', 'db/events.sql');
  }
}

// ---- Daily Work Log --------------------------------------------------------

/** CSV columns for the range export. */
const DAILY_CSV_COLUMNS = [
  'log_date',
  'member',
  'title',
  'category',
  'status',
  'priority',
  'output',
  'output_link',
  'time_spent_mins',
  'blocker_note',
  'description',
] as const;

/**
 * snake_case to camelCase on request bodies.
 *
 * The brief documents these bodies in snake_case (`output_link`, `from_date`)
 * while the schemas and the rest of the app speak camelCase. Normalising here
 * means both spellings work and neither side has to bend.
 */
function camelBody(body: unknown): Record<string, unknown> {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

/** Reads a date query parameter, 400-ing on a malformed one rather than ignoring it. */
function dateParam(
  query: URLSearchParams,
  name: string,
): { value: string | null } | { error: string } {
  const raw = query.get(name);
  if (raw === null || raw === '') return { value: null };
  if (!isIsoDate(raw)) return { error: `${name} must be a YYYY-MM-DD date` };
  return { value: raw };
}

/**
 * Routes every Daily Work Log request. Structured like handleEvents above: this
 * function owns routing and validation, server/daily-logs.ts owns the SQL.
 */
async function handleDailyLogs(req: ApiRequest): Promise<ApiResponse> {
  if (!hasSql) return json(503, { error: NO_SQL_MESSAGE });
  const { method, pathname, query } = req;

  try {
    // ---- /api/users --------------------------------------------------------
    if (pathname === '/api/users') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      return json(200, {
        users: await listUsers(query.get('includeInactive') === 'true'),
      });
    }

    // Pulls in anyone added to the Settings roster since the last sync. Kept a
    // POST rather than folded into GET /api/users so a read never writes.
    if (pathname === '/api/users/sync') {
      if (method !== 'POST') return json(405, { error: 'Method not allowed' });
      const added = await syncUsersFromSettings();
      return json(200, { added, users: await listUsers() });
    }

    // ---- /api/daily-checkins ----------------------------------------------
    if (pathname === '/api/daily-checkins') {
      if (method === 'GET') {
        const date = dateParam(query, 'date');
        if ('error' in date) return json(400, { error: date.error });
        return json(200, {
          checkins: await listCheckins(
            date.value ?? istToday(),
            query.get('user_id') ?? query.get('userId'),
          ),
        });
      }
      if (method === 'POST') {
        const parsed = checkinSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        return json(200, { checkin: await upsertCheckin(parsed.data) });
      }
      return json(405, { error: 'Method not allowed' });
    }

    // ---- /api/daily-logs/summary ------------------------------------------
    // Matched before the /:id routes, which would otherwise read "summary",
    // "export" and "carry-forward" as ids.
    if (pathname === '/api/daily-logs/summary') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      const range = readRange(query);
      if ('error' in range) return json(400, { error: range.error });
      return json(200, {
        from: range.from,
        to: range.to,
        ...(await getDailySummary(range.from, range.to)),
      });
    }

    // ---- /api/daily-logs/export -------------------------------------------
    if (pathname === '/api/daily-logs/export') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      const range = readRange(query);
      if ('error' in range) return json(400, { error: range.error });

      const logs = await listLogs({ from: range.from, to: range.to });
      const rows = logs.map((l) => ({
        log_date: l.logDate,
        member: l.userName,
        title: l.title,
        category: l.category,
        status: l.status,
        priority: l.priority ?? '',
        output: l.output ?? '',
        output_link: l.outputLink ?? '',
        time_spent_mins: l.timeSpentMins ?? '',
        blocker_note: l.blockerNote ?? '',
        description: l.description ?? '',
      }));
      // Leading BOM so Excel on Windows reads it as UTF-8, matching the other
      // exports in the app.
      const csv = '﻿' + toCsv(rows, [...DAILY_CSV_COLUMNS]);
      return {
        status: 200,
        binary: true,
        body: new TextEncoder().encode(csv),
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="daily-log-${range.from}_to_${range.to}.csv"`,
          'Cache-Control': 'no-store',
        },
      };
    }

    // ---- /api/daily-logs/carry-forward ------------------------------------
    if (pathname === '/api/daily-logs/carry-forward') {
      if (method !== 'POST') return json(405, { error: 'Method not allowed' });
      const parsed = carryForwardSchema.safeParse(camelBody(req.body));
      if (!parsed.success)
        return json(422, { error: 'Validation failed', issues: parsed.error.issues });
      const { fromDate, toDate, userId } = parsed.data;
      return json(200, { created: await carryForward(fromDate, toDate, userId) });
    }

    // ---- /api/daily-logs ---------------------------------------------------
    if (pathname === '/api/daily-logs') {
      if (method === 'GET') {
        const date = dateParam(query, 'date');
        if ('error' in date) return json(400, { error: date.error });
        const from = dateParam(query, 'from');
        if ('error' in from) return json(400, { error: from.error });
        const to = dateParam(query, 'to');
        if ('error' in to) return json(400, { error: to.error });

        const status = query.get('status');
        if (status && !(LOG_STATUSES as readonly string[]).includes(status))
          return json(400, { error: `status must be one of ${LOG_STATUSES.join(', ')}` });
        const category = query.get('category');
        if (category && !(LOG_CATEGORIES as readonly string[]).includes(category))
          return json(400, {
            error: `category must be one of ${LOG_CATEGORIES.join(', ')}`,
          });

        // With neither a date nor a range, the Team Day view's default: today
        // in IST, never the server's UTC day.
        const singleDate =
          date.value ?? (from.value || to.value ? null : istToday());

        const logs = await listLogs({
          date: singleDate,
          from: from.value,
          to: to.value,
          userId: query.get('user_id') ?? query.get('userId'),
          status,
          category,
        });

        // Day headline numbers only make sense for a single day.
        return json(200, {
          date: singleDate,
          logs,
          stats: singleDate ? await getDayStats(singleDate) : null,
        });
      }

      if (method === 'POST') {
        const parsed = dailyLogSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        return json(201, { log: await createLog(parsed.data) });
      }
      return json(405, { error: 'Method not allowed' });
    }

    // ---- /api/daily-logs/:id[/complete] ------------------------------------
    const logMatch = pathname.match(/^\/api\/daily-logs\/([^/]+)(?:\/(complete))?$/);
    if (logMatch) {
      const [, id, sub] = logMatch;

      if (sub === 'complete') {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        const parsed = completeLogSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        const log = await completeLog(id, parsed.data);
        if (!log) return json(404, { error: 'Not found' });
        return json(200, { log });
      }

      if (method === 'PATCH') {
        const parsed = dailyLogUpdateSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        const log = await updateLog(id, parsed.data);
        if (!log) return json(404, { error: 'Not found' });
        return json(200, { log });
      }
      if (method === 'DELETE') {
        const ok = await deleteLog(id);
        if (!ok) return json(404, { error: 'Not found' });
        return json(200, { success: true });
      }
      return json(405, { error: 'Method not allowed' });
    }

    return json(404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof DailyError) return json(err.status, { error: err.message });
    return moduleFailure(err, 'Daily Work Log', 'db/daily-logs.sql');
  }
}

/**
 * The from/to pair shared by the summary and export routes.
 *
 * Defaults to the last 7 IST days inclusive, so an unparameterised call answers
 * something useful rather than everything ever logged.
 */
function readRange(
  query: URLSearchParams,
): { from: string; to: string } | { error: string } {
  const to = query.get('to');
  const from = query.get('from');
  if (to && !isIsoDate(to)) return { error: 'to must be a YYYY-MM-DD date' };
  if (from && !isIsoDate(from)) return { error: 'from must be a YYYY-MM-DD date' };

  const end = to ?? istToday();
  const start = from ?? shiftDate(end, -6);
  if (start > end)
    return { error: 'from must be the same day as, or before, to' };
  return { from: start, to: end };
}
