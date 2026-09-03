// Work Tracker data access.
//
// SCHEMA NOTE. Backed by its own tables (db/work-tracker.sql) rather than the
// generic `records` store, and therefore requires the Postgres backend — it
// reports NO_SQL_MESSAGE when DATABASE_URL is unset.
//
// ONE TABLE FOR THE WHOLE TEAM. `tasks` is filtered by user_id; there is no
// table, schema or database per person. The person filter is a WHERE clause.
// Splitting per user would make the team view, the overdue report and the
// workload summary impossible to build.
//
// ONE PERSON PER TASK. There is no collaborators table.
//
// TIMEZONE. Dates are Asia/Kolkata calendar days, matching the rest of the app.

import { requireSql } from './sql.js';
import type {
  AtRiskTask,
  Task,
  TaskActivity,
  TaskPriority,
  TaskStatus,
  TaskTabCounts,
  TodayCounts,
  User,
  WorkStaleness,
} from '../src/types/index.js';

/** A caller-caused failure carrying the status the API should answer with. */
export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (v: string | Date | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

const blank = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v !== 'string') return String(v);
  const t = v.trim();
  return t === '' ? null : t;
};

/** The IST calendar day, as SQL. Every "today" comparison goes through this. */
const TODAY = `(now() at time zone 'Asia/Kolkata')::date`;

/**
 * Work that is still live. Stopped work was dropped on purpose and completed
 * work is finished, so neither can be late.
 */
const OPEN = `('upcoming','ongoing','hold')`;

/**
 * The date that decides whether work is late.
 *
 * `due_date` is the working target and `deadline_date` is the hard limit, so
 * missing the target is not yet a failure — only blowing the deadline is. A row
 * with no deadline falls back to its due date, otherwise it could never be late.
 */
const LATE_DATE = `coalesce(t.deadline_date, t.due_date)`;

/**
 * 17:00 IST — the point in the day after which unfinished work has missed
 * another day.
 *
 * Chosen to sit an hour ahead of the 18:00 export, so the number a person sees
 * in the tracker is already settled by the time the same number is written to
 * their sheet. A cut-off at midnight would have let the export record a count
 * that changed minutes later.
 */
const CUTOFF = `time '17:00'`;

/**
 * How many days a task is past its deadline, counting the deadline day itself
 * once the cut-off has passed.
 *
 * A deadline of the 3rd reads 0 all through the 3rd, becomes 1 at 17:00 that
 * evening, and gains one at each 17:00 after. Missing the deadline is a fact
 * about the day it was missed, not about the following morning, so the day the
 * work was due has to be able to count against it.
 *
 * Completed and stopped work reads 0 no matter how late it ran: this measures
 * what is still outstanding, not how badly finished work overran. A task with
 * neither date cannot be late at all.
 */
const DUE_DAYS = `(case
    when t.status not in ${OPEN} or ${LATE_DATE} is null then 0
    else greatest(0, (${TODAY} - ${LATE_DATE})
      + case when (now() at time zone 'Asia/Kolkata')::time >= ${CUTOFF} then 1 else 0 end)
  end)`;

/**
 * Late is simply "owes at least one day", so the badge, the Overdue tab and
 * every count are the same statement. They were four copies of the same
 * comparison before, which is how they would have drifted apart.
 */
const IS_OVERDUE = `${DUE_DAYS} > 0`;
/**
 * Removed work is hidden, not destroyed (db/work-tracker-history.sql), so every
 * read has to say so. Anything that counts or lists tasks and forgets this will
 * quietly resurrect deleted work.
 */
const LIVE = `t.deleted_at is null`;

/**
 * Whether a person is on a task: they own it, or they are a member of it.
 *
 * Group work is filed under one owner and listed once, so a collaborator's
 * involvement lives entirely in task_members. Matching only `user_id` meant
 * somebody added to a task could not see it in their own view — the work was
 * theirs and invisible to them.
 *
 * Takes the placeholder rather than the value so each caller keeps its own
 * parameter numbering.
 */
const onTask = (param: string) =>
  `(t.user_id = ${param}::uuid or exists (
      select 1 from task_members m where m.task_id = t.id and m.user_id = ${param}::uuid))`;

// ---- Row shapes ------------------------------------------------------------

interface TaskRow {
  id: string;
  user_id: string;
  user_name: string;
  title: string;
  priority: string;
  status: string;
  percentage: number | null;
  members: { id: string; name: string; colour: string | null }[] | null;
  allocation_date: string | null;
  due_date: string | null;
  deadline_date: string | null;
  report_to: string | null;
  report_to_name: string | null;
  approver_id: string | null;
  approver_name: string | null;
  completed_at: string | Date | null;
  approved_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  is_overdue: boolean;
  due_days: number;
  has_slipped: boolean;
  past_deadline: boolean;
  days_left: number | null;
}

