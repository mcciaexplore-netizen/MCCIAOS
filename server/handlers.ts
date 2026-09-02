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
  TASK_PRIORITIES,
  TASK_STATUSES,
  taskSchema,
  taskUpdateSchema,
  userSchema,
  userUpdateSchema,
} from '../src/schemas/workTracker.js';
import { parseCsv, toCsv } from '../src/lib/csv.js';
import { isIsoDate } from '../src/lib/ist.js';
import {
  TrackerError,
  approveTask,
  createTask,
  createUser,
  deactivateUser,
  deleteTask,
  restoreTask,
  getActivity,
  getAtRisk,
  getTabCounts,
  getTask,
  getToday,
  listTasks,
  listUsers,
  updateTask,
  updateUser,
} from './work-tracker.js';
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

/** The one admin passcode. Never sent to the client; only ever compared here. */
function adminPasscode(): string {
  return process.env.SETTINGS_PASSCODE?.trim() || 'mccia1934';
}

/**
 * Whether a request carries the admin passcode.
 *
 * Recorded work is frozen once it holds a value, and the freeze is enforced
 * here rather than by hiding controls on the page: a check that lives only in
 * the browser is a suggestion, and one PATCH sent from anywhere else would walk
 * straight past it.
 *
 * This is a permission check, not a login. Everyone shares one passcode, so all
 * it establishes is that whoever sent this knew it — never who they were.
 */
/** Task field names as they read in the refusal message. */
function FIELD_LABELS(field: string): string {
  const named: Record<string, string> = {
    userId: 'The person',
    title: 'The title',
    priority: 'The priority',
    status: 'The status',
    allocationDate: 'The allocation date',
    dueDate: 'The due date',
    deadlineDate: 'The deadline',
    reportTo: 'Reports to',
    approverId: 'The approver',
  };
  return named[field] ?? field;
}

