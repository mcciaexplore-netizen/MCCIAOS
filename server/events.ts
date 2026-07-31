// Workshops & Events data access.
//
// SCHEMA NOTE. Unlike every other module, this one is backed by its own tables
// (db/events.sql) rather than the generic `records` store. The reason is that
// the module's rules are relational ones the JSONB store cannot express: a
// unique (type, serial_no) pair driving code generation, a participant foreign
// key that cascades on delete, and counts that aggregate participant rows.
//
// It therefore requires the Postgres backend, exactly as server/analytics.ts
// does, and reports NO_SQL_MESSAGE when DATABASE_URL is unset rather than
// silently returning nothing.

import { requireSql } from './sql.js';
import {
  CODE_PREFIX,
  serialFromCode,
  typeFromCode,
} from '../src/schemas/events.js';
import type {
  EventMode,
  EventParticipant,
  EventRecord,
  EventStatus,
  EventSummary,
  EventType,
} from '../src/types/index.js';

/**
 * A failure the caller caused, carrying the status the API should answer with.
 * Anything else thrown from this module is a real server fault and becomes a
 * 500 without its message reaching the client.
 */
export class EventError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EventError';
  }
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Advisory lock coordinates for serial allocation. The class id is arbitrary
 * but fixed for this app; the object id distinguishes the two independent
 * sequences so creating a workshop never blocks creating an event.
 */
const LOCK_CLASS = 4242;
const LOCK_KEY: Record<EventType, number> = { WORKSHOP: 1, EVENT: 2 };

const iso = (v: string | Date | null): string =>
  v instanceof Date ? v.toISOString() : (v ?? '');

const blank = (v: unknown): string | null => {
  if (typeof v !== 'string') return v == null ? null : String(v);
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

interface EventRow {
  id: string;
  code: string;
  type: string;
  serial_no: number;
  title: string;
  description: string | null;
  topic: string | null;
  mode: string;
  venue: string | null;
  meeting_link: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  speaker: string | null;
  status: string;
  registered_count: number;
  attended_count: number;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  participant_rows: number;
  participant_attended: number;
}

interface ParticipantRow {
  id: string;
  event_id: string;
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  is_member: boolean | null;
  registered_at: string | Date | null;
  attended: boolean;
  created_at: string | Date | null;
}

// Dates and times are rendered to text in Postgres rather than left to the
// driver's type parser. A `date` column parsed into a JS Date is materialised
// at the server's own midnight, which shifts the calendar day either side of
// UTC; to_char keeps the day the user typed.
const EVENT_COLUMNS = `
  e.id, e.code, e.type, e.serial_no, e.title, e.description, e.topic,
  e.mode, e.venue, e.meeting_link,
  to_char(e.event_date, 'YYYY-MM-DD') as event_date,
  to_char(e.start_time, 'HH24:MI')    as start_time,
  to_char(e.end_time,   'HH24:MI')    as end_time,
  e.speaker, e.status, e.registered_count, e.attended_count, e.notes,
  e.created_at, e.updated_at,
  coalesce(p.total, 0)         as participant_rows,
  coalesce(p.attended_rows, 0) as participant_attended
`;

// Participant tallies for every event in one pass, joined in below. Grouping
// once here is what lets the count fallback be decided per row in SQL.
const PARTICIPANT_JOIN = `
  left join (
    select
      event_id,
      count(*)::int                            as total,
      count(*) filter (where attended)::int    as attended_rows
    from event_participants
    group by event_id
  ) p on p.event_id = e.id
`;

/**
 * Registered and attended for one event.
 *
 * Participant rows win whenever the event has any, so ticking an attendance box
 * is immediately reflected. The stored registered_count/attended_count columns
 * are the fallback for back-filled events captured as bulk figures only.
 */
function resolveCounts(row: {
  participant_rows: number;
  participant_attended: number;
  registered_count: number;
  attended_count: number;
}): { registered: number; attended: number; hasParticipants: boolean } {
  const hasParticipants = Number(row.participant_rows) > 0;
  return {
    hasParticipants,
    registered: hasParticipants
      ? Number(row.participant_rows)
      : Number(row.registered_count),
    attended: hasParticipants
      ? Number(row.participant_attended)
      : Number(row.attended_count),
  };
}

/** Attendance as a 0-100 percentage, or null when nobody registered. */
export function attendanceRate(
  attended: number,
  registered: number,
): number | null {
  if (!registered) return null;
  return Math.round((attended / registered) * 1000) / 10;
}

function toEvent(row: EventRow): EventRecord {
  const { registered, attended, hasParticipants } = resolveCounts(row);
  return {
    id: row.id,
    code: row.code,
    type: row.type as EventType,
    serialNo: Number(row.serial_no),
    title: row.title,
    description: row.description,
    topic: row.topic,
    mode: row.mode as EventMode,
    venue: row.venue,
    meetingLink: row.meeting_link,
    eventDate: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    speaker: row.speaker,
    status: row.status as EventStatus,
    registeredCount: Number(row.registered_count),
    attendedCount: Number(row.attended_count),
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    hasParticipants,
    registered,
    attended,
    attendanceRate: attendanceRate(attended, registered),
  };
}

function toParticipant(row: ParticipantRow): EventParticipant {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    company: row.company,
    designation: row.designation,
    email: row.email,
    phone: row.phone,
    isMember: Boolean(row.is_member),
    registeredAt: iso(row.registered_at),
    attended: Boolean(row.attended),
    createdAt: iso(row.created_at),
  };
}

