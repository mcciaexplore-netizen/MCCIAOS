-- Production schema + one-time migrations for MCCIA Intern OS.
-- The local dev store (server/store.ts) mirrors this shape in a JSON file;
-- run this against Neon Postgres for production.

create table if not exists records (
  id          uuid primary key default gen_random_uuid(),
  sheet       text not null,          -- entity type discriminator
  assigned_to text,                   -- was owner_id; label only, not an access boundary
  created_by  text,                   -- team member name, or 'intake-form'
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_records_sheet on records (sheet);
create index if not exists idx_records_sheet_assigned on records (sheet, assigned_to);
create index if not exists idx_records_data_gin on records using gin (data);

-- One-time: remap old Kanban stage values to new labels. Confirm the actual
-- current stage values in production before running (Design/Build both
-- collapse into Started — a lossy many-to-one, per BACKEND_SCHEMA.md).
update records set data = jsonb_set(data, '{stage}', '"Pre Dev"')   where sheet='Project' and data->>'stage'='Discovery';
update records set data = jsonb_set(data, '{stage}', '"Started"')   where sheet='Project' and data->>'stage'='Design';
update records set data = jsonb_set(data, '{stage}', '"Started"')   where sheet='Project' and data->>'stage'='Build';
update records set data = jsonb_set(data, '{stage}', '"Completed"') where sheet='Project' and data->>'stage'='Testing';
update records set data = jsonb_set(data, '{stage}', '"Deployed"')  where sheet='Project' and data->>'stage'='Delivered';

-- One-time: rename owner_id semantics, if the column exists.
-- alter table records rename column owner_id to assigned_to;