// Dates are rendered to text in Postgres rather than left to the driver's type
// parser: a `date` parsed into a JS Date materialises at the server's own
// midnight and shifts the calendar day either side of UTC.
const TASK_COLUMNS = `
  t.id, t.user_id, uo.name as user_name, t.title, t.priority, t.status,
  t.percentage,
  -- Everybody else on this task, aggregated here so a list of 50 tasks is one
  -- query rather than 51. Empty array, never null, so callers need no guard.
  coalesce((
    select json_agg(json_build_object('id', mu.id, 'name', mu.name, 'colour', mu.colour)
                    order by mu.name)
      from task_members m join users mu on mu.id = m.user_id
     where m.task_id = t.id
  ), '[]'::json) as members,
  to_char(t.allocation_date, 'YYYY-MM-DD') as allocation_date,
  to_char(t.due_date,        'YYYY-MM-DD') as due_date,
  to_char(t.deadline_date,   'YYYY-MM-DD') as deadline_date,
  t.report_to,   ur.name as report_to_name,
  t.approver_id, ua.name as approver_name,
  t.completed_at, t.approved_at, t.created_at, t.updated_at,
  ${IS_OVERDUE}                                               as is_overdue,
  ${DUE_DAYS}::int                                            as due_days,
  -- Past the working target but still inside the deadline. Without this the
  -- deadline-based overdue rule would leave a slipped target with no signal.
  (t.due_date is not null and t.due_date < ${TODAY}
    and (${LATE_DATE} is null or ${LATE_DATE} >= ${TODAY})
    and t.status in ${OPEN})                                  as has_slipped,
  (t.deadline_date is not null and t.deadline_date < ${TODAY}
    and t.status <> 'completed')                              as past_deadline,
  (t.due_date - ${TODAY})                                     as days_left
`;

const TASK_JOINS = `
  from tasks t
  join users uo on uo.id = t.user_id
  left join users ur on ur.id = t.report_to
  left join users ua on ua.id = t.approver_id
`;

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    title: row.title,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    percentage: row.percentage,
    members: row.members ?? [],
    allocationDate: row.allocation_date,
    dueDate: row.due_date,
    deadlineDate: row.deadline_date,
    reportTo: row.report_to,
    reportToName: row.report_to_name,
    approverId: row.approver_id,
    approverName: row.approver_name,
    completedAt: iso(row.completed_at),
    approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
    isOverdue: Boolean(row.is_overdue),
    dueDays: Number(row.due_days ?? 0),
    hasSlipped: Boolean(row.has_slipped),
    pastDeadline: Boolean(row.past_deadline),
    daysLeft: row.days_left == null ? null : Number(row.days_left),
  };
}

// ---- Users -----------------------------------------------------------------

const USER_COLUMNS = `
  u.id, u.name, u.email, u.role, u.designation, u.department,
  u.reports_to, m.name as reports_to_name, u.avatar_url, u.is_active,
  u.can_be_reported_to, u.can_approve, u.colour
`;

