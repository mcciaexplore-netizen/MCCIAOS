-- Calling status becomes a daily record.
--
-- WHY. The first version held one tally per person, full stop, which quietly
-- assumed calling was a single running total that never resets. It is not:
-- numbers are handed out each morning, worked through, and the next morning
-- starts again. With one row per person, yesterday's figures were the only
-- figures — a person opening the table today saw last week's numbers and had to
-- either overwrite them, destroying the record, or add to them, making a total
-- that answers no question anybody asks.
--
-- One row per person per IST day fixes both. Today starts empty because today
-- has no row yet, and every past day stays exactly as it was left.
--
-- THE DAY IS THE TEAM'S DAY, not UTC's. The server runs in UTC, where the date
-- rolls over at 05:30 IST; a call logged at nine in the evening would be filed
-- under the following day. `(now() at time zone 'Asia/Kolkata')::date` is the
-- same expression the rest of the app uses for "today".
--
-- Safe to run more than once, and safe on a table that already holds rows.

alter table calling_status
  add column if not exists status_date date;

-- Existing rows predate the column. They are filed under the day they were
-- created rather than today: that is when the figures were entered, and moving
-- them forward would put somebody else's numbers on today's blank sheet.
update calling_status
   set status_date = (created_at at time zone 'Asia/Kolkata')::date
 where status_date is null;

alter table calling_status
  alter column status_date set not null,
  alter column status_date set default (now() at time zone 'Asia/Kolkata')::date;

-- The key is the person AND the day. Dropping the old single-column unique is
-- the whole point: with it in place a person could only ever have one row, so
-- the second day's entry would collide with the first.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'calling_status_user_id_key') then
    alter table calling_status drop constraint calling_status_user_id_key;
    raise notice 'dropped the one-row-per-person unique';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'calling_status_user_day_key') then
    alter table calling_status add constraint calling_status_user_day_key
      unique (user_id, status_date);
    raise notice 'added the one-row-per-person-per-day unique';
  end if;
end $$;

-- Reading is always "this day, everyone", so the day leads the index.
create index if not exists calling_status_day_idx
  on calling_status (status_date desc, user_id);