// ---- Filtering -------------------------------------------------------------

export interface EventFilters {
  type?: string | null;
  mode?: string | null;
  status?: string | null;
  topic?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  sort?: string | null;
  dir?: string | null;
}

/**
 * Builds the shared WHERE clause. Every value is bound as a parameter — none of
 * the caller's input is ever concatenated into the SQL text.
 */
function buildWhere(f: EventFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (f.type) conditions.push(`e.type = ${bind(f.type)}`);
  if (f.mode) conditions.push(`e.mode = ${bind(f.mode)}`);
  if (f.status) conditions.push(`e.status = ${bind(f.status)}`);
  if (f.topic) conditions.push(`e.topic = ${bind(f.topic)}`);
  if (f.from) conditions.push(`e.event_date >= ${bind(f.from)}::date`);
  if (f.to) conditions.push(`e.event_date <= ${bind(f.to)}::date`);
  if (f.search) {
    // ILIKE with the wildcards in the parameter, so a literal % or _ typed into
    // the search box is matched as itself rather than as a wildcard.
    const term = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(`(e.code ilike ${bind(term)} or e.title ilike ${bind(term)})`);
  }

  return {
    clause: conditions.length ? `where ${conditions.join(' and ')}` : '',
    params,
  };
}

/**
 * ORDER BY, chosen from a fixed set — the caller's string never reaches the SQL.
 *
 * Sorting by code orders on (type, serial_no) rather than the code text, so
 * W-100 follows W-99 instead of sorting between W-10 and W-11.
 */
function buildOrder(sort: string | null | undefined, dir: string | null | undefined): string {
  const descending = dir !== 'asc';
  const d = descending ? 'desc' : 'asc';
  if (sort === 'code') return `order by e.type ${d}, e.serial_no ${d}`;
  return `order by e.event_date ${d}, e.serial_no ${d}`;
}

// ---- Reads -----------------------------------------------------------------

export async function listEvents(
  filters: EventFilters,
): Promise<{ events: EventRecord[]; summary: EventSummary }> {
  const db = requireSql();
  const { clause, params } = buildWhere(filters);
  const order = buildOrder(filters.sort, filters.dir);

  // The summary is aggregated in Postgres over the same filter rather than
  // summed from the returned page, so the stat cards stay correct no matter
  // how the list is later paged.
  const [rawRows, rawTotals] = await Promise.all([
    db.query(
      `select ${EVENT_COLUMNS} from events e ${PARTICIPANT_JOIN} ${clause} ${order}`,
      params,
    ),
    db.query(
      `select
         count(*) filter (where e.type = 'WORKSHOP')::int as workshops,
         count(*) filter (where e.type = 'EVENT')::int    as events,
         coalesce(sum(case when coalesce(p.total, 0) > 0
                           then p.total else e.registered_count end), 0)::int as registered,
         coalesce(sum(case when coalesce(p.total, 0) > 0
                           then p.attended_rows else e.attended_count end), 0)::int as attended
       from events e ${PARTICIPANT_JOIN} ${clause}`,
      params,
    ),
  ]);

  const rows = rawRows as EventRow[];
  const totals = rawTotals as {
    workshops: number;
    events: number;
    registered: number;
    attended: number;
  }[];

  const t = totals[0] ?? { workshops: 0, events: 0, registered: 0, attended: 0 };
  const registered = Number(t.registered);
  const attended = Number(t.attended);

  return {
    events: rows.map(toEvent),
    summary: {
      workshops: Number(t.workshops),
      events: Number(t.events),
      registered,
      attended,
      attendanceRate: attendanceRate(attended, registered),
    },
  };
}