function toUser(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    name: String(r.name),
    email: (r.email as string | null) ?? null,
    role: (r.role as User['role']) ?? 'MEMBER',
    designation: (r.designation as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    reportsTo: (r.reports_to as string | null) ?? null,
    reportsToName: (r.reports_to_name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    isActive: Boolean(r.is_active),
    canBeReportedTo: Boolean(r.can_be_reported_to),
    canApprove: Boolean(r.can_approve),
    colour: (r.colour as string | null) ?? null,
  };
}

export async function listUsers(activeOnly = true): Promise<User[]> {
  const db = requireSql();
  const rows = (await db.query(
    `select ${USER_COLUMNS}
     from users u left join users m on m.id = u.reports_to
     ${activeOnly ? 'where u.is_active' : ''}
     order by u.name asc`,
  )) as Record<string, unknown>[];
  return rows.map(toUser);
}

async function getUser(id: string): Promise<User | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${USER_COLUMNS} from users u
     left join users m on m.id = u.reports_to where u.id = $1::uuid`,
    [id],
  )) as Record<string, unknown>[];
  return rows[0] ? toUser(rows[0]) : null;
}

async function requireUser(id: string, label = 'user'): Promise<void> {
  if (!UUID_RE.test(id)) throw new TrackerError(`Unknown ${label}`, 404);
  const db = requireSql();
  const rows = (await db.query(`select id from users where id = $1::uuid`, [id])) as {
    id: string;
  }[];
  if (!rows[0]) throw new TrackerError(`Unknown ${label}`, 404);
}

// ---- Filtering -------------------------------------------------------------

export interface TaskFilters {
  user?: string | null;
  status?: string | null;
  priority?: string | null;
  tab?: string | null;
  sort?: string | null;
  dir?: string | null;
}

/**
 * Sortable columns, chosen from a fixed set — no caller input reaches the SQL.
 *
 * Text sorts are case-insensitive. The database's own collation puts "MSME"
 * before "Mail", which is not the order a person reading the list expects.
 */
const SORTABLE: Record<string, string> = {
  name: 'lower(uo.name)',
  title: 'lower(t.title)',
  allocation: 't.allocation_date',
  due: 't.due_date',
  deadline: 't.deadline_date',
};

function buildWhere(f: TaskFilters): { clause: string; params: unknown[] } {
  // Seeded rather than appended: a filter is optional, being undeleted is not.
  const conditions: string[] = [LIVE];
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  // Owner or member. A task is filed under one person and listed once, so a
  // collaborator's involvement lives only in task_members — matching user_id
  // alone made their own work invisible in their own view.
  if (f.user) conditions.push(onTask(bind(f.user)));
  if (f.status) conditions.push(`t.status = ${bind(f.status)}`);
  if (f.priority) conditions.push(`t.priority = ${bind(f.priority)}`);

  switch (f.tab) {
    case 'overdue':
      conditions.push(
        IS_OVERDUE,
      );
      break;
    // "All work" is everything, and "Assigned to me" is the person filter above.
    default:
      break;
  }

  return {
    clause: conditions.length ? `where ${conditions.join(' and ')}` : '',
    params,
  };
}

export async function listTasks(filters: TaskFilters): Promise<Task[]> {
  const db = requireSql();
  const { clause, params } = buildWhere(filters);
  const col = SORTABLE[filters.sort ?? ''];
  const dir = filters.dir === 'desc' ? 'desc' : 'asc';
  const order = col
    ? `order by ${col} ${dir} nulls last, t.created_at desc`
    : `order by
         case when t.due_date is null then 1 else 0 end,
         t.due_date asc,
         case t.priority when 'high' then 0 when 'medium' then 1 else 2 end,
         t.created_at desc`;

  const rows = (await db.query(
    `select ${TASK_COLUMNS} ${TASK_JOINS} ${clause} ${order}`,
    params,
  )) as TaskRow[];
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${TASK_COLUMNS} ${TASK_JOINS} where t.id = $1::uuid and ${LIVE}`,
    [id],
  )) as TaskRow[];
  return rows[0] ? toTask(rows[0]) : null;
}

