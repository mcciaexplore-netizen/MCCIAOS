-- Work Tracker: keep the record when work is removed.
--
-- WHY. Recorded work is frozen: changing a filled field needs the admin
-- passcode. Deletion was not held to the same standard. It removed the row
-- outright, and `task_activity.task_id` cascades, so the history went with it —
-- there was no trace that the task had ever existed, let alone who removed it.
-- That is not a hypothetical: a task called "Mail IIT's" was lost on
-- 2026-09-02 and nothing in the database could say what had happened to it.
--
-- WHAT THIS CHANGES.
--   1. tasks.deleted_at — deleting hides a task instead of destroying it. The
--      row and its history stay; every read filters it out.
--   2. task_activity.task_title — each history row carries the title as it was,
--      so the trail still reads on its own if a task is ever purged for real.
--   3. A partial index on the live rows, since every list query now ends in
--      "and deleted_at is null".
--
-- Safe to run more than once. It adds columns and an index; it drops nothing,
-- rewrites no existing values, and leaves every current row visible
-- (deleted_at defaults to null, which means "not deleted").

-- 1 ------------------------------------------------------------------- tasks
alter table tasks
  add column if not exists deleted_at timestamptz;

comment on column tasks.deleted_at is
  'When the task was removed. Null means live. Set instead of deleting the row, so the work and its history survive; see db/work-tracker-history.sql.';

-- Every list query filters on this, so index the live rows only: the index
-- stays the size of the working set rather than the size of all history.
create index if not exists tasks_live_idx
  on tasks (deleted_at)
  where deleted_at is null;

-- 2 ---------------------------------------------------------- task_activity
-- The title as it stood when the change was made. Denormalised on purpose: a
-- history row has to stay readable even if the task it points at is gone, and
-- a title that has since been edited should not silently rewrite the past.
alter table task_activity
  add column if not exists task_title text;

comment on column task_activity.task_title is
  'The task title at the time of the change. Kept so the trail reads on its own, and so later edits do not rewrite history.';

-- Backfill what can still be matched. Rows whose task has already been purged
-- keep a null title — there is nothing left to recover it from, and inventing
-- one would be worse than an honest blank.
update task_activity a
   set task_title = t.title
  from tasks t
 where t.id = a.task_id
   and a.task_title is null;

-- 3 ----------------------------------------------------------------- report
do $$
declare
  live int;
  removed int;
  trail int;
begin
  select count(*) filter (where deleted_at is null),
         count(*) filter (where deleted_at is not null)
    into live, removed
    from tasks;
  select count(*) into trail from task_activity;
  raise notice 'work tracker: % live task(s), % removed, % history row(s)', live, removed, trail;
end $$;