export async function getEvent(id: string): Promise<EventRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${EVENT_COLUMNS} from events e ${PARTICIPANT_JOIN} where e.id = $1::uuid`,
    [id],
  )) as EventRow[];
  return rows[0] ? toEvent(rows[0]) : null;
}

export async function listParticipants(
  eventId: string,
): Promise<EventParticipant[]> {
  if (!UUID_RE.test(eventId)) return [];
  const db = requireSql();
  // Insertion order, so a freshly imported list reads in the order of the file
  // and a just-added person appears at the bottom where you expect them.
  const rows = (await db.query(
    `select * from event_participants where event_id = $1::uuid
     order by created_at asc, name asc`,
    [eventId],
  )) as ParticipantRow[];
  return rows.map(toParticipant);
}

/** The code a new event of this type would receive right now, for the form preview. */
export async function nextCode(type: EventType): Promise<string> {
  const db = requireSql();
  const rows = (await db.query(
    `select coalesce(max(serial_no), 0) + 1 as n from events where type = $1`,
    [type],
  )) as { n: number }[];
  const n = Number(rows[0]?.n ?? 1);
  return `${CODE_PREFIX[type]}${String(n).padStart(2, '0')}`;
}

// ---- Writes ----------------------------------------------------------------

export interface EventWriteInput {
  code?: string;
  type: EventType;
  title: string;
  description?: string;
  topic?: string;
  mode: EventMode;
  venue?: string;
  meetingLink?: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  speaker?: string;
  status: EventStatus;
  registeredCount: number;
  attendedCount: number;
  notes?: string;
}

/**
 * A venue on an online-only event, or a meeting link on an offline one, is
 * contradictory data the form hides but would otherwise keep. Drop whichever
 * does not apply so what is stored always matches the mode.
 */
function locationFor(
  mode: EventMode,
  venue: unknown,
  meetingLink: unknown,
): { venue: string | null; meetingLink: string | null } {
  return {
    venue: mode === 'ONLINE' ? null : blank(venue),
    meetingLink: mode === 'OFFLINE' ? null : blank(meetingLink),
  };
}

const INSERT_SQL = `
  insert into events (
    code, type, serial_no, title, description, topic, mode, venue, meeting_link,
    event_date, start_time, end_time, speaker, status,
    registered_count, attended_count, notes
  )
  select
    coalesce($1::text, $2::text || lpad(nxt.n::text, 2, '0')),
    $3::text,
    coalesce($4::int, nxt.n),
    $5::text, $6::text, $7::text, $8::text, $9::text, $10::text,
    $11::date, $12::time, $13::time, $14::text, $15::text,
    $16::int, $17::int, $18::text
  from (
    select coalesce(max(serial_no), 0) + 1 as n
    from events where type = $3::text
  ) nxt
  returning id