/** One recorded change, flattened for a report rather than a task timeline. */
export interface ChangeRecord {
  id: string;
  day: string;
  at: string;
  actorName: string | null;
  ownerName: string | null;
  title: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Every change recorded through an IST day, across everybody.
 *
 * Deliberately not filtered by `LIVE`. A task that was removed is exactly the
 * one whose history matters most, and its `deleted` entry is the only record
 * that it ever existed.
 *
 * `userId`, `reportTo` and `approverId` store ids, which say nothing in a
 * report, so they are resolved to names here. The lookup is a separate query
 * rather than a join: old_value is free text, and casting it to uuid in SQL
 * fails the whole statement the moment one row holds a title.
 */
export async function listChangesThrough(day: string): Promise<ChangeRecord[]> {
  const db = requireSql();
  const [activity, users] = await Promise.all([
    db.query(
      `select a.id,
              to_char(a.changed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
              to_char(a.changed_at at time zone 'Asia/Kolkata', 'HH24:MI:SS') as at,
              actor.name as actor_name, owner.name as owner_name,
              coalesce(a.task_title, t.title) as title,
              a.field, a.old_value, a.new_value
         from task_activity a
         join tasks t on t.id = a.task_id
         left join users actor on actor.id = a.actor_id
         left join users owner on owner.id = t.user_id
        where (a.changed_at at time zone 'Asia/Kolkata')::date <= $1::date
        order by a.changed_at`,
      [day],
    ),
    db.query(`select id, name from users`),
  ]);
  const rows = activity as Record<string, unknown>[];
  const people = users as { id: string; name: string }[];

  const names = new Map(people.map((p) => [p.id, p.name]));
  const personFields = new Set(['userId', 'reportTo', 'approverId']);
  const label = (field: string, value: unknown) => {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return personFields.has(field) ? (names.get(text) ?? text) : text;
  };

  return rows.map((r) => {
    const field = String(r.field);
    return {
      id: String(r.id),
      day: String(r.day),
      at: String(r.at),
      actorName: (r.actor_name as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      title: String(r.title),
      field,
      oldValue: label(field, r.old_value),
      newValue: label(field, r.new_value),
    };
  });
}

export async function getActivity(taskId: string): Promise<TaskActivity[]> {
  if (!UUID_RE.test(taskId)) return [];
  const db = requireSql();
  const rows = (await db.query(
    `select a.id, a.task_id, a.actor_id, u.name as actor_name,
            a.field, a.old_value, a.new_value, a.changed_at
     from task_activity a
     left join users u on u.id = a.actor_id
     where a.task_id = $1::uuid
     order by a.changed_at desc`,
    [taskId],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    taskId: String(r.task_id),
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    field: String(r.field),
    oldValue: (r.old_value as string | null) ?? null,
    newValue: (r.new_value as string | null) ?? null,
    changedAt: iso(r.changed_at as string | Date) as string,
  }));
}

// ---- Summary / today / at risk ---------------------------------------------

/** Every tab badge in one call, scoped by the same person filter as the table. */
export async function getTabCounts(user?: string | null): Promise<TaskTabCounts> {
  const db = requireSql();
  const who = user && UUID_RE.test(user) ? user : null;
  const rows = (await db.query(
    `select
       count(*) filter (where $1::uuid is null or ${onTask('$1')})::int as all,
       count(*) filter (where $1::uuid is not null and ${onTask('$1')})::int as assigned_to_me,
       count(*) filter (where ($1::uuid is null or ${onTask('$1')})
                          and ${IS_OVERDUE})::int as overdue
     from tasks t
     where ${LIVE}`,
    [who],
  )) as Record<string, number>[];
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return { all: n('all'), assigned_to_me: n('assigned_to_me'), overdue: n('overdue') };
}

/** Date-scoped counts for the header's Today block. */
export async function getToday(user?: string | null): Promise<TodayCounts> {
  const db = requireSql();
  const who = user && UUID_RE.test(user) ? user : null;
  const rows = (await db.query(
    `select
       to_char(${TODAY}, 'YYYY-MM-DD') as date,
       count(*) filter (where t.due_date = ${TODAY} and t.status in ${OPEN})::int as due_today,
       count(*) filter (where ${IS_OVERDUE})::int as overdue
     from tasks t
     where ${LIVE} and ($1::uuid is null or ${onTask('$1')})`,
    [who],
  )) as Record<string, string | number>[];
  const r = rows[0] ?? {};
  return {
    date: String(r.date),
    dueToday: Number(r.due_today ?? 0),
    overdue: Number(r.overdue ?? 0),
  };
}

/**
 * One stand-up row per active person: current open workload and the last time
 * that person identified themselves on a change to work they still carry.
 *
 * Attribution intentionally follows `actor_id`, not merely `tasks.updated_at`.
 * A colleague changing somebody's task means the data moved, but does not
 * answer whether that person is filling in their updates. The actor is still
 * self-declared by the tracker selector: useful workflow evidence, not auth.
 */
export async function getWorkStaleness(staleAfterDays = 1): Promise<WorkStaleness[]> {
  const db = requireSql();
  const threshold = Number.isInteger(staleAfterDays)
    ? Math.min(30, Math.max(0, staleAfterDays))
    : 1;
  const rows = (await db.query(
    `with open_work as (
       select u.id as user_id, t.id as task_id
         from users u
         join tasks t
           on t.deleted_at is null
          and t.status in ${OPEN}
          and (t.user_id = u.id or exists (
            select 1 from task_members m
             where m.task_id = t.id and m.user_id = u.id
          ))
        where u.is_active
     ), freshness as (
       select w.user_id,
              count(distinct w.task_id)::int as open_count,
              max(a.changed_at) filter (where a.actor_id = w.user_id) as last_update_at
         from open_work w
         left join task_activity a on a.task_id = w.task_id
        group by w.user_id
     )
     select u.id as user_id, u.name as user_name,
            coalesce(f.open_count, 0)::int as open_count,
            f.last_update_at,
            case when f.last_update_at is null then null
                 else (${TODAY} - (f.last_update_at at time zone 'Asia/Kolkata')::date)::int
             end as days_since_update
       from users u
       left join freshness f on f.user_id = u.id
      where u.is_active
      order by
        case when coalesce(f.open_count, 0) = 0 then 2
             when f.last_update_at is null then 0 else 1 end,
        days_since_update desc nulls first,
        lower(u.name)`,
  )) as Record<string, unknown>[];

  return rows.map((r) => {
    const openCount = Number(r.open_count ?? 0);
    const daysSinceUpdate =
      r.days_since_update === null || r.days_since_update === undefined
        ? null
        : Number(r.days_since_update);
    return {
      userId: String(r.user_id),
      userName: String(r.user_name),
      openCount,
      lastUpdateAt: iso((r.last_update_at as string | Date | null) ?? null),
      daysSinceUpdate,
      isStale:
        openCount > 0 && (daysSinceUpdate === null || daysSinceUpdate > threshold),
    };
  });
}

/** Deadline within three days and still live — the At risk block. */
export async function getAtRisk(
  user?: string | null,
  /** How many days ahead counts as at risk. Was a literal 3 in this query. */
  withinDays = 3,
): Promise<AtRiskTask[]> {
  const db = requireSql();
  const who = user && UUID_RE.test(user) ? user : null;
  // Clamped rather than trusted: this reaches SQL, and a settings row restored
  // from an older dump could hold anything.
  const days = Number.isInteger(withinDays)
    ? Math.min(30, Math.max(1, withinDays))
    : 3;
  const rows = (await db.query(
    `select t.id, t.title, uo.name as user_name,
            to_char(t.deadline_date, 'YYYY-MM-DD') as deadline_date
     from tasks t join users uo on uo.id = t.user_id
     where ${LIVE}
       and t.deadline_date is not null
       and t.deadline_date between ${TODAY} and ${TODAY} + ${days}
       and t.status in ${OPEN}
       and ($1::uuid is null or ${onTask('$1')})
     order by t.deadline_date asc, t.title asc`,
    [who],
  )) as Record<string, string>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    userName: String(r.user_name),
    deadlineDate: String(r.deadline_date),
  }));
}

