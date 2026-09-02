-- The organisation profile: one row, holding what used to be hardcoded.
--
-- Its own table rather than the generic `records` store, because these are
-- settings the whole app reads on every page and a typed row beats a JSON blob
-- that nothing validates. One row, enforced.
--
-- Every column is nullable with a default, so a fresh install and a
-- half-populated row both yield something usable. The application merges over
-- defaults regardless (src/schemas/orgSettings.ts).
--
-- Safe to run more than once.

create table if not exists org_settings (
  id                   boolean primary key default true,
  app_name             text        not null default 'MCCIA OS',
  app_tagline          text        not null default 'Applied AI Studio',
  organisation_name    text        not null default 'MCCIA Applied AI Studio',
  contact_email        text        not null default '',
  contact_phone        text        not null default '',
  website_url          text        not null default '',
  address_line         text        not null default '',
  logo_data_uri        text        not null default '',
  brand_colour         text        not null default '#0B1F3A',
  at_risk_days         integer     not null default 3,
  daily_export_time    text        not null default '18:00',
  daily_export_enabled boolean     not null default true,
  notify_on_overdue    boolean     not null default false,
  notify_on_approval   boolean     not null default false,
  notification_email   text        not null default '',
  updated_at           timestamptz not null default now(),

  -- One row, structurally. `id` can only ever be true, so a second insert
  -- collides with the primary key rather than quietly creating a rival profile
  -- that half the app would read instead.
  constraint org_settings_single_row check (id),
  constraint org_settings_name_not_blank check (length(btrim(app_name)) > 0),
  constraint org_settings_at_risk_range check (at_risk_days between 1 and 30),
  constraint org_settings_colour_hex check (brand_colour ~ '^#[0-9a-fA-F]{6}$'),
  constraint org_settings_export_time check (daily_export_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

insert into org_settings (id) values (true) on conflict (id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from org_settings;
  raise notice 'org_settings holds % row (expected exactly 1)', n;
end $$;
