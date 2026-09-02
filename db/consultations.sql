-- Consultations: their own table, not three columns bolted onto every task.
--
-- WHY. consultations_allocated, consultations_done and callings_done lived on
-- `tasks`, which meant every piece of work in the tracker carried three
-- consultation figures whether or not it had anything to do with consultations.
-- On a website build or a report they were permanently blank columns taking up
-- the width that the actual work needed. A consultation is its own kind of
-- record, with its own date, its own time and its own owner, so it gets its own
-- table and its own view.
--
-- NOT FROZEN. Unlike `tasks`, nothing here is gated by the admin passcode.
-- These are day-to-day counts that the person doing the work updates as the day
-- goes; making them ask for a passcode to correct a tally would only teach
-- everyone to leave the app unlocked.
--
-- Safe to run more than once.

create table if not exists consultations (
  id          uuid primary key default gen_random_uuid(),

  -- What the consultation was. Free text: these are named however the person
  -- running them names them, not chosen from a list.
  title       text not null,

  -- Who took it. Restricted to the roster, and never deleted out from under a
  -- consultation — people are deactivated, not removed.
  user_id     uuid not null references users(id),

  held_on     date,
  -- Time of day, no timezone: "11:30" means 11:30 where the team is, and
  -- storing an offset would invite the question of whose.
  held_at     time,

  allocated   integer,
  completed   integer,

  -- Hidden rather than destroyed, matching how a task is removed, so a
  -- mis-click is recoverable even though nothing here needs a passcode.
  deleted_at  timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint consultations_title_not_blank check (length(btrim(title)) > 0),
  -- Counts are non-negative because that is arithmetic. `completed` is
  -- deliberately not capped by `allocated`: taking more consultations than were
  -- formally allocated is a normal thing to record, and a constraint that
  -- rejects the truth teaches people to enter something false.
  constraint consultations_counts_not_negative check (
    (allocated is null or allocated >= 0) and
    (completed is null or completed >= 0)
  )
);

create index if not exists consultations_live_idx
  on consultations (deleted_at) where deleted_at is null;
create index if not exists consultations_user_idx
  on consultations (user_id) where deleted_at is null;
create index if not exists consultations_date_idx
  on consultations (held_on desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Retire the three task columns these replace.
--
-- Guarded: if anybody ever put figures in them, this stops rather than throwing
-- the numbers away, and says how many rows are involved so the decision is an
-- informed one.
do $$
declare n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tasks' and column_name = 'consultations_allocated') then
    raise notice 'task consultation columns already removed';
    return;
  end if;

  select count(*) into n from tasks
   where consultations_allocated is not null
      or consultations_done is not null
      or callings_done is not null;

  if n > 0 then
    raise exception
      'tasks still holds consultation figures on % row(s). Move them into consultations first, or clear them, then re-run.', n;
  end if;

  alter table tasks drop constraint if exists tasks_counts_not_negative;
  alter table tasks drop column consultations_allocated;
  alter table tasks drop column consultations_done;
  alter table tasks drop column callings_done;
  raise notice 'dropped the three consultation columns from tasks';
end $$;

-- `percentage` stays on tasks: it describes the work itself, not consultations.
