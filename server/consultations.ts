/**
 * Consultations: their own records, deliberately not part of a task.
 *
 * NOT FROZEN. Every write here is open, unlike `tasks` where changing a filled
 * field needs the admin passcode. These are running tallies that the person who
 * took the consultation updates through the day; asking for a passcode to
 * correct a count would only teach everyone to leave the app unlocked.
 *
 * Removal still hides rather than destroys, so a mis-click is recoverable even
 * without a passcode standing in front of it.
 */
import { requireSql } from './sql.js';
import type { Consultation } from '../src/types/index.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hidden rows are gone from every read; see db/consultations.sql. */
const LIVE = `c.deleted_at is null`;

const COLUMNS = `
  c.id,
  c.title,
  c.user_id,
  u.name as user_name,
  to_char(c.held_on, 'YYYY-MM-DD') as held_on,
  to_char(c.held_at, 'HH24:MI')    as held_at,
  c.allocated,
  c.completed,
  c.created_at,
  c.updated_at
`;

const JOINS = `from consultations c join users u on u.id = c.user_id`;

interface Row {
  id: string;
  title: string;
  user_id: string;
  user_name: string;
  held_on: string | null;
  held_at: string | null;
  allocated: number | null;
  completed: number | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toConsultation(row: Row): Consultation {
  return {
    id: row.id,
    title: row.title,
    userId: row.user_id,
    userName: row.user_name,
    heldOn: row.held_on,
    heldAt: row.held_at,
    allocated: row.allocated,
    completed: row.completed,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export interface ConsultationFilters {
  user?: string | null;
}

export async function listConsultations(
  filters: ConsultationFilters = {},
): Promise<Consultation[]> {
  const db = requireSql();
  const who = filters.user && UUID_RE.test(filters.user) ? filters.user : null;
  const rows = (await db.query(
    `select ${COLUMNS} ${JOINS}
      where ${LIVE} and ($1::uuid is null or c.user_id = $1::uuid)
      order by c.held_on desc nulls last, c.held_at desc nulls last, c.created_at desc`,
    [who],
  )) as Row[];
  return rows.map(toConsultation);
}

export async function getConsultation(id: string): Promise<Consultation | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `select ${COLUMNS} ${JOINS} where c.id = $1::uuid and ${LIVE}`,
    [id],
  )) as Row[];
  return rows[0] ? toConsultation(rows[0]) : null;
}

export interface ConsultationWriteInput {
  title: string;
  userId: string;
  heldOn?: string | null;
  heldAt?: string | null;
  allocated?: number | null;
  completed?: number | null;
}

export class ConsultationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ConsultationError';
  }
}

async function requireUser(id: string): Promise<void> {
  const db = requireSql();
  const rows = (await db.query(
    `select id from users where id = $1::uuid and is_active`,
    [id],
  )) as { id: string }[];
  if (!rows[0]) {
    throw new ConsultationError('That person is not on the active roster', 422);
  }
}

export async function createConsultation(
  input: ConsultationWriteInput,
): Promise<Consultation> {
  await requireUser(input.userId);
  const db = requireSql();
  const rows = (await db.query(
    `insert into consultations
       (title, user_id, held_on, held_at, allocated, completed)
     values ($1, $2::uuid, $3::date, $4::time, $5::int, $6::int)
     returning id`,
    [
      input.title.trim(),
      input.userId,
      input.heldOn ?? null,
      input.heldAt ?? null,
      input.allocated ?? null,
      input.completed ?? null,
    ],
  )) as { id: string }[];
  const made = await getConsultation(rows[0].id);
  if (!made) throw new ConsultationError('Could not read back the new consultation', 500);
  return made;
}

const PATCHABLE: Record<string, string> = {
  title: 'title',
  userId: 'user_id',
  heldOn: 'held_on',
  heldAt: 'held_at',
  allocated: 'allocated',
  completed: 'completed',
};

const CASTS: Record<string, string> = {
  user_id: '::uuid',
  held_on: '::date',
  held_at: '::time',
  allocated: '::int',
  completed: '::int',
};

export async function updateConsultation(
  id: string,
  patch: Partial<ConsultationWriteInput>,
): Promise<Consultation | null> {
  const existing = await getConsultation(id);
  if (!existing) return null;
  if (patch.userId) await requireUser(patch.userId);

  const db = requireSql();
  const sets = ['updated_at = now()'];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(PATCHABLE)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const next = key === 'title' ? String(value).trim() : (value ?? null);
    params.push(next === '' ? null : next);
    sets.push(`${column} = $${params.length}${CASTS[column] ?? ''}`);
  }
  if (sets.length === 1) return existing;

  params.push(id);
  const rows = (await db.query(
    `update consultations set ${sets.join(', ')}
      where id = $${params.length}::uuid and deleted_at is null
      returning id`,
    params,
  )) as { id: string }[];
  if (!rows[0]) return null;
  return getConsultation(id);
}

/** Hides it. Recoverable, like removing a task, but needs no passcode. */
export async function deleteConsultation(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const db = requireSql();
  const rows = (await db.query(
    `update consultations set deleted_at = now()
      where id = $1::uuid and deleted_at is null
      returning id`,
    [id],
  )) as { id: string }[];
  return rows.length > 0;
}

export async function restoreConsultation(id: string): Promise<Consultation | null> {
  if (!UUID_RE.test(id)) return null;
  const db = requireSql();
  const rows = (await db.query(
    `update consultations set deleted_at = null
      where id = $1::uuid and deleted_at is not null
      returning id`,
    [id],
  )) as { id: string }[];
  if (!rows[0]) return null;
  return getConsultation(id);
}