`;

export async function createEvent(input: EventWriteInput): Promise<EventRecord> {
  const db = requireSql();

  // An override supplies the code; the serial is read back out of it so the two
  // columns can never disagree. Blank means auto-assign.
  const override = blank(input.code);
  let serial: number | null = null;
  if (override) {
    serial = serialFromCode(override);
    if (serial === null || typeFromCode(override) !== input.type) {
      throw new EventError(
        `"${override}" is not a valid code for a ${input.type.toLowerCase()}`,
        422,
      );
    }
  }

  const { venue, meetingLink } = locationFor(input.mode, input.venue, input.meetingLink);
  const params = [
    override ? override.toUpperCase() : null,
    CODE_PREFIX[input.type],
    input.type,
    serial,
    input.title.trim(),
    blank(input.description),
    blank(input.topic),
    input.mode,
    venue,
    meetingLink,
    input.eventDate,
    blank(input.startTime),
    blank(input.endTime),
    blank(input.speaker),
    input.status,
    input.registeredCount,
    input.attendedCount,
    blank(input.notes),
  ];

  // Serial allocation runs inside a transaction holding an advisory lock keyed
  // on the type, so two concurrent creates cannot read the same MAX(serial_no).
  // The Neon HTTP driver has no interactive transaction, so the lock and the
  // insert are submitted together as one non-interactive transaction — the lock
  // is therefore still held while the insert computes the next serial.
  //
  // The unique index on (type, serial_no) backs this up. A retry covers the one
  // case the lock cannot: a serial already taken by a manually back-filled code.
  const attempts = override ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const results = await db.transaction((txn) => [
        txn.query('select pg_advisory_xact_lock($1, $2)', [
          LOCK_CLASS,
          LOCK_KEY[input.type],
        ]),
        txn.query(INSERT_SQL, params),
      ]);
      const inserted = results[1] as { id: string }[];
      const created = await getEvent(inserted[0].id);
      if (!created) throw new Error('Event vanished immediately after insert');
      return created;
    } catch (err) {
      if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
      if (override) {
        throw new EventError(`Code ${override.toUpperCase()} is already in use`, 409);
      }
      if (attempt === attempts - 1) {
        throw new EventError(
          'Could not allocate a code for this event. Please try again.',
          409,
        );
      }
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new EventError('Could not create the event', 500);
}

export type EventPatch = Partial<EventWriteInput>;

export async function updateEvent(
  id: string,
  patch: EventPatch,
): Promise<EventRecord | null> {
  const db = requireSql();
  const existing = await getEvent(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const set = (column: string, value: unknown, cast = '') =>
    sets.push(`${column} = ${bind(value)}${cast}`);

  // A code change is a change of serial too, and the prefix is checked against
  // whichever type the record will have once this patch is applied.
  const type = patch.type ?? existing.type;
  if (patch.code !== undefined) {
    const override = blank(patch.code);
    if (!override) {
      throw new EventError('A code cannot be cleared once assigned', 422);
    }
    const serial = serialFromCode(override);
    if (serial === null || typeFromCode(override) !== type) {
      throw new EventError(
        `"${override}" is not a valid code for a ${type.toLowerCase()}`,
        422,
      );
    }
    set('code', override.toUpperCase());
    set('serial_no', serial, '::int');
  } else if (patch.type !== undefined && patch.type !== existing.type) {
    // The type moved but no new code was given, so the old code now has the
    // wrong prefix. Rejecting is safer than silently renumbering a record other
    // people may already refer to by its code.
    throw new EventError(
      `Changing the type also changes the code. Supply a ${CODE_PREFIX[type]} code.`,
      422,
    );
  }

  if (patch.type !== undefined) set('type', patch.type);
  if (patch.title !== undefined) set('title', patch.title.trim());
  if (patch.description !== undefined) set('description', blank(patch.description));
  if (patch.topic !== undefined) set('topic', blank(patch.topic));
  if (patch.eventDate !== undefined) set('event_date', patch.eventDate, '::date');
  if (patch.startTime !== undefined) set('start_time', blank(patch.startTime), '::time');
  if (patch.endTime !== undefined) set('end_time', blank(patch.endTime), '::time');
  if (patch.speaker !== undefined) set('speaker', blank(patch.speaker));
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.registeredCount !== undefined)
    set('registered_count', patch.registeredCount, '::int');
  if (patch.attendedCount !== undefined)
    set('attended_count', patch.attendedCount, '::int');
  if (patch.notes !== undefined) set('notes', blank(patch.notes));

  // Mode decides which of venue/link may be stored, so they are rewritten
  // together whenever any of the three is touched — otherwise switching an
  // event to ONLINE would leave its old venue behind.
  if (
    patch.mode !== undefined ||
    patch.venue !== undefined ||
    patch.meetingLink !== undefined
  ) {
    const mode = patch.mode ?? existing.mode;
    const { venue, meetingLink } = locationFor(
      mode,
      patch.venue !== undefined ? patch.venue : existing.venue,
      patch.meetingLink !== undefined ? patch.meetingLink : existing.meetingLink,
    );
    if (patch.mode !== undefined) set('mode', mode);
    set('venue', venue);
    set('meeting_link', meetingLink);
  }

  if (sets.length === 0) return existing;

  sets.push('updated_at = now()');
  params.push(id);

  try {
    const rows = (await db.query(
      `update events set ${sets.join(', ')} where id = $${params.length}::uuid returning id`,
      params,
    )) as { id: string }[];
    if (!rows[0]) return null;
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new EventError('That code is already in use', 409);
    }
    throw err;
  }

  return getEvent(id);
}

export async function deleteEvent(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  // Participants go with it: the foreign key is ON DELETE CASCADE.
  const rows = (await db.query(
    `delete from events where id = $1::uuid returning id`,
    [id],
  )) as { id: string }[];
  return rows.length > 0;
}

// ---- Participants ----------------------------------------------------------

export interface ParticipantWriteInput {
  name: string;
  company?: string;
  designation?: string;
  email?: string;
  phone?: string;
  isMember?: boolean;
  attended?: boolean;
}

export async function addParticipant(
  eventId: string,
  input: ParticipantWriteInput,
): Promise<EventParticipant | null> {
  if (!UUID_RE.test(eventId)) return null;
  const db = requireSql();
  try {
    const rows = (await db.query(
      `insert into event_participants
         (event_id, name, company, designation, email, phone, is_member, attended)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        eventId,
        input.name.trim(),
        blank(input.company),
        blank(input.designation),
        blank(input.email),
        blank(input.phone),
        Boolean(input.isMember),
        Boolean(input.attended),
      ],
    )) as ParticipantRow[];
    return rows[0] ? toParticipant(rows[0]) : null;
  } catch (err) {
    // The only foreign key here is event_id, so a violation means the event was
    // deleted between the page loading and the row being added.
    if ((err as { code?: string }).code === '23503') {
      throw new EventError('That event no longer exists', 404);
    }
    throw err;
  }
}

