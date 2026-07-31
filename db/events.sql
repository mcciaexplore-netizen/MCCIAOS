-- Workshops & Events module.
--
-- Idempotent and additive: safe to run repeatedly against the existing Neon
-- database. Nothing here reads, alters or drops the `records` table — this
-- module is the first in the app to use dedicated relational tables rather than
-- the generic records/JSONB store, because the serial allocation, the type
-- CHECKs and the participant foreign key cannot be expressed in JSONB.
--
-- Run after db/migrations.sql.

create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  type             text not null,
  serial_no        int  not null,
  title            text not null,
  description      text,
  topic            text,
  mode             text not null,
  venue            text,
  meeting_link     text,
  event_date       date not null,
  start_time       time,
  end_time         time,
  speaker          text,
  status           text not null default 'UPCOMING',
  registered_count int  not null default 0,
  attended_count   int  not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists event_participants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events (id) on delete cascade,
  name          text not null,
  company       text,
  designation   text,
  email         text,
  phone         text,
  is_member     boolean default false,
  registered_at timestamptz default now(),
  attended      boolean not null default false,
  created_at    timestamptz default now()
);

-- Uniqueness as indexes rather than inline table constraints so that re-running
-- this file against a table that already exists still converges on the right
-- shape — `create table if not exists` would silently skip inline constraints.
create unique index if not exists events_code_key        on events (code);
create unique index if not exists events_type_serial_key on events (type, serial_no);

-- The list view sorts by date descending and filters by type/status, and the
-- code sort orders by (type, serial_no) so W-100 lands after W-99.
create index if not exists idx_events_date        on events (event_date desc);
create index if not exists idx_events_type_serial on events (type, serial_no);
create index if not exists idx_events_status      on events (status);

create index if not exists idx_event_participants_event on event_participants (event_id);
create index if not exists idx_event_participants_email on event_participants (email);

-- Value constraints. Added conditionally: ALTER TABLE ... ADD CONSTRAINT has no
-- IF NOT EXISTS, so a second run would abort the script without this guard.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_type_check') then
    alter table events add constraint events_type_check
      check (type in ('WORKSHOP', 'EVENT'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'events_mode_check') then
    alter table events add constraint events_mode_check
      check (mode in ('ONLINE', 'OFFLINE', 'HYBRID'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'events_status_check') then
    alter table events add constraint events_status_check
      check (status in ('UPCOMING', 'COMPLETED', 'CANCELLED'));
  end if;

  -- serial_no drives the generated code, so it has to be a positive integer;
  -- a zero or negative serial would produce a code like "W-00" or "W--1".
  if not exists (select 1 from pg_constraint where conname = 'events_serial_positive') then
    alter table events add constraint events_serial_positive
      check (serial_no > 0);
  end if;

  -- The manual-override counts are fallbacks for back-filled events and are
  -- shown as-is, so a negative figure would render straight to the screen.
  if not exists (select 1 from pg_constraint where conname = 'events_counts_non_negative') then
    alter table events add constraint events_counts_non_negative
      check (registered_count >= 0 and attended_count >= 0);
  end if;
end $$;