// ---- Writes ----------------------------------------------------------------

export interface TaskWriteInput {
  userId: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  allocationDate?: string | null;
  dueDate?: string | null;
  deadlineDate?: string | null;
  reportTo?: string | null;
  approverId?: string | null;
  percentage?: number | null;
}

async function recordActivity(
  taskId: string,
  actorId: string | null,
  changes: { field: string; oldValue: unknown; newValue: unknown }[],
): Promise<void> {
  if (changes.length === 0) return;
  const db = requireSql();
  const params: unknown[] = [taskId, actorId && UUID_RE.test(actorId) ? actorId : null];
  const tuples = changes.map((c) => {
    const start = params.length;
    params.push(
      c.field,
      c.oldValue == null ? null : String(c.oldValue),
      c.newValue == null ? null : String(c.newValue),
    );
    // The title is read from the task rather than passed in, so it is right for
    // every caller without any of them having to remember. Soft delete is what
    // makes this safe: the row is still there when its own removal is logged.
    return `($1::uuid, $2::uuid, $${start + 1}, $${start + 2}, $${start + 3},
             (select title from tasks where id = $1::uuid))`;
  });
  await db.query(
    `insert into task_activity
       (task_id, actor_id, field, old_value, new_value, task_title)
     values ${tuples.join(', ')}`,
    params,
  );
}

export async function createTask(
  input: TaskWriteInput,
  actorId: string | null,
): Promise<Task> {
  await requireUser(input.userId, 'assignee');
  const db = requireSql();

  // Reports to and Approver are left blank unless the caller sets them. They
  // used to be pre-filled from the assignee's line manager, but people choose
  // both per task, and a guessed value that nobody picked is worse than an
  // empty cell — it looks decided.
  const rows = (await db.query(
    `insert into tasks
       (user_id, title, priority, status, allocation_date, due_date,
        deadline_date, report_to, approver_id, percentage, completed_at)
     values ($1::uuid, $2, $3, $4, coalesce($5::date, ${TODAY}), $6::date,
             $7::date, $8::uuid, $9::uuid, $10::smallint,
             case when $4 = 'completed' then now() end)
     returning id`,
    [
      input.userId,
      input.title.trim(),
      input.priority,
      input.status,
      input.allocationDate ?? null,
      input.dueDate ?? null,
      input.deadlineDate ?? null,
      input.reportTo ?? null,
      input.approverId ?? null,
      input.percentage ?? null,
    ],
  )) as { id: string }[];

  await recordActivity(rows[0].id, actorId, [
    { field: 'created', oldValue: null, newValue: input.title.trim() },
  ]);

  const created = await getTask(rows[0].id);
  if (!created) throw new Error('Task vanished immediately after insert');
  return created;
}

const PATCHABLE: Record<string, string> = {
  userId: 'user_id',
  title: 'title',
  priority: 'priority',
  status: 'status',
  allocationDate: 'allocation_date',
  dueDate: 'due_date',
  deadlineDate: 'deadline_date',
  reportTo: 'report_to',
  approverId: 'approver_id',
  percentage: 'percentage',
};

const CASTS: Record<string, string> = {
  user_id: '::uuid',
  report_to: '::uuid',
  approver_id: '::uuid',
  allocation_date: '::date',
  due_date: '::date',
  deadline_date: '::date',
  percentage: '::smallint',
};

