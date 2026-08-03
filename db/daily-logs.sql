-- Daily Work Log module.
--
-- Idempotent and additive: safe to run repeatedly. It creates three new tables
-- and reads the existing `records` table once, to seed the team roster. It
-- never updates or deletes anything in `records`.
--
-- Run after db/migrations.sql.
--
-- NOTE ON `users`. The app had no identity table before this file; team members
-- lived only as strings in the Settings record's `teamMembers` array, and every
-- other module still refers to a person by that name (`records.assigned_to`).
-- This creates the table and seeds it from that same roster, so no name is
-- hardcoded here. The two representations coexist until the other modules are
-- migrated — see the README.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  role       text not null default 'MEMBER',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `name` is the join key back to the rest of the app, which still identifies
-- people by name, so it has to be unique.
create unique index if not exists users_name_key  on users (name);
create unique index if not exists users_email_key on users (email) where email is not null;

-- ---------------------------------------------------------------------------
-- daily_logs
-- ---------------------------------------------------------------------------
create table if not exists daily_logs (
  id              uuid primary key default gen_random_uuid(),
  log_date        date not null,
  user_id         uuid not null references users (id),
  title           text not null,
  category        text not null,
  description     text,
  output          text,
  output_link     text,
  status          text not null default 'PLANNED',
  priority        text default 'MEDIUM',
  time_spent_mins int,
  blocker_note    text,
  -- Points back at the row this was rolled over from. ON DELETE SET NULL rather
  -- than the default RESTRICT: deleting an old entry should not be blocked by a
  -- descendant, and the carried row must survive its ancestor either way.
  carried_from_id uuid references daily_logs (id) on delete set null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_daily_logs_date      on daily_logs (log_date);
create index if not exists idx_daily_logs_user_date on daily_logs (user_id, log_date);
create index if not exists idx_daily_logs_status    on daily_logs (status);
create index if not exists idx_daily_logs_category  on daily_logs (category);

-- ---------------------------------------------------------------------------
-- daily_checkins — did this person report at all that day?
-- ---------------------------------------------------------------------------
create table if not exists daily_checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id),
  log_date     date not null,
  day_summary  text,
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists daily_checkins_user_date_key
  on daily_checkins (user_id, log_date);

-- ---------------------------------------------------------------------------
-- Value constraints
--
-- Added conditionally: ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, so
-- a second run would abort the script without this guard.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table users add constraint users_role_check
      check (role in ('ADMIN', 'MEMBER'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_logs_category_check') then
    alter table daily_logs add constraint daily_logs_category_check
      check (category in ('CONSULTATION', 'APPLICATION', 'WORKSHOP', 'MARKETING',
                          'OPERATIONS', 'RESEARCH', 'ADMIN', 'OTHER'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_logs_status_check') then
    alter table daily_logs add constraint daily_logs_status_check
      check (status in ('PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CARRIED_FORWARD'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_logs_priority_check') then
    alter table daily_logs add constraint daily_logs_priority_check
      check (priority in ('HIGH', 'MEDIUM', 'LOW'));
  end if;

  -- The point of the module: DONE means there is a recorded output. Enforced in
  -- the API too, but a CHECK means no path — a script, a psql session, a future
  -- endpoint — can mark something done with nothing to show for it.
  if not exists (select 1 from pg_constraint where conname = 'daily_logs_done_needs_output') then
    alter table daily_logs add constraint daily_logs_done_needs_output
      check (status <> 'DONE' or (output is not null and btrim(output) <> ''));
  end if;

  -- Likewise: BLOCKED without saying what the blocker is helps nobody.
  if not exists (select 1 from pg_constraint where conname = 'daily_logs_blocked_needs_note') then
    alter table daily_logs add constraint daily_logs_blocked_needs_note
      check (status <> 'BLOCKED' or (blocker_note is not null and btrim(blocker_note) <> ''));
  end if;

  -- completed_at is the timestamp of being DONE; the two must not disagree.
  if not exists (select 1 from pg_constraint where conname = 'daily_logs_completed_at_matches_status') then
    alter table daily_logs add constraint daily_logs_completed_at_matches_status
      check ((status = 'DONE') = (completed_at is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_logs_time_non_negative') then
    alter table daily_logs add constraint daily_logs_time_non_negative
      check (time_spent_mins is null or time_spent_mins >= 0);
  end if;

  -- A row cannot be carried forward from itself.
  if not exists (select 1 from pg_constraint where conname = 'daily_logs_no_self_carry') then
    alter table daily_logs add constraint daily_logs_no_self_carry
      check (carried_from_id is null or carried_from_id <> id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed the roster from Settings
--
-- Reads the same `teamMembers` array the Settings page edits, so the names come
-- from the app's own configuration rather than being written in here. Re-running
-- picks up members added since; it never removes or renames anyone, because
-- daily_logs rows reference these ids.
-- ---------------------------------------------------------------------------
-- The array check sits inside the LATERAL rather than in the WHERE clause:
-- jsonb_array_elements_text raises "cannot extract elements from a scalar" if
-- it is ever handed a non-array, and whether the WHERE filters before the
-- LATERAL runs is the planner's choice, not a guarantee.
insert into users (name)
select distinct btrim(member)
from records r
cross join lateral jsonb_array_elements_text(
  case when jsonb_typeof(r.data -> 'teamMembers') = 'array'
       then r.data -> 'teamMembers'
       else '[]'::jsonb end
) as member
where r.sheet = 'Settings'
  and btrim(member) <> ''
on conflict (name) do nothing;
