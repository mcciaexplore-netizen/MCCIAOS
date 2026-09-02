-- Work Tracker: the four numbers a task carries alongside its dates.
--
--   percentage               how far along the work is, 0-100
--   consultations_allocated  how many consultations were handed out
--   consultations_done       how many of them have happened
--   callings_done            how many calls have been made
--
-- All four are nullable. A task that has nothing to do with consultations
-- should say nothing about them, and zero is a real answer ("none yet") that
-- means something different from "not applicable" — defaulting to 0 would erase
-- that distinction on every row that already exists.
--
-- CONSTRAINTS. Percentage is held to 0-100 and the counts to non-negative,
-- because those are arithmetic facts rather than policy. Done is deliberately
-- NOT constrained to be <= allocated: more consultations than were formally
-- allocated is a normal thing to record, and a CHECK that rejects the truth
-- teaches people to enter something false.
--
-- Safe to run more than once. Adds columns and constraints; drops nothing and
-- rewrites no existing values.

alter table tasks
  add column if not exists percentage              smallint,
  add column if not exists consultations_allocated integer,
  add column if not exists consultations_done      integer,
  add column if not exists callings_done           integer;

comment on column tasks.percentage is
  'Progress, 0-100. Null means nobody has said.';
comment on column tasks.consultations_allocated is
  'Consultations handed out for this task. Null means not applicable; 0 means none.';
comment on column tasks.consultations_done is
  'Consultations completed. Not capped by allocated on purpose — see db/work-tracker-metrics.sql.';
comment on column tasks.callings_done is
  'Calls made for this task. Null means not applicable; 0 means none.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_percentage_range') then
    alter table tasks add constraint tasks_percentage_range
      check (percentage is null or (percentage >= 0 and percentage <= 100));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_counts_not_negative') then
    alter table tasks add constraint tasks_counts_not_negative
      check (
        (consultations_allocated is null or consultations_allocated >= 0) and
        (consultations_done      is null or consultations_done      >= 0) and
        (callings_done           is null or callings_done           >= 0)
      );
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from tasks;
  raise notice 'work tracker: 4 metric column(s) available on % task row(s)', n;
end $$;