export type TaskPatch = Partial<TaskWriteInput>;

export async function updateTask(
  id: string,
  patch: TaskPatch,
  actorId: string | null,
): Promise<Task | null> {
  const existing = await getTask(id);
  if (!existing) return null;
  const db = requireSql();

  const status = (patch.status ?? existing.status) as TaskStatus;

  if (patch.userId !== undefined && patch.userId)
    await requireUser(patch.userId, 'assignee');

  const sets: string[] = [];
  const params: unknown[] = [];
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];

  for (const [key, column] of Object.entries(PATCHABLE)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const next = key === 'title' ? String(value).trim() : (value ?? null);
    const prev = (existing as unknown as Record<string, unknown>)[key] ?? null;
    if (String(prev ?? '') === String(next ?? '')) continue;
    params.push(next === '' ? null : next);
    sets.push(`${column} = $${params.length}${CASTS[column] ?? ''}`);
    changes.push({ field: key, oldValue: prev, newValue: next });
  }

  // completed_at is derived from status, never sent by the client. Approval is
  // a separate action, so leaving `completed` also drops any approval — work
  // that is no longer finished cannot stay signed off.
  if (patch.status !== undefined && patch.status !== existing.status) {
    if (status === 'completed') {
      sets.push('completed_at = coalesce(completed_at, now())');
    } else {
      sets.push('completed_at = null');
      if (existing.approvedAt) {
        sets.push('approved_at = null');
        changes.push({ field: 'approval', oldValue: 'approved', newValue: null });
      }
    }
  }

  if (sets.length === 0) return existing;

  params.push(id);
  const rows = (await db.query(
    `update tasks set ${sets.join(', ')} where id = $${params.length}::uuid returning id`,
    params,
  )) as { id: string }[];
  if (!rows[0]) return null;

  await recordActivity(id, actorId, changes);
  return getTask(id);
}

/**
 * Approval, which is an action rather than a status.
 *
 * Only the task's own approver may sign work off, and only once it is actually
 * completed. The UI disables the menu item, but a disabled item is not a
 * boundary, so the rule is enforced here.
 */
export async function approveTask(
  id: string,
  actorId: string | null,
): Promise<Task | null> {
  const existing = await getTask(id);
  if (!existing) return null;
  const db = requireSql();

  if (existing.status !== 'completed') {
    throw new TrackerError('Only completed work can be approved', 422);
  }
  if (!existing.approverId) {
    throw new TrackerError('This task has no approver set', 422);
  }
  if (!actorId || actorId !== existing.approverId) {
    throw new TrackerError(
      `Only ${existing.approverName ?? 'the approver'} can approve this task`,
      403,
    );
  }
  if (existing.approvedAt) return existing;

  await db.query(
    `update tasks set approved_at = now() where id = $1::uuid`,
    [id],
  );
  await recordActivity(id, actorId, [
    { field: 'approval', oldValue: null, newValue: 'approved' },
  ]);
  return getTask(id);
}

/**
 * Hides a task instead of destroying it.
 *
 * Removing work used to delete the row, and task_activity cascades, so the
 * history went with it — nothing was left to say the task had existed or who
 * removed it. That is inconsistent with a table where changing one filled field
 * needs the admin passcode. Now the row stays, every read filters it out, and
 * restoreTask can put it back.
 */
export async function deleteTask(
  id: string,
  actorId: string | null,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  const rows = (await db.query(
    `update tasks set deleted_at = now()
      where id = $1::uuid and deleted_at is null
      returning id, title`,
    [id],
  )) as { id: string; title: string }[];
  if (!rows[0]) return false;
  await recordActivity(id, actorId, [
    { field: 'deleted', oldValue: rows[0].title, newValue: null },
  ]);
  return true;
}

/**
 * How much work each person is carrying, for the Settings roster.
 *
 * Counts the live rows only. Removed work is not somebody's workload, and
 * offering to "delete all 12" when 8 of them are already gone would be a lie
 * about what the button does.
 *
 * Owner-only, deliberately, unlike the tracker's person filter. This number
 * sits next to "Clear", which deletes what it counts — and clearing somebody's
 * workload must not delete a task that belongs to a colleague and merely has
 * them on it.
 */
export async function taskCountsByUser(): Promise<Record<string, number>> {
  const db = requireSql();
  const rows = (await db.query(
    `select t.user_id, count(*)::int as n
       from tasks t
      where ${LIVE}
      group by t.user_id`,
  )) as { user_id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.user_id, r.n]));
}

/**
 * Removes every live task belonging to one person, in one go.
 *
 * Hides rather than destroys, exactly like removing one task, so a bulk clear
 * made in error is as recoverable as a single one — which matters more here,
 * not less, because the mistake is larger.
 */
