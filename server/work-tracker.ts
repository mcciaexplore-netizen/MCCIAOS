// Work Tracker data access.
//
// SCHEMA NOTE. Backed by its own tables (db/work-tracker.sql) rather than the
// generic `records` store, and therefore requires the Postgres backend — it
// reports NO_SQL_MESSAGE when DATABASE_URL is unset.
//
// ONE TABLE FOR THE WHOLE TEAM. `tasks` is filtered by assignee_id; there is no
// table, schema or database per user. The user dropdown is a filter. Splitting
// per user would make the team view, the overdue report and the workload
// summary impossible to build.
//
// TIMEZONE. Dates are Asia/Kolkata calendar days, matching the rest of the app:
// `(now() at time zone 'Asia/Kolkata')::date` in SQL, src/lib/ist.ts in TS.

import { requireSql } from './sql.js';
import type {
  CollaboratorRole,
  SharedTask,
  Task,
  TaskActivity,
  TaskCollaborator,
  TaskPriority,
  TaskStatus,
  TaskTabCounts,
  TodayCounts,
  User,
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

/** The IST calendar day, as SQL. Used for every "today" comparison. */
const TODAY = `(now() at time zone 'Asia/Kolkata')::date`;

// ---- Row shapes ------------------------------------------------------------

interface TaskRow {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_id: string;
  assignee_name: string;
  allocated_by: string | null;
  allocated_by_name: string | null;
  report_to: string | null;
  report_to_name: string | null;
  approver_id: string | null;
  approver_name: string | null;
  allocated_at: string | Date;
  due_date: string | null;
  deadline: string | null;
  completed_at: string | Date | null;
  approved_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  is_overdue: boolean;
  days_left: number | null;
  at_risk: boolean;
  collaborators: TaskCollaborator[] | null;
}

// Dates are rendered to text in Postgres rather than left to the driver's type
// parser: a `date` parsed into a JS Date materialises at the server's own
// midnight and shifts the calendar day either side of UTC.
//
// is_overdue / days_left / at_risk are computed here, never stored, so they
// cannot go stale between the write and the read.
const TASK_COLUMNS = `
  t.id, t.ref, t.title, t.description, t.status, t.priority,
  t.assignee_id, ua.name as assignee_name,
  t.allocated_by, ub.name as allocated_by_name,
  t.report_to,   ur.name as report_to_name,
  t.approver_id, uv.name as approver_name,
  t.allocated_at,
  to_char(t.due_date, 'YYYY-MM-DD') as due_date,
  to_char(t.deadline, 'YYYY-MM-DD') as deadline,
  t.completed_at, t.approved_at, t.created_at, t.updated_at,
  (t.due_date is not null
    and t.due_date < ${TODAY}
    and t.status not in ('approved','completed'))            as is_overdue,
  (t.due_date - ${TODAY})                                     as days_left,
  (t.due_date is not null
    and (t.due_date - ${TODAY}) between 0 and 2
    and t.status in ('not_started','blocked'))                as at_risk,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'taskId',        c.task_id,
      'userId',        c.user_id,
      'userName',      uc.name,
      'role',          c.role,
      'memberDueDate', to_char(c.member_due_date, 'YYYY-MM-DD'),
      'allocatedAt',   c.allocated_at
    ) order by uc.name)
    from task_collaborators c
    join users uc on uc.id = c.user_id
    where c.task_id = t.id
  ), '[]'::jsonb) as collaborators
`;

const TASK_JOINS = `
  from tasks t
  join users ua on ua.id = t.assignee_id
  left join users ub on ub.id = t.allocated_by
  left join users ur on ur.id = t.report_to
  left join users uv on uv.id = t.approver_id
`;

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    allocatedBy: row.allocated_by,
    allocatedByName: row.allocated_by_name,
    reportTo: row.report_to,
    reportToName: row.report_to_name,
    approverId: row.approver_id,
    approverName: row.approver_name,
    allocatedAt: iso(row.allocated_at) as string,
    dueDate: row.due_date,
    deadline: row.deadline,
    completedAt: iso(row.completed_at),
    approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
    collaborators: (row.collaborators ?? []).map((c) => ({
      ...c,
      allocatedAt: iso(c.allocatedAt as unknown as string) as string,
    })),
    isOverdue: Boolean(row.is_overdue),
    daysLeft: row.days_left == null ? null : Number(row.days_left),
    atRisk: Boolean(row.at_risk),
  };
}

// ---- Users -----------------------------------------------------------------

