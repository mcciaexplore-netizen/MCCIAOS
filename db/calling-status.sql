-- Calling status: one running tally per person, not one row per call.
--
-- WHY A SEPARATE TABLE. `consultations` is a list of events — this consultation,
-- on this date, at this time. Calling is not a list of events; nobody wants a
-- row per phone call. It is four numbers per person that move through the day,
-- so the table holds exactly that: one row per person, updated in place.
--
-- The person is the key. `user_id` is unique, so there is no way to end up with
-- two tallies for the same person disagreeing with each other, and a write is an
-- upsert rather than a decision about whether a row exists yet.
--
-- FOUR SEPARATE NUMBERS, none derived from the others. It is tempting to make
-- "not picked" = allocated - picked, and it would be wrong: at eleven in the
-- morning most allocated calls have not been attempted at all, so the subtraction
-- would report every un-dialled number as a refusal. Scheduled is likewise not a
-- share of picked — a call can be picked up and lead nowhere. Each is counted
-- because each is observed.
--
-- NOT FROZEN, matching consultations. These are day-to-day tallies the person
-- doing the calling updates as they go; a passcode in front of a running count
-- would only teach everyone to leave the app unlocked.
--
-- Safe to run more than once.

create table if not exists calling_status (
  id         uuid primary key default gen_random_uuid(),

  -- One tally per person. Restricted to the roster, and never deleted out from
  -- under a tally — people are deactivated, not removed.
  user_id    uuid not null unique references users(id),

  -- Numbers handed to this person to call.
  calls_allocated      integer,
  -- Of those, the ones who answered.
  calls_picked         integer,
  -- Of those answered, the ones that became a booked consultation.
  consultation_scheduled integer,
  -- Dialled and not answered. Deliberately independent of the two above: a
  -- number can be allocated and not yet dialled, which is neither.
  not_picked           integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Non-negative because that is arithmetic. No ceiling relating them to each
  -- other: a constraint that rejects a true figure teaches people to enter a
  -- false one, and these four are counted separately by hand.
  constraint calling_status_counts_not_negative check (
    (calls_allocated is null or calls_allocated >= 0) and
    (calls_picked is null or calls_picked >= 0) and
    (consultation_scheduled is null or consultation_scheduled >= 0) and
    (not_picked is null or not_picked >= 0)
  )
);

create index if not exists calling_status_user_idx on calling_status (user_id);
