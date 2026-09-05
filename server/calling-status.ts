/**
 * Calling status: one running tally per person.
 *
 * The list is driven from `users`, not from `calling_status`, so everybody on
 * the roster appears whether or not they have been given calls yet. A person
 * with no row reads as four blanks rather than being absent — an empty tally
 * and a missing person look very different to whoever is reading the table, and
 * only one of them is true.
 *
 * NOT FROZEN, matching consultations. Every write here is open; these are
 * counts that move through the day, and a passcode in front of them would only
 * teach everyone to leave the app unlocked.
 */
import { requireSql } from './sql.js';
import type { CallingStatus } from '../src/types/index.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** API field <-> column. Written out so neither side has to guess. */
const FIELDS = {
  callsAllocated: 'calls_allocated',
  callsPicked: 'calls_picked',
  consultationScheduled: 'consultation_scheduled',
  notPicked: 'not_picked',
} as const;

export type CallingField = keyof typeof FIELDS;

interface Row {
  user_id: string;
  user_name: string;
  colour: string | null;
  calls_allocated: number | null;
  calls_picked: number | null;
  consultation_scheduled: number | null;
  not_picked: number | null;
  updated_at: string | Date | null;
}

const toStatus = (r: Row): CallingStatus => ({
  userId: r.user_id,
  userName: r.user_name,
  colour: r.colour,
  callsAllocated: r.calls_allocated,
  callsPicked: r.calls_picked,
  consultationScheduled: r.consultation_scheduled,
  notPicked: r.not_picked,
  updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/**
 * Every active person and their tally.
 *
 * A left join, so somebody who has never been given a call still gets a row.
 * Ordered by name because this is a roster being read down, not a feed.
 */
export async function listCallingStatus(user?: string | null): Promise<CallingStatus[]> {
  const db = requireSql();
  const who = user && UUID_RE.test(user) ? user : null;
  const rows = (await db.query(
    `select u.id as user_id, u.name as user_name, u.colour,
            c.calls_allocated, c.calls_picked,
            c.consultation_scheduled, c.not_picked, c.updated_at
       from users u
       left join calling_status c on c.user_id = u.id
      where u.is_active and ($1::uuid is null or u.id = $1::uuid)
      order by lower(u.name)`,
    [who],
  )) as Row[];
  return rows.map(toStatus);
}

/**
 * Sets one figure for one person.
 *
 * An upsert, because a tally has no creation step: the first number somebody
 * types is as much a create as an update, and making the UI decide which would
 * only invite the two to disagree.
 *
 * Writes a single field rather than the whole row. Two people editing different
 * columns at the same moment then cannot overwrite one another, which a
 * whole-row PUT from a stale table would do silently.
 */
export async function setCallingField(
  userId: string,
  field: CallingField,
  value: number | null,
): Promise<CallingStatus | null> {
  if (!UUID_RE.test(userId)) return null;
  const column = FIELDS[field];
  if (!column) return null;
  if (value !== null && (!Number.isInteger(value) || value < 0)) return null;

  const db = requireSql();

  // Ask before writing. Without this an unknown id reached the insert and came
  // back as a foreign-key violation — a 500 describing a constraint, when the
  // truth is simply that no such person exists.
  const known = (await db.query(
    `select 1 from users where id = $1::uuid`,
    [userId],
  )) as unknown[];
  if (known.length === 0) return null;

  await db.query(
    `insert into calling_status (user_id, ${column})
     values ($1::uuid, $2::integer)
     on conflict (user_id) do update
        set ${column} = excluded.${column},
            updated_at = now()`,
    [userId, value],
  );
  const rows = await listCallingStatus(userId);
  return rows[0] ?? null;
}