export async function deleteTasksForUser(
  userId: string,
  actorId: string | null,
): Promise<number> {
  if (!UUID_RE.test(userId)) return 0;
  const db = requireSql();
  const rows = (await db.query(
    `update tasks set deleted_at = now()
      where user_id = $1::uuid and deleted_at is null
      returning id, title`,
    [userId],
  )) as { id: string; title: string }[];

  for (const r of rows) {
    await recordActivity(r.id, actorId, [
      { field: 'deleted', oldValue: r.title, newValue: null },
    ]);
  }
  return rows.length;
}

/** Puts back everything removed from one person in the last few minutes. */
export async function restoreTasksForUser(
  userId: string,
  since: Date,
  actorId: string | null,
): Promise<number> {
  if (!UUID_RE.test(userId)) return 0;
  const db = requireSql();
  const rows = (await db.query(
    `update tasks set deleted_at = null
      where user_id = $1::uuid and deleted_at is not null and deleted_at >= $2
      returning id, title`,
    [userId, since.toISOString()],
  )) as { id: string; title: string }[];
  for (const r of rows) {
    await recordActivity(r.id, actorId, [
      { field: 'restored', oldValue: null, newValue: r.title },
    ]);
  }
  return rows.length;
}

/**
 * Replaces the set of people working on a task alongside its owner.
 *
 * Whole-set rather than add/remove one at a time: the UI presents it as a list
 * of ticks, so sending the resulting list is what it actually knows. It also
 * makes the operation idempotent — sending the same set twice changes nothing,
 * where a sequence of adds and removes could half-apply.
 *
 * The owner is never stored here. They are `tasks.user_id`, and duplicating
 * them would make "how many people" ambiguous depending on which you counted.
 */
export async function setTaskMembers(
  taskId: string,
  userIds: string[],
  actorId: string | null,
): Promise<Task | null> {
  const existing = await getTask(taskId);
  if (!existing) return null;
  const db = requireSql();

  // Anyone unknown, inactive, or the owner themselves is dropped rather than
  // rejected: the caller sent a set, and silently ignoring a member who cannot
  // be one is kinder than refusing the whole change over a stale checkbox.
  const wanted = [...new Set(userIds.filter((id) => UUID_RE.test(id) && id !== existing.userId))];
  const valid = wanted.length
    ? ((await db.query(
        `select id from users where id = any($1::uuid[]) and is_active`,
        [wanted],
      )) as { id: string }[]).map((r) => r.id)
    : [];

  await db.query(`delete from task_members where task_id = $1::uuid`, [taskId]);
  if (valid.length) {
    const tuples = valid.map((_, i) => `($1::uuid, $${i + 2}::uuid)`).join(', ');
    await db.query(
      `insert into task_members (task_id, user_id) values ${tuples}`,
      [taskId, ...valid],
    );
  }

  const before = existing.members.map((m) => m.name).sort().join(', ');
  const after = (await getTask(taskId))?.members.map((m) => m.name).sort().join(', ') ?? '';
  if (before !== after) {
    await recordActivity(taskId, actorId, [
      { field: 'members', oldValue: before || null, newValue: after || null },
    ]);
  }
  return getTask(taskId);
}

/** Puts back a task that was removed. Undo, and the reason hiding beats deleting. */
export async function restoreTask(
  id: string,
  actorId: string | null,
): Promise<Task | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `update tasks set deleted_at = null
      where id = $1::uuid and deleted_at is not null
      returning id, title`,
    [id],
  )) as { id: string; title: string }[];
  if (!rows[0]) return null;
  await recordActivity(id, actorId, [
    { field: 'restored', oldValue: null, newValue: rows[0].title },
  ]);
  return getTask(id);
}

// ---- User management -------------------------------------------------------

export interface UserWriteInput {
  name: string;
  email?: string | null;
  designation?: string | null;
  department?: string | null;
  reportsTo?: string | null;
  canBeReportedTo?: boolean;
  canApprove?: boolean;
  role?: 'ADMIN' | 'MEMBER';
  isActive?: boolean;
  colour?: string | null;
}

/**
 * Would setting `reports_to` create a loop?
 *
 * Walks the proposed manager's own reporting chain: if the user appears
 * anywhere in it, the change would close a cycle. Recursion is bounded by the
 * chain itself, and Postgres stops a genuine loop rather than spinning.
 */
async function wouldCycle(userId: string, managerId: string): Promise<boolean> {
  if (userId === managerId) return true;
  const db = requireSql();
  const rows = (await db.query(
    `with recursive chain as (
       select id, reports_to from users where id = $2::uuid
       union
       select u.id, u.reports_to from users u join chain c on u.id = c.reports_to
     )
     select exists (select 1 from chain where id = $1::uuid) as loops`,
    [userId, managerId],
  )) as { loops: boolean }[];
  return Boolean(rows[0]?.loops);
}