export async function listUsers(includeInactive = false): Promise<User[]> {
  const db = requireSql();
  const rows = (await db.query(
    `select id, name, email, role, designation, department, reports_to,
            avatar_url, is_active
     from users ${includeInactive ? '' : 'where is_active'}
     order by name asc`,
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    email: (r.email as string | null) ?? null,
    role: (r.role as User['role']) ?? 'MEMBER',
    designation: (r.designation as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    reportsTo: (r.reports_to as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    isActive: Boolean(r.is_active),
  }));
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
  assignee?: string | null;
  status?: string | null;
  priority?: string | null;
  overdue?: boolean;
  tab?: string | null;
}

/**
 * Builds the WHERE clause. Every value is bound as a parameter — no caller
 * input is ever concatenated into the SQL text.
 */
function buildWhere(f: TaskFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  // A person's list is everything they own OR collaborate on — except on the
  // "Assigned to me" tab, which is deliberately ownership only.
  if (f.assignee) {
    const p = bind(f.assignee);
    conditions.push(
      f.tab === 'assigned_to_me'
        ? `t.assignee_id = ${p}::uuid`
        : `(t.assignee_id = ${p}::uuid
            or exists (select 1 from task_collaborators c
                        where c.task_id = t.id and c.user_id = ${p}::uuid))`,
    );
  }
  if (f.status) conditions.push(`t.status = ${bind(f.status)}`);
  if (f.priority) conditions.push(`t.priority = ${bind(f.priority)}`);
  if (f.overdue) {
    conditions.push(
      `t.due_date is not null and t.due_date < ${TODAY}
       and t.status not in ('approved','completed')`,
    );
  }

  switch (f.tab) {
    case 'all':
      conditions.push(`t.status <> 'completed'`);
      break;
    case 'assigned_to_me':
      // The assignee filter above already narrowed to ownership.
      conditions.push(`t.status <> 'completed'`);
      break;
    case 'due_soon':
      conditions.push(
        `t.due_date is not null and (t.due_date - ${TODAY}) between 0 and 3
         and t.status not in ('approved','completed')`,
      );
      break;
    case 'overdue':
      conditions.push(
        `t.due_date is not null and t.due_date < ${TODAY}
         and t.status not in ('approved','completed')`,
      );
      break;
    case 'completed':
      conditions.push(`t.status in ('approved','completed')`);
      break;
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
  const rows = (await db.query(
    `select ${TASK_COLUMNS} ${TASK_JOINS} ${clause}
     order by
       case when t.due_date is null then 1 else 0 end,
       t.due_date asc,
       case t.priority when 'critical' then 0 when 'high' then 1
                       when 'medium' then 2 else 3 end,
       t.created_at desc`,
    params,
  )) as TaskRow[];
  return rows.map(toTask);
}

export async function getTask(id: string): Promise<Task | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${TASK_COLUMNS} ${TASK_JOINS} where t.id = $1::uuid`,
    [id],
  )) as TaskRow[];
  return rows[0] ? toTask(rows[0]) : null;
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

// ---- Summary / today / shared ----------------------------------------------

/**
 * Counts for every tab in one call, so five badges need one request.
 *
 * Scoped by the same person filter the table uses, otherwise a badge would
 * promise rows the filtered table does not show. `assigned_to_me` is ownership
 * only; every other count includes tasks the person collaborates on. With no
 * person selected ("All team") assigned_to_me is 0 and the UI hides that tab.
 */
export async function getTabCounts(assignee?: string | null): Promise<TaskTabCounts> {
  const db = requireSql();
  const who = assignee && UUID_RE.test(assignee) ? assignee : null;
  const rows = (await db.query(
    `with scoped as (
       select t.* from tasks t
       where $1::uuid is null
          or t.assignee_id = $1::uuid
          or exists (select 1 from task_collaborators c
                      where c.task_id = t.id and c.user_id = $1::uuid)
     )
     select
       count(*) filter (where status <> 'completed')::int as all,
       count(*) filter (where status <> 'completed'
                          and $1::uuid is not null
                          and assignee_id = $1::uuid)::int as assigned_to_me,
       count(*) filter (where due_date is not null
                          and (due_date - ${TODAY}) between 0 and 3
                          and status not in ('approved','completed'))::int as due_soon,
       count(*) filter (where due_date is not null and due_date < ${TODAY}
                          and status not in ('approved','completed'))::int as overdue,
       count(*) filter (where status in ('approved','completed'))::int as completed
     from scoped`,
    [who],
  )) as Record<string, number>[];
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    all: n('all'),
    assigned_to_me: n('assigned_to_me'),
    due_soon: n('due_soon'),
    overdue: n('overdue'),
    completed: n('completed'),
  };
}

/** Date-scoped counts for the header's Today block, optionally per person. */
export async function getToday(assignee?: string | null): Promise<TodayCounts> {
  const db = requireSql();
  const who = assignee && UUID_RE.test(assignee) ? assignee : null;
  const rows = (await db.query(
    `select
       to_char(${TODAY}, 'YYYY-MM-DD') as date,
       count(*) filter (where due_date = ${TODAY}
                          and status not in ('approved','completed'))::int as due_today,
       count(*) filter (where due_date is not null and due_date < ${TODAY}
                          and status not in ('approved','completed'))::int as overdue,
       count(*) filter (where (completed_at at time zone 'Asia/Kolkata')::date = ${TODAY})::int
         as completed_today
     from tasks t
     where $1::uuid is null
        or t.assignee_id = $1::uuid
        or exists (select 1 from task_collaborators c
                    where c.task_id = t.id and c.user_id = $1::uuid)`,
    [who],
  )) as Record<string, string | number>[];
  const r = rows[0] ?? {};
  return {
    date: String(r.date),
    dueToday: Number(r.due_today ?? 0),
    overdue: Number(r.overdue ?? 0),
    completedToday: Number(r.completed_today ?? 0),
  };
}

/** Tasks with two or more people on them, for the Working together block. */
export async function getShared(assignee?: string | null): Promise<SharedTask[]> {
  const db = requireSql();
  const who = assignee && UUID_RE.test(assignee) ? assignee : null;
  const rows = (await db.query(
    `select t.id, t.ref, t.title,
            jsonb_agg(distinct jsonb_build_object('id', p.id, 'name', p.name)) as people
     from tasks t
     join lateral (
       select ua.id, ua.name from users ua where ua.id = t.assignee_id
       union
       select uc.id, uc.name from task_collaborators c
         join users uc on uc.id = c.user_id where c.task_id = t.id
     ) p on true
     where t.status not in ('approved','completed')
       and exists (select 1 from task_collaborators c2 where c2.task_id = t.id)
       and ($1::uuid is null
            or t.assignee_id = $1::uuid
            or exists (select 1 from task_collaborators c3
                        where c3.task_id = t.id and c3.user_id = $1::uuid))
     group by t.id, t.ref, t.title
     order by t.due_date asc nulls last, t.ref asc`,
    [who],
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    ref: String(r.ref),
    title: String(r.title),
    people: (r.people as { id: string; name: string }[]) ?? [],
  }));
}

// ---- Writes ----------------------------------------------------------------

export interface TaskWriteInput {
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  allocatedBy?: string | null;
  reportTo?: string | null;
  approverId?: string | null;
  allocatedAt?: string | null;
  dueDate?: string | null;
  deadline?: string | null;
}

/** Writes one row per changed field. The audit trail is append-only. */
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
    params.push(c.field, c.oldValue == null ? null : String(c.oldValue),
                c.newValue == null ? null : String(c.newValue));
    return `($1::uuid, $2::uuid, $${start + 1}, $${start + 2}, $${start + 3})`;
  });
  await db.query(
    `insert into task_activity (task_id, actor_id, field, old_value, new_value)
     values ${tuples.join(', ')}`,
    params,
  );
}

export async function createTask(
  input: TaskWriteInput,
  actorId: string | null,
): Promise<Task> {
  await requireUser(input.assigneeId, 'assignee');
  const db = requireSql();

  const rows = (await db.query(
    `insert into tasks
       (title, description, status, priority, assignee_id, allocated_by,
        report_to, approver_id, allocated_at, due_date, deadline,
        completed_at, approved_at)
     values ($1, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
             coalesce($9::timestamptz, now()), $10::date, $11::date,
             case when $3 in ('submitted','approved','completed') then now() end,
             case when $3 in ('approved','completed') then now() end)
     returning id`,
    [
      input.title.trim(),
      blank(input.description),
      input.status,
      input.priority,
      input.assigneeId,
      input.allocatedBy ?? null,
      input.reportTo ?? null,
      input.approverId ?? null,
      input.allocatedAt ?? null,
      input.dueDate ?? null,
      input.deadline ?? null,
    ],
  )) as { id: string }[];

  await recordActivity(rows[0].id, actorId, [
    { field: 'created', oldValue: null, newValue: input.title.trim() },
  ]);

  const created = await getTask(rows[0].id);
  if (!created) throw new Error('Task vanished immediately after insert');
  return created;
}

/** Fields a PATCH may touch, mapped to their column. */
const PATCHABLE: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  allocatedBy: 'allocated_by',
  reportTo: 'report_to',
  approverId: 'approver_id',
  allocatedAt: 'allocated_at',
  dueDate: 'due_date',
  deadline: 'deadline',
};

const CASTS: Record<string, string> = {
  assignee_id: '::uuid',
  allocated_by: '::uuid',
  report_to: '::uuid',
  approver_id: '::uuid',
  allocated_at: '::timestamptz',
  due_date: '::date',
  deadline: '::date',
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
  const dueDate = patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
  const deadline = patch.deadline !== undefined ? patch.deadline : existing.deadline;

  // Re-checked on the merged row: a one-field PATCH cannot be judged alone.
  if (dueDate && deadline && deadline < dueDate) {
    throw new TrackerError('Deadline cannot be earlier than the due date', 422);
  }

  // Only the task's approver may approve it. The UI disables the option, but
  // the rule is enforced here too — a disabled <option> is not a boundary.
  if (status === 'approved' && existing.status !== 'approved') {
    if (!existing.approverId) {
      throw new TrackerError('This task has no approver set', 422);
    }
    if (!actorId || actorId !== existing.approverId) {
      throw new TrackerError(
        `Only ${existing.approverName ?? 'the approver'} can approve this task`,
        403,
      );
    }
  }

  if (patch.assigneeId !== undefined && patch.assigneeId)
    await requireUser(patch.assigneeId, 'assignee');

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

  // completed_at and approved_at are derived from status, never sent by the
  // client. Stamped on the way in, cleared on the way out — which also keeps
  // the tasks_approved_at_matches_status constraint satisfied.
  if (patch.status !== undefined && patch.status !== existing.status) {
    sets.push(
      status === 'submitted' || status === 'approved' || status === 'completed'
        ? 'completed_at = coalesce(completed_at, now())'
        : 'completed_at = null',
    );
    sets.push(
      status === 'approved' || status === 'completed'
        ? 'approved_at = coalesce(approved_at, now())'
        : 'approved_at = null',
    );
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

export async function deleteTask(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  // Collaborators and activity cascade with the task.
  const rows = (await db.query(
    `delete from tasks where id = $1::uuid returning id`,
    [id],
  )) as { id: string }[];
  return rows.length > 0;
}

// ---- Collaborators ---------------------------------------------------------

export async function addCollaborator(
  taskId: string,
  input: { userId: string; role: CollaboratorRole; memberDueDate?: string | null },
  actorId: string | null,
): Promise<Task | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  await requireUser(input.userId, 'collaborator');
  if (input.userId === task.assigneeId) {
    throw new TrackerError('That person already owns this task', 422);
  }
  const db = requireSql();
  const rows = (await db.query(
    `insert into task_collaborators (task_id, user_id, role, member_due_date)
     values ($1::uuid, $2::uuid, $3, $4::date)
     on conflict (task_id, user_id) do nothing
     returning user_id`,
    [taskId, input.userId, input.role, input.memberDueDate ?? null],
  )) as { user_id: string }[];
  if (rows.length === 0) {
    throw new TrackerError('That person is already on this task', 409);
  }
  await recordActivity(taskId, actorId, [
    { field: 'collaborator_added', oldValue: null, newValue: input.userId },
  ]);
  return getTask(taskId);
}

export async function updateCollaborator(
  taskId: string,
  userId: string,
  patch: { role?: CollaboratorRole; memberDueDate?: string | null },
  actorId: string | null,
): Promise<Task | null> {
  if (!UUID_RE.test(taskId) || !UUID_RE.test(userId)) return null;
  const db = requireSql();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.role !== undefined) {
    params.push(patch.role);
    sets.push(`role = $${params.length}`);
  }
  if (patch.memberDueDate !== undefined) {
    params.push(patch.memberDueDate ?? null);
    sets.push(`member_due_date = $${params.length}::date`);
  }
  if (sets.length === 0) return getTask(taskId);

  params.push(taskId, userId);
  const rows = (await db.query(
    `update task_collaborators set ${sets.join(', ')}
     where task_id = $${params.length - 1}::uuid and user_id = $${params.length}::uuid
     returning user_id`,
    params,
  )) as { user_id: string }[];
  if (!rows[0]) return null;
  await recordActivity(taskId, actorId, [
    { field: 'collaborator_updated', oldValue: userId, newValue: JSON.stringify(patch) },
  ]);
  return getTask(taskId);
}

export async function removeCollaborator(
  taskId: string,
  userId: string,
  actorId: string | null,
): Promise<Task | null> {
  if (!UUID_RE.test(taskId) || !UUID_RE.test(userId)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `delete from task_collaborators
     where task_id = $1::uuid and user_id = $2::uuid returning user_id`,
    [taskId, userId],
  )) as { user_id: string }[];
  if (!rows[0]) return null;
  await recordActivity(taskId, actorId, [
    { field: 'collaborator_removed', oldValue: userId, newValue: null },
  ]);
  return getTask(taskId);
}
