-- Optional hardening for the `records` table. None of this is required for
-- the app to run — db/migrations.sql already creates everything it needs.
-- Each block is independent and idempotent; run what you want.

-- 1. Keep updated_at honest.
--    Only server/pg-store.ts patch() sets updated_at explicitly. Any UPDATE run
--    directly against the database (including the stage-remap statements at the
--    bottom of db/migrations.sql) changes data but leaves updated_at stale.
--    A trigger closes that gap for every writer.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_records_updated_at on records;
create trigger trg_records_updated_at
  before update on records
  for each row execute function set_updated_at();

-- 2. Enforce the Settings singleton.
--    src/settings/SettingsContext.tsx reads data[0] and useSaveSettings()
--    creates-if-absent / patches-if-present. Two simultaneous first-saves (two
--    tabs, or a double-click) can therefore create a second Settings row, after
--    which the app silently reads whichever sorts first by created_at desc and
--    the other set of settings becomes invisible-but-persistent.
--    A partial unique index makes that impossible at the database level.
--    NOTE: this fails if duplicates already exist — check first with:
--      select count(*) from records where sheet = 'Settings';
create unique index if not exists idx_records_settings_singleton
  on records (sheet)
  where sheet = 'Settings';

-- 3. Reject unknown sheet values.
--    server/handlers.ts already gates this via isValidSheet(), so this only
--    matters for direct SQL writes, imports, and future code paths that bypass
--    the API. Keep this list in sync with SHEET_ALLOWLIST in
--    server/store-types.ts — adding an entity type means altering this
--    constraint, which is the one piece of DDL a new sheet would require.
alter table records drop constraint if exists records_sheet_valid;
alter table records add constraint records_sheet_valid
  check (sheet in (
    'Company', 'Session', 'Followup', 'Project', 'Creative', 'Resource', 'Settings'
  ));
