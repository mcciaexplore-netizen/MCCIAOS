-- Work Tracker module.
--
-- Replaces the Daily Work Log, whose tables were renamed to
-- `daily_logs_archive` / `daily_checkins_archive` rather than dropped. Those
-- archives are read-only; nothing in this file touches them.
--
-- Idempotent and additive. Run after db/migrations.sql.
--
-- NOTE ON `users`. The table already exists — it was created by the Daily Work
-- Log and is seeded from the Settings roster. `create table if not exists`
-- would silently no-op and leave it missing every column this module needs, so
-- the shape is reconciled with guarded ALTERs below. The create is there only
-- for a fresh database.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  role        text not null default 'MEMBER',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  -- The Daily Work Log called this `active`. Renamed rather than added, so the
  -- existing values survive.
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
  -- Nobody reports to themselves.
  if not exists (select 1 from pg_constraint where conname = 'users_no_self_report') then
    alter table users add constraint users_no_self_report
      check (reports_to is null or reports_to <> id);
  end if;
end $$;

-- `email` stays NULLABLE, deviating from the module spec: every existing row
-- has a NULL email and inventing six addresses to satisfy NOT NULL would be
-- fabricating data. Uniqueness is still enforced where a value is present.
create unique index if not exists users_email_key on users (email) where email is not null;
create unique index if not exists users_name_key  on users (name);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique not null,

  title         text not null,
  description   text,

  type          text not null default 'task',
  status        text not null default 'not_started',
  priority      text not null default 'medium',

  assignee_id   uuid not null references users (id),
  allocated_by  uuid references users (id),
  report_to     uuid references users (id),
  approver_id   uuid references users (id),

  allocated_at  timestamptz not null default now(),
  due_date      date,
  deadline      date,
  completed_at  timestamptz,
  approved_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- `type` arrived with the Jira-anatomy table after `tasks` already existed, so
-- the create above cannot introduce it on this database.
alter table tasks add column if not exists type text not null default 'task';

create index if not exists idx_tasks_assignee on tasks (assignee_id);
create index if not exists idx_tasks_status   on tasks (status);
create index if not exists idx_tasks_due      on tasks (due_date);

-- ---------------------------------------------------------------------------
-- task_collaborators — everyone on a task who is not the owner
-- ---------------------------------------------------------------------------
create table if not exists task_collaborators (
  task_id         uuid not null references tasks (id) on delete cascade,
  user_id         uuid not null references users (id),
  role            text not null default 'contributor',
  member_due_date date,
  allocated_at    timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists idx_collab_user on task_collaborators (user_id);

-- ---------------------------------------------------------------------------
-- task_activity — audit trail of every field change
-- ---------------------------------------------------------------------------
create table if not exists task_activity (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks (id) on delete cascade,
  actor_id    uuid references users (id),
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now()
);

create index if not exists idx_activity_task on task_activity (task_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Value constraints
--
-- The module spec enforces these in the app. They are mirrored here because a
-- status is only meaningful if nothing can write one the pipeline does not
-- recognise — the same reasoning the Events and Daily Log schemas used.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_status_check') then
    alter table tasks add constraint tasks_status_check
      check (status in ('not_started','in_progress','blocked','submitted','approved','completed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_type_check') then
    alter table tasks add constraint tasks_type_check
      check (type in ('task','bug','story','admin'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_priority_check') then
    alter table tasks add constraint tasks_priority_check
      check (priority in ('critical','high','medium','low'));
  end if;

  -- "deadline cannot be earlier than due_date". Either may be null.
  if not exists (select 1 from pg_constraint where conname = 'tasks_deadline_after_due') then
    alter table tasks add constraint tasks_deadline_after_due
      check (deadline is null or due_date is null or deadline >= due_date);
  end if;

  -- approved_at exists exactly while the task is approved or completed.
  if not exists (select 1 from pg_constraint where conname = 'tasks_approved_at_matches_status') then
    alter table tasks add constraint tasks_approved_at_matches_status
      check (approved_at is null or status in ('approved','completed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_title_not_blank') then
    alter table tasks add constraint tasks_title_not_blank
      check (btrim(title) <> '');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'collab_role_check') then
    alter table task_collaborators add constraint collab_role_check
      check (role in ('contributor','reviewer'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Human reference: WT-0001, WT-0002, …
-- ---------------------------------------------------------------------------
create sequence if not exists task_ref_seq start 1;

create or replace function set_task_ref() returns trigger as $$
begin
  if new.ref is null then
    new.ref := 'WT-' || lpad(nextval('task_ref_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_task_ref on tasks;
create trigger trg_task_ref before insert on tasks
for each row execute function set_task_ref();

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
-- Seed the roster from Settings, for a database that has no users yet.
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