function holdsPasscode(req: ApiRequest): boolean {
  const supplied = req.headers['x-settings-passcode'];
  return typeof supplied === 'string' && supplied === adminPasscode();
}

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

  // ---- /api/settings/unlock ---------------------------------------------
  // Gates the Settings *page*, nothing more. Every route in this file is
  // unauthenticated, so anyone can still read or write settings directly
  // through /api/records — this keeps the page out of casual reach, it is not
  // a security boundary. It is checked here rather than in the client so the
  // passcode is not sitting in the JavaScript bundle.
  if (pathname === '/api/settings/unlock') {
    if (method !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = (req.body ?? {}) as { passcode?: unknown };
    const supplied = typeof body.passcode === 'string' ? body.passcode : '';
    if (supplied !== adminPasscode()) {
      return json(401, { error: 'That passcode is not right' });
    }
    return json(200, { ok: true });
  }

  // ---- /api/tasks, /api/users, /api/summary, /api/today, /api/shared -----
  // ACCESS CONTROL: the module spec asks that only a task's approver may set
  // `approved`. There is no session, so "who is acting" arrives as the
  // `actor` parameter — the person selected in the header's Viewing block.
  // updateTask enforces the rule against it, which stops an accidental
  // approval but is NOT a security boundary: a caller can name anyone. Real
  // enforcement needs the authentication the README describes.
  if (
    pathname.startsWith('/api/tasks') ||
    pathname.startsWith('/api/users') ||
    pathname === '/api/summary' ||
    pathname === '/api/today' ||
    pathname === '/api/at-risk'
  ) {
    return handleWorkTracker(req);
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

// ---- Work Tracker ----------------------------------------------------------

/** snake_case to camelCase on request bodies, so both spellings work. */
function camelBody(body: unknown): Record<string, unknown> {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

/** The acting person, from ?actor= or the request body. Never trusted as auth. */
function actorOf(req: ApiRequest): string | null {
  const fromQuery = req.query.get('actor');
  if (fromQuery) return fromQuery;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = body.actor ?? body.actorId ?? body.actor_id;
  return typeof fromBody === 'string' ? fromBody : null;
}

/**
 * Routes every Work Tracker request. Structured like handleEvents above: this
 * function owns routing and validation, server/work-tracker.ts owns the SQL.
 */
async function handleWorkTracker(req: ApiRequest): Promise<ApiResponse> {
  if (!hasSql) return json(503, { error: NO_SQL_MESSAGE });
  const { method, pathname, query } = req;
  const actor = actorOf(req);

  try {
    // ---- /api/users --------------------------------------------------------
    if (pathname === '/api/users') {
      if (method === 'GET') {
        // Defaults to active only: these feed the dropdowns, and offering
        // somebody who has left is how stale assignments happen.
        return json(200, { users: await listUsers(query.get('active') !== 'false') });
      }
      if (method === 'POST') {
        const parsed = userSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        return json(201, { user: await createUser(parsed.data) });
      }
      return json(405, { error: 'Method not allowed' });
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)(?:\/(deactivate))?$/);
    if (userMatch) {
      const [, id, sub] = userMatch;

      if (sub === 'deactivate') {
        if (method !== 'PATCH') return json(405, { error: 'Method not allowed' });
        const user = await deactivateUser(id);
        if (!user) return json(404, { error: 'Not found' });
        return json(200, { user });
      }
      if (method === 'PATCH') {
        const parsed = userUpdateSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        const user = await updateUser(id, parsed.data);
        if (!user) return json(404, { error: 'Not found' });
        return json(200, { user });
      }
      // Deliberately no DELETE: removing somebody orphans every task,
      // reports_to link and approver reference they appear on.
      return json(405, {
        error: 'People are deactivated, not deleted, so their work survives.',
      });
    }

    // ---- /api/summary — every tab badge in one call ------------------------
    if (pathname === '/api/summary') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      return json(200, await getTabCounts(query.get('user')));
    }

    if (pathname === '/api/today') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      return json(200, await getToday(query.get('user')));
    }

    if (pathname === '/api/at-risk') {
      if (method !== 'GET') return json(405, { error: 'Method not allowed' });
      return json(200, { tasks: await getAtRisk(query.get('user')) });
    }

    // ---- /api/tasks --------------------------------------------------------
    if (pathname === '/api/tasks') {
      if (method === 'GET') {
        const status = query.get('status');
        if (status && !(TASK_STATUSES as readonly string[]).includes(status))
          return json(400, { error: `status must be one of ${TASK_STATUSES.join(', ')}` });
        const priority = query.get('priority');
        if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority))
          return json(400, {
            error: `priority must be one of ${TASK_PRIORITIES.join(', ')}`,
          });
        const tab = query.get('tab');
        const TABS = ['all', 'assigned_to_me', 'overdue'];
        if (tab && !TABS.includes(tab))
          return json(400, { error: `tab must be one of ${TABS.join(', ')}` });

        return json(200, {
          tasks: await listTasks({
            user: query.get('user'),
            status,
            priority,
            tab,
            sort: query.get('sort'),
            dir: query.get('dir'),
          }),
        });
      }

      if (method === 'POST') {
        const parsed = taskSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });
        return json(201, { task: await createTask(parsed.data, actor) });
      }
      return json(405, { error: 'Method not allowed' });
    }

    // ---- /api/tasks/:id[/approve] ------------------------------------------
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(approve|restore))?$/);
    if (taskMatch) {
      const [, id, sub] = taskMatch;

      // Undo for a removal. Passcode-gated like the delete it reverses.
      if (sub === 'restore') {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        if (!holdsPasscode(req)) {
          return json(403, {
            error: 'Restoring removed work needs the admin passcode.',
            locked: ['task'],
          });
        }
        const task = await restoreTask(id, actor);
        if (!task) return json(404, { error: 'Not found, or it was never removed' });
        return json(200, { task });
      }

      if (sub === 'approve') {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        const task = await approveTask(id, actor);
        if (!task) return json(404, { error: 'Not found' });
        return json(200, { task });
      }

      if (method === 'GET') {
        const task = await getTask(id);
        if (!task) return json(404, { error: 'Not found' });
        return json(200, { task, activity: await getActivity(id) });
      }
      if (method === 'PATCH') {
        // Inline editing sends one cell at a time, so a body of a single key
        // is the normal case, not an edge case.
        const parsed = taskUpdateSchema.safeParse(camelBody(req.body));
        if (!parsed.success)
          return json(422, { error: 'Validation failed', issues: parsed.error.issues });

        // A field that is already filled is frozen: overwriting what somebody
        // recorded needs the passcode. A field that is still empty does not —
        // filling in a blank adds information, it does not revise a record, and
        // making people unlock to enter a missing due date would only teach
        // them to leave the app unlocked.
        if (!holdsPasscode(req)) {
          const before = await getTask(id);
          if (!before) return json(404, { error: 'Not found' });
          const filled = Object.keys(parsed.data).filter((f) => {
            const current = (before as unknown as Record<string, unknown>)[f];
            return current !== null && current !== undefined && current !== '';
          });
          if (filled.length > 0) {
            return json(403, {
              error: `${filled.map(FIELD_LABELS).join(' and ')} ${
                filled.length > 1 ? 'are' : 'is'
              } already recorded. Unlock with the admin passcode to change ${
                filled.length > 1 ? 'them' : 'it'
              }.`,
              locked: filled,
            });
          }
        }

        const task = await updateTask(id, parsed.data, actor);
        if (!task) return json(404, { error: 'Not found' });
        // The full row goes back so the client can reconcile server-set fields
        // like completed_at and updated_at.
        return json(200, { task });
      }
      if (method === 'DELETE') {
        // Deleting is the largest edit there is; it always needs the passcode.
        if (!holdsPasscode(req)) {
          return json(403, {
            error: 'Deleting recorded work needs the admin passcode.',
            locked: ['task'],
          });
        }
        const ok = await deleteTask(id, actor);
        if (!ok) return json(404, { error: 'Not found' });
        return json(200, { success: true });
      }
      return json(405, { error: 'Method not allowed' });
    }

    return json(404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof TrackerError) return json(err.status, { error: err.message });
    return moduleFailure(err, 'Work Tracker', 'db/work-tracker.sql');
  }
}