export async function updateParticipant(
  id: string,
  patch: Partial<ParticipantWriteInput>,
): Promise<EventParticipant | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.name !== undefined) set('name', patch.name.trim());
  if (patch.company !== undefined) set('company', blank(patch.company));
  if (patch.designation !== undefined) set('designation', blank(patch.designation));
  if (patch.email !== undefined) set('email', blank(patch.email));
  if (patch.phone !== undefined) set('phone', blank(patch.phone));
  if (patch.isMember !== undefined) set('is_member', Boolean(patch.isMember));
  if (patch.attended !== undefined) set('attended', Boolean(patch.attended));

  if (sets.length === 0) {
    const current = (await db.query(
      `select * from event_participants where id = $1::uuid`,
      [id],
    )) as ParticipantRow[];
    return current[0] ? toParticipant(current[0]) : null;
  }

  params.push(id);
  const rows = (await db.query(
    `update event_participants set ${sets.join(', ')}
     where id = $${params.length}::uuid returning *`,
    params,
  )) as ParticipantRow[];
  return rows[0] ? toParticipant(rows[0]) : null;
}

export async function deleteParticipant(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  const rows = (await db.query(
    `delete from event_participants where id = $1::uuid returning id`,
    [id],
  )) as { id: string }[];
  return rows.length > 0;
}

/** Sets `attended` on every participant of one event. Used by "Mark all attended". */
export async function setAllAttendance(
  eventId: string,
  attended: boolean,
): Promise<number> {
  if (!UUID_RE.test(eventId)) return 0;
  const db = requireSql();
  const rows = (await db.query(
    `update event_participants set attended = $2
     where event_id = $1::uuid and attended is distinct from $2
     returning id`,
    [eventId, attended],
  )) as { id: string }[];
  return rows.length;
}

/**
 * Rows per INSERT. Each row binds 7 parameters and Postgres accepts at most
 * 65535 per statement, so a single statement would break somewhere above 9000
 * people. Batching keeps a large delegate list to a handful of round trips
 * instead of one per person, without that ceiling.
 */
const IMPORT_BATCH = 500;

/** Bulk insert from a CSV import. Returns how many rows were written. */
export async function importParticipants(
  eventId: string,
  rows: ParticipantWriteInput[],
): Promise<number> {
  if (!UUID_RE.test(eventId)) return 0;
  if (rows.length === 0) return 0;
  const db = requireSql();

  let total = 0;
  for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH) {
    const batch = rows.slice(offset, offset + IMPORT_BATCH);
    const params: unknown[] = [eventId];
    const tuples = batch.map((r) => {
      const start = params.length;
      params.push(
        r.name.trim(),
        blank(r.company),
        blank(r.designation),
        blank(r.email),
        blank(r.phone),
        Boolean(r.isMember),
        Boolean(r.attended),
      );
      return `($1::uuid, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}::boolean, $${start + 7}::boolean)`;
    });

    try {
      const inserted = (await db.query(
        `insert into event_participants
           (event_id, name, company, designation, email, phone, is_member, attended)
         values ${tuples.join(', ')}
         returning id`,
        params,
      )) as { id: string }[];
      total += inserted.length;
    } catch (err) {
      // The only foreign key is event_id, so a violation means the event was
      // deleted while the file was being uploaded. Earlier batches are already
      // gone with it, which is why the count reported back is what landed.
      if ((err as { code?: string }).code === '23503') {
        throw new EventError('That event no longer exists', 404);
      }
      throw err;
    }
  }
  return total;
}
