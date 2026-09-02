-- Work Tracker module.
--
-- Replaces the Daily Work Log, whose tables were renamed to
-- `daily_logs_archive` / `daily_checkins_archive` rather than dropped. Those
-- archives are read-only; nothing in this file touches them.
--
-- Idempotent. Run after db/migrations.sql.
--
-- NOTE ON `users`. The table already exists — it was created for the Daily Work
-- Log and is seeded from the Settings roster. `create table if not exists`
-- would silently no-op and leave it missing columns, so the shape is reconciled
-- with guarded ALTERs below. The create is there only for a fresh database.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  role        text not null default 'MEMBER',
  designation text,
  department  text,
  reports_to  uuid,
  avatar_url  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'users' and column_name = 'active')
     and not exists (select 1 from information_schema.columns
                      where table_name = 'users' and column_name = 'is_active') then
    alter table users rename column active to is_active;
  end if;
end $$;

alter table users add column if not exists designation text;
alter table users add column if not exists department  text;
alter table users add column if not exists avatar_url  text;
alter table users add column if not exists reports_to  uuid;
alter table users add column if not exists updated_at  timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_reports_to_fkey') then
    alter table users add constraint users_reports_to_fkey
      foreign key (reports_to) references users (id);
  end if;
  -- Nobody reports to themselves. Longer cycles are checked in the API, which
  -- can walk the chain and explain what it found.
  if not exists (select 1 from pg_constraint where conname = 'users_no_self_report') then
    alter table users add constraint users_no_self_report
      check (reports_to is null or reports_to <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table users add constraint users_role_check check (role in ('ADMIN','MEMBER'));
  end if;
end $$;

-- `email` stays NULLABLE, deviating from the module spec: every existing row
-- has a NULL email and inventing addresses for real people to satisfy NOT NULL
-- would be fabricating data. The Settings form requires it for anyone added or
-- edited from now on, so the rule holds going forward. Uniqueness is enforced
-- wherever a value is present.
create unique index if not exists users_email_key on users (email) where email is not null;
create unique index if not exists users_name_key  on users (name);

-- ---------------------------------------------------------------------------
-- Retire the previous `tasks` shape.
--
-- The columns changed wholesale (ref/type/description dropped, assignee_id ->
-- user_id, new status vocabulary) and collaborators are gone entirely, so the
-- table is rebuilt rather than patched. Guarded: if it still holds rows this
-- raises instead of destroying them, so re-running this file on a live database
-- can never silently drop work.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  if to_regclass('public.tasks') is null then return; end if;

  if exists (select 1 from information_schema.columns
              where table_name = 'tasks' and column_name = 'ref') then
    select count(*) into n from tasks;
    if n > 0 then
      raise exception
        'tasks still holds % row(s) in the previous shape. Migrate or clear them before running this file.', n;
    end if;
    drop table if exists task_collaborators;
    drop table if exists task_activity;
    drop table tasks;
  end if;
end $$;

-- The human reference and its sequence went with that shape.
drop trigger if exists trg_task_ref on tasks;
drop function if exists set_task_ref();
drop sequence if exists task_ref_seq;

-- ---------------------------------------------------------------------------
-- tasks
--
-- One row per piece of work, one person per row. There is no collaborators
-- table: the module spec is explicit that work has a single owner.
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),

  user_id         uuid not null references users (id),
  title           text not null,

  priority        text not null default 'medium',
  status          text not null default 'upcoming',

  allocation_date date,
  due_date        date,
  deadline_date   date,

  report_to       uuid references users (id),
  approver_id     uuid references users (id),

  completed_at    timestamptz,
  approved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tasks_user     on tasks (user_id);
create index if not exists idx_tasks_status   on tasks (status);
create index if not exists idx_tasks_due      on tasks (due_date);
create index if not exists idx_tasks_deadline on tasks (deadline_date);

-- ---------------------------------------------------------------------------
-- task_activity — audit trail of every field change
-- ---------------------------------------------------------------------------
create table if not exists task_activity (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  actor_id   uuid references users (id),
  field      text not null,
  old_value  text,
  new_value  text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_activity_task on task_activity (task_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Value constraints
--
-- The API enforces these too. They are mirrored here because a status is only
-- meaningful if nothing can write one the pipeline does not recognise.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_status_check') then
    alter table tasks add constraint tasks_status_check
      check (status in ('upcoming','ongoing','hold','stopped','completed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_priority_check') then
    alter table tasks add constraint tasks_priority_check
      check (priority in ('high','medium','low'));
  end if;

  -- "deadline_date cannot be earlier than due_date". Either may be null.
  if not exists (select 1 from pg_constraint where conname = 'tasks_deadline_after_due') then
    alter table tasks add constraint tasks_deadline_after_due
      check (deadline_date is null or due_date is null or deadline_date >= due_date);
  end if;

  -- completed_at exists exactly while the task is completed.
  if not exists (select 1 from pg_constraint where conname = 'tasks_completed_at_matches_status') then
    alter table tasks add constraint tasks_completed_at_matches_status
      check ((status = 'completed') = (completed_at is not null));
  end if;

  -- Approval is a separate action and only ever applies to completed work.
  if not exists (select 1 from pg_constraint where conname = 'tasks_approved_only_when_completed') then
    alter table tasks add constraint tasks_approved_only_when_completed
      check (approved_at is null or status = 'completed');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_title_not_blank') then
    alter table tasks add constraint tasks_title_not_blank
      check (btrim(title) <> '');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_task_touch on tasks;
create trigger trg_task_touch before update on tasks
for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed the roster from Settings, for a database with no users yet.
--
-- The array check sits inside the LATERAL rather than in the WHERE clause:
-- jsonb_array_elements_text raises on a non-array, and whether the WHERE
-- filters first is the planner's choice, not a guarantee.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- user_activity — the same audit trail, for roster changes
--
-- Kept separate from task_activity rather than filed against a null task_id:
-- that column is NOT NULL, and a "task change with no task" would be a lie in
-- the data.
-- ---------------------------------------------------------------------------
create table if not exists user_activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  actor_id   uuid references users (id),
  field      text not null,
  old_value  text,
  new_value  text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_user_activity on user_activity (user_id, changed_at desc);