export async function createUser(input: UserWriteInput): Promise<User> {
  const db = requireSql();
  const name = input.name.trim();
  if (!name) throw new TrackerError('A name is required', 422);
  if (input.reportsTo) await requireUser(input.reportsTo, 'manager');

  try {
    const rows = (await db.query(
      `insert into users (name, email, designation, department, reports_to, role, is_active)
       values ($1, $2, $3, $4, $5::uuid, coalesce($6, 'MEMBER'), coalesce($7, true))
       returning id`,
      [
        name,
        blank(input.email),
        blank(input.designation),
        blank(input.department),
        input.reportsTo ?? null,
        input.role ?? null,
        input.isActive ?? null,
      ],
    )) as { id: string }[];
    const created = await getUser(rows[0].id);
    if (!created) throw new Error('User vanished immediately after insert');
    return created;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new TrackerError('That name or email is already taken', 409);
    }
    throw err;
  }
}

export async function updateUser(
  id: string,
  patch: Partial<UserWriteInput>,
): Promise<User | null> {
  if (!UUID_RE.test(id)) return null;
  const existing = await getUser(id);
  if (!existing) return null;
  const db = requireSql();

  if (patch.reportsTo !== undefined && patch.reportsTo) {
    if (patch.reportsTo === id) {
      throw new TrackerError('Somebody cannot report to themselves', 422);
    }
    await requireUser(patch.reportsTo, 'manager');
    if (await wouldCycle(id, patch.reportsTo)) {
      const manager = await getUser(patch.reportsTo);
      throw new TrackerError(
        `That would make a loop: ${manager?.name ?? 'that person'} already reports up to ${existing.name}.`,
        422,
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const changes: { field: string; oldValue: unknown; newValue: unknown }[] = [];
  const set = (column: string, key: string, value: unknown, cast = '') => {
    const prev = (existing as unknown as Record<string, unknown>)[key] ?? null;
    if (String(prev ?? '') === String(value ?? '')) return;
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
    changes.push({ field: key, oldValue: prev, newValue: value });
  };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new TrackerError('A name cannot be blank', 422);
    set('name', 'name', name);
  }
  if (patch.email !== undefined) set('email', 'email', blank(patch.email));
  if (patch.designation !== undefined)
    set('designation', 'designation', blank(patch.designation));
  if (patch.department !== undefined)
    set('department', 'department', blank(patch.department));
  if (patch.reportsTo !== undefined)
    set('reports_to', 'reportsTo', patch.reportsTo ?? null, '::uuid');
  if (patch.role !== undefined) set('role', 'role', patch.role);
  if (patch.isActive !== undefined) set('is_active', 'isActive', Boolean(patch.isActive));
  if (patch.canBeReportedTo !== undefined)
    set('can_be_reported_to', 'canBeReportedTo', Boolean(patch.canBeReportedTo));
  if (patch.canApprove !== undefined)
    set('can_approve', 'canApprove', Boolean(patch.canApprove));
  if (patch.colour !== undefined) set('colour', 'colour', blank(patch.colour));

  if (sets.length === 0) return existing;

  sets.push('updated_at = now()');
  params.push(id);
  try {
    const rows = (await db.query(
      `update users set ${sets.join(', ')} where id = $${params.length}::uuid returning id`,
      params,
    )) as { id: string }[];
    if (!rows[0]) return null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new TrackerError('That name or email is already taken', 409);
    }
    throw err;
  }

  // User changes are logged the same way task changes are. There is no user_id
  // column on task_activity, so they are filed against no task and identified
  // by the field prefix.
  if (changes.length > 0) {
    const db2 = requireSql();
    const params2: unknown[] = [];
    const tuples = changes.map((c) => {
      const start = params2.length;
      params2.push(
        `user.${c.field}`,
        c.oldValue == null ? null : String(c.oldValue),
        c.newValue == null ? null : String(c.newValue),
        id,
      );
      return `($${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}::uuid)`;
    });
    await db2
      .query(
        `insert into user_activity (field, old_value, new_value, user_id)
         values ${tuples.join(', ')}`,
        params2,
      )
      .catch(() => {
        /* the log is best-effort; a failure here must not lose the edit */
      });
  }

  return getUser(id);
}

/**
 * Deactivate, never delete.
 *
 * Deleting orphans every task, reports_to link and approver reference the
 * person appears on. Deactivated people vanish from the pickers while their
 * work stays intact and readable.
 */
export async function deactivateUser(id: string): Promise<User | null> {
  return updateUser(id, { isActive: false });
}
