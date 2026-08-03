// Daily Work Log data access.
//
// SCHEMA NOTE. Like server/events.ts this module uses dedicated tables
// (db/daily-logs.sql) rather than the generic `records` store, and therefore
// requires the Postgres backend — it reports NO_SQL_MESSAGE when DATABASE_URL
// is unset. It also introduces the app's first `users` table; every other
// module still identifies a person by name in `records.assigned_to`.
//
// TIMEZONE. `log_date` is an Asia/Kolkata calendar day, never a UTC one. The
// server runs in UTC, where `now()::date` rolls over at 05:30 IST and would
// file an evening's work under the next day. Defaults are computed as
// `(now() at time zone 'Asia/Kolkata')::date` in SQL and via src/lib/ist.ts in
// TypeScript, which resolve the same instant the same way.

import { requireSql } from './sql.js';
import { istToday } from '../src/lib/ist.js';
import type {
  CategoryCount,
  DailyCheckin,
  DailyLog,
  DailySummaryRow,
  DayStats,
  LogCategory,
  LogPriority,
  LogStatus,
  User,
} from '../src/types/index.js';

/** A caller-caused failure carrying the status the API should answer with. */
export class DailyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DailyError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (v: string | Date | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

const blank = (v: unknown): string | null => {
  if (typeof v !== 'string') return v == null ? null : String(v);
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

/** Non-empty after trimming. The rule behind "DONE means there is an output". */
const filled = (v: unknown): boolean =>
  typeof v === 'string' && v.trim() !== '';

/** Today as an IST calendar day. Never `new Date().toISOString()`. */
export const todayIst = istToday;

// ---- Row shapes ------------------------------------------------------------

interface LogRow {
  id: string;
  log_date: string;
  user_id: string;
  user_name: string;
  title: string;
  category: string;
  description: string | null;
  output: string | null;
  output_link: string | null;
  status: string;
  priority: string | null;
  time_spent_mins: number | null;
  blocker_note: string | null;
  carried_from_id: string | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

// log_date is rendered to text in Postgres rather than left to the driver's
// type parser: a `date` parsed into a JS Date materialises at the server's
// midnight and shifts the calendar day either side of UTC.
const LOG_COLUMNS = `
  l.id,
  to_char(l.log_date, 'YYYY-MM-DD') as log_date,
  l.user_id, u.name as user_name,
  l.title, l.category, l.description, l.output, l.output_link,
  l.status, l.priority, l.time_spent_mins, l.blocker_note,
  l.carried_from_id, l.completed_at, l.created_at, l.updated_at
`;

function toLog(row: LogRow): DailyLog {
  return {
    id: row.id,
    logDate: row.log_date,
    userId: row.user_id,
    userName: row.user_name,
    title: row.title,
    category: row.category as LogCategory,
    description: row.description,
    output: row.output,
    outputLink: row.output_link,
    status: row.status as LogStatus,
    priority: (row.priority as LogPriority | null) ?? null,
    timeSpentMins: row.time_spent_mins == null ? null : Number(row.time_spent_mins),
    blockerNote: row.blocker_note,
    carriedFromId: row.carried_from_id,
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  };
}

// ---- Users -----------------------------------------------------------------

export async function listUsers(includeInactive = false): Promise<User[]> {
  const db = requireSql();
  const rows = (await db.query(
    `select id, name, email, role, active from users
     ${includeInactive ? '' : 'where active'}
     order by name asc`,
  )) as {
    id: string;
    name: string;
    email: string | null;
    role: string;
    active: boolean;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role as User['role'],
    active: Boolean(r.active),
  }));
}

/**
 * Adds any Settings roster name that has no `users` row yet.
 *
 * The roster is still edited on the Settings page as a list of names, so a
 * member added there would otherwise never appear in this module. Additive
 * only: it never renames or deactivates anyone, because daily_logs rows
 * reference these ids. Same statement as the seed in db/daily-logs.sql.
 */
export async function syncUsersFromSettings(): Promise<number> {
  const db = requireSql();
  const rows = (await db.query(
    // The array check is inside the LATERAL, not the WHERE: handing
    // jsonb_array_elements_text a scalar raises, and the planner is free to run
    // the LATERAL before the filter. Kept identical to db/daily-logs.sql.
    `insert into users (name)
     select distinct btrim(member)
     from records r
     cross join lateral jsonb_array_elements_text(
       case when jsonb_typeof(r.data -> 'teamMembers') = 'array'
            then r.data -> 'teamMembers'
            else '[]'::jsonb end
     ) as member
     where r.sheet = 'Settings'
       and btrim(member) <> ''
     on conflict (name) do nothing
     returning id`,
  )) as { id: string }[];
  return rows.length;
}

async function requireUser(userId: string): Promise<void> {
  if (!UUID_RE.test(userId)) throw new DailyError('Unknown team member', 404);
  const db = requireSql();
  const rows = (await db.query(`select id from users where id = $1::uuid`, [
    userId,
  ])) as { id: string }[];
  if (!rows[0]) throw new DailyError('Unknown team member', 404);
}

// ---- Filtering -------------------------------------------------------------

export interface LogFilters {
  date?: string | null;
  from?: string | null;
  to?: string | null;
  userId?: string | null;
  status?: string | null;
  category?: string | null;
}

function buildWhere(f: LogFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  // `date` is the single-day form and wins over a range if both are sent.
  if (f.date) conditions.push(`l.log_date = ${bind(f.date)}::date`);
  else {
    if (f.from) conditions.push(`l.log_date >= ${bind(f.from)}::date`);
    if (f.to) conditions.push(`l.log_date <= ${bind(f.to)}::date`);
  }
  if (f.userId) conditions.push(`l.user_id = ${bind(f.userId)}::uuid`);
  if (f.status) conditions.push(`l.status = ${bind(f.status)}`);
  if (f.category) conditions.push(`l.category = ${bind(f.category)}`);

  return {
    clause: conditions.length ? `where ${conditions.join(' and ')}` : '',
    params,
  };
}

export async function listLogs(filters: LogFilters): Promise<DailyLog[]> {
  const db = requireSql();
  const { clause, params } = buildWhere(filters);
  const rows = (await db.query(
    `select ${LOG_COLUMNS}
     from daily_logs l
     join users u on u.id = l.user_id
     ${clause}
     order by l.log_date desc, u.name asc, l.created_at asc`,
    params,
  )) as LogRow[];
  return rows.map(toLog);
}

export async function getLog(id: string): Promise<DailyLog | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${LOG_COLUMNS} from daily_logs l
     join users u on u.id = l.user_id where l.id = $1::uuid`,
    [id],
  )) as LogRow[];
  return rows[0] ? toLog(rows[0]) : null;
}

/** Headline counts for one day, plus how much of the team reported. */
export async function getDayStats(date: string): Promise<DayStats> {
  const db = requireSql();
  const rows = (await db.query(
    `select
       (select count(*) from daily_logs where log_date = $1::date)::int as total_tasks,
       (select count(*) from daily_logs where log_date = $1::date and status = 'DONE')::int as done,
       (select count(*) from daily_logs where log_date = $1::date and status = 'IN_PROGRESS')::int as in_progress,
       (select count(*) from daily_logs where log_date = $1::date and status = 'BLOCKED')::int as blocked,
       (select count(*) from daily_logs where log_date = $1::date and status = 'PLANNED')::int as planned,
       (select count(*) from daily_logs where log_date = $1::date and status = 'CARRIED_FORWARD')::int as carried_forward,
       -- "Reported" means logged at least one task, or left a day summary.
       (select count(distinct u.id) from users u
         where u.active and (
           exists (select 1 from daily_logs l where l.user_id = u.id and l.log_date = $1::date)
           or exists (select 1 from daily_checkins c
                       where c.user_id = u.id and c.log_date = $1::date
                         and c.submitted_at is not null)
         ))::int as reported,
       (select count(*) from users where active)::int as team_size`,
    [date],
  )) as Record<string, number>[];

  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  const reported = n('reported');
  const teamSize = n('team_size');
  return {
    totalTasks: n('total_tasks'),
    done: n('done'),
    inProgress: n('in_progress'),
    blocked: n('blocked'),
    planned: n('planned'),
    carriedForward: n('carried_forward'),
    reported,
    teamSize,
    reportedPct: teamSize ? Math.round((reported / teamSize) * 1000) / 10 : null,
  };
}

// ---- Writes ----------------------------------------------------------------

export interface LogWriteInput {
  logDate?: string;
  userId: string;
  title: string;
  category: LogCategory;
  description?: string;
  output?: string;
  outputLink?: string;
  status: LogStatus;
  priority: LogPriority;
  timeSpentMins?: number;
  blockerNote?: string;
}

/**
 * The two invariants, judged against whatever the row will look like after the
 * write. Postgres enforces them too; this exists so the client gets a sentence
 * instead of a constraint name.
 */
function assertEvidence(status: LogStatus, output: unknown, blockerNote: unknown) {
  if (status === 'DONE' && !filled(output)) {
    throw new DailyError(
      'Record what was produced before marking this done — an entry cannot be DONE with no output.',
      422,
    );
  }
  if (status === 'BLOCKED' && !filled(blockerNote)) {
    throw new DailyError('Say what is blocking this before marking it blocked.', 422);
  }
}

export async function createLog(input: LogWriteInput): Promise<DailyLog> {
  await requireUser(input.userId);
  assertEvidence(input.status, input.output, input.blockerNote);
  const db = requireSql();

  const rows = (await db.query(
    `insert into daily_logs
       (log_date, user_id, title, category, description, output, output_link,
        status, priority, time_spent_mins, blocker_note, completed_at)
     values (
       coalesce($1::date, (now() at time zone 'Asia/Kolkata')::date),
       $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::int, $11,
       case when $8 = 'DONE' then now() else null end
     )
     returning id`,
    [
      input.logDate ?? null,
      input.userId,
      input.title.trim(),
      input.category,
      blank(input.description),
      blank(input.output),
      blank(input.outputLink),
      input.status,
      input.priority,
      input.timeSpentMins ?? null,
      blank(input.blockerNote),
    ],
  )) as { id: string }[];

  const created = await getLog(rows[0].id);
  if (!created) throw new Error('Log vanished immediately after insert');
  return created;
}

export type LogPatch = Partial<LogWriteInput>;

export async function updateLog(id: string, patch: LogPatch): Promise<DailyLog | null> {
  const existing = await getLog(id);
  if (!existing) return null;
  const db = requireSql();

  // The rules are judged on the merged row, not the patch: a body of
  // {status:'DONE'} is valid when an output was recorded earlier, and a body
  // that blanks the output of an already-DONE row is not.
  const status = patch.status ?? existing.status;
  const output = patch.output !== undefined ? patch.output : existing.output;
  const blockerNote =
    patch.blockerNote !== undefined ? patch.blockerNote : existing.blockerNote;
  assertEvidence(status, output, blockerNote);

  if (patch.userId !== undefined) await requireUser(patch.userId);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown, cast = '') => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (patch.logDate !== undefined) set('log_date', patch.logDate, '::date');
  if (patch.userId !== undefined) set('user_id', patch.userId, '::uuid');
  if (patch.title !== undefined) set('title', patch.title.trim());
  if (patch.category !== undefined) set('category', patch.category);
  if (patch.description !== undefined) set('description', blank(patch.description));
  if (patch.output !== undefined) set('output', blank(patch.output));
  if (patch.outputLink !== undefined) set('output_link', blank(patch.outputLink));
  if (patch.priority !== undefined) set('priority', patch.priority);
  if (patch.timeSpentMins !== undefined)
    set('time_spent_mins', patch.timeSpentMins ?? null, '::int');
  if (patch.blockerNote !== undefined) set('blocker_note', blank(patch.blockerNote));

  // completed_at is derived, never sent by the client. Stamped on the way into
  // DONE, preserved while it stays DONE, cleared on the way out — which also
  // satisfies the (status = 'DONE') = (completed_at is not null) constraint.
  if (patch.status !== undefined) {
    set('status', status);
    sets.push(
      status === 'DONE'
        ? 'completed_at = coalesce(completed_at, now())'
        : 'completed_at = null',
    );
  }

  if (sets.length === 0) return existing;

  sets.push('updated_at = now()');
  params.push(id);

  const rows = (await db.query(
    `update daily_logs set ${sets.join(', ')}
     where id = $${params.length}::uuid returning id`,
    params,
  )) as { id: string }[];
  if (!rows[0]) return null;

  return getLog(id);
}

/** POST /api/daily-logs/[id]/complete — the one-step "mark done with output". */
export async function completeLog(
  id: string,
  input: { output: string; outputLink?: string; timeSpentMins?: number },
): Promise<DailyLog | null> {
  const existing = await getLog(id);
  if (!existing) return null;
  if (!filled(input.output)) {
    throw new DailyError(
      'Record what was produced before marking this done — an entry cannot be DONE with no output.',
      422,
    );
  }
  const db = requireSql();

  await db.query(
    `update daily_logs set
       output          = $1,
       output_link     = coalesce($2, output_link),
       time_spent_mins = coalesce($3::int, time_spent_mins),
       status          = 'DONE',
       completed_at    = coalesce(completed_at, now()),
       updated_at      = now()
     where id = $4::uuid`,
    [
      input.output.trim(),
      blank(input.outputLink),
      input.timeSpentMins ?? null,
      id,
    ],
  );
  return getLog(id);
}

export async function deleteLog(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  const rows = (await db.query(
    `delete from daily_logs where id = $1::uuid returning id`,
    [id],
  )) as { id: string }[];
  return rows.length > 0;
}

/**
 * Rolls one person's unfinished work from one date to another.
 *
 * History is never rewritten: the originals are marked CARRIED_FORWARD and stay
 * on their own date, and fresh rows are inserted on the target date pointing
 * back at them through carried_from_id.
 *
 * One statement, so the mark and the insert cannot half-happen. All three CTEs
 * read the same snapshot of `src`, so `moved` updating those rows does not
 * change what `ins` copies. Re-running is a no-op: the source rows are no longer
 * in an unfinished status, so nothing is selected the second time.
 *
 * A BLOCKED task carries its status and blocker note across rather than being
 * reset to PLANNED — it is still blocked tomorrow, and flattening that would
 * hide the signal the management view exists to surface.
 */
export async function carryForward(
  fromDate: string,
  toDate: string,
  userId: string,
): Promise<number> {
  await requireUser(userId);
  const db = requireSql();

  const rows = (await db.query(
    `with src as (
       select * from daily_logs
       where log_date = $1::date
         and user_id = $3::uuid
         and status in ('PLANNED', 'IN_PROGRESS', 'BLOCKED')
     ),
     moved as (
       update daily_logs d
         set status = 'CARRIED_FORWARD', completed_at = null, updated_at = now()
       from src where d.id = src.id
       returning d.id
     ),
     ins as (
       insert into daily_logs
         (log_date, user_id, title, category, description, output_link,
          status, priority, blocker_note, carried_from_id)
       select $2::date, src.user_id, src.title, src.category, src.description,
              src.output_link,
              case when src.status = 'BLOCKED' then 'BLOCKED' else 'PLANNED' end,
              src.priority, src.blocker_note, src.id
       from src
       returning id
     )
     select (select count(*) from ins)::int as created,
            (select count(*) from moved)::int as moved`,
    [fromDate, toDate, userId],
  )) as { created: number; moved: number }[];

  return Number(rows[0]?.created ?? 0);
}

// ---- Check-ins -------------------------------------------------------------

interface CheckinRow {
  id: string;
  user_id: string;
  log_date: string;
  day_summary: string | null;
  submitted_at: string | Date | null;
}

const toCheckin = (row: CheckinRow): DailyCheckin => ({
  id: row.id,
  userId: row.user_id,
  logDate: row.log_date,
  daySummary: row.day_summary,
  submittedAt: iso(row.submitted_at),
});

export async function listCheckins(
  date: string,
  userId?: string | null,
): Promise<DailyCheckin[]> {
  const db = requireSql();
  const params: unknown[] = [date];
  let clause = 'where log_date = $1::date';
  if (userId) {
    params.push(userId);
    clause += ` and user_id = $2::uuid`;
  }
  const rows = (await db.query(
    `select id, user_id, to_char(log_date, 'YYYY-MM-DD') as log_date,
            day_summary, submitted_at
     from daily_checkins ${clause}`,
    params,
  )) as CheckinRow[];
  return rows.map(toCheckin);
}

export async function upsertCheckin(input: {
  userId: string;
  logDate?: string;
  daySummary?: string;
}): Promise<DailyCheckin> {
  await requireUser(input.userId);
  const db = requireSql();
  const rows = (await db.query(
    `insert into daily_checkins (user_id, log_date, day_summary, submitted_at)
     values (
       $1::uuid,
       coalesce($2::date, (now() at time zone 'Asia/Kolkata')::date),
       $3,
       now()
     )
     on conflict (user_id, log_date) do update
       set day_summary  = excluded.day_summary,
           submitted_at = now(),
           updated_at   = now()
     returning id, user_id, to_char(log_date, 'YYYY-MM-DD') as log_date,
               day_summary, submitted_at`,
    [input.userId, input.logDate ?? null, blank(input.daySummary)],
  )) as CheckinRow[];
  return toCheckin(rows[0]);
}

// ---- Summary ---------------------------------------------------------------

export async function getSummary(
  from: string,
  to: string,
): Promise<{ rows: DailySummaryRow[]; categories: CategoryCount[] }> {
  const db = requireSql();

  // Every active member appears, including those who logged nothing — a blank
  // row is the point of a management view.
  const [rawRows, rawCats] = await Promise.all([
    db.query(
      `select u.id as user_id, u.name as user_name,
              count(l.id)::int                                        as tasks,
              count(*) filter (where l.status = 'DONE')::int           as done,
              count(*) filter (where l.status = 'IN_PROGRESS')::int    as in_progress,
              count(*) filter (where l.status = 'BLOCKED')::int        as blocked,
              count(*) filter (where l.status = 'PLANNED')::int        as planned,
              count(*) filter (where l.status = 'CARRIED_FORWARD')::int as carried_forward,
              coalesce(sum(l.time_spent_mins), 0)::int                 as total_mins
       from users u
       left join daily_logs l
         on l.user_id = u.id and l.log_date between $1::date and $2::date
       where u.active
       group by u.id, u.name
       order by u.name asc`,
      [from, to],
    ),
    db.query(
      `select category, count(*)::int as count,
              coalesce(sum(time_spent_mins), 0)::int as total_mins
       from daily_logs
       where log_date between $1::date and $2::date
       group by category
       order by count desc, category asc`,
      [from, to],
    ),
  ]);

  const rows = (rawRows as Record<string, string | number>[]).map((r) => {
    const tasks = Number(r.tasks);
    const done = Number(r.done);
    return {
      userId: String(r.user_id),
      userName: String(r.user_name),
      tasks,
      done,
      inProgress: Number(r.in_progress),
      blocked: Number(r.blocked),
      planned: Number(r.planned),
      carriedForward: Number(r.carried_forward),
      completionRate: tasks ? Math.round((done / tasks) * 1000) / 10 : null,
      totalMins: Number(r.total_mins),
    } satisfies DailySummaryRow;
  });

  const categories = (rawCats as Record<string, string | number>[]).map((c) => ({
    category: String(c.category) as LogCategory,
    count: Number(c.count),
    totalMins: Number(c.total_mins),
  }));

  return { rows, categories };
}
