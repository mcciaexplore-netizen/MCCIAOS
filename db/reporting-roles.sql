-- Who can be reported to, and who can approve.
--
-- Reports to and Approver used to offer the whole roster. They are not the
-- whole roster: reporting goes to four people and approval to two.
--
-- Stored as flags on `users` rather than a list of names in the code, because a
-- name in the code is wrong the moment somebody leaves, changes name, or the
-- arrangement changes — and it would have to be a deploy to fix. These are
-- editable on the Settings roster.
--
-- The two are separate flags, not one rank: everyone who approves also receives
-- reports today, but that is a fact about the current arrangement rather than a
-- rule, and folding them into one column would make the next change a migration
-- instead of a checkbox.
--
-- Safe to run more than once.

alter table users
  add column if not exists can_be_reported_to boolean not null default false,
  add column if not exists can_approve        boolean not null default false;

comment on column users.can_be_reported_to is
  'Offered in a task''s "Reports to". Managed on the Settings roster.';
comment on column users.can_approve is
  'Offered in a task''s "Approver", and may sign off completed work.';

-- Seed the current arrangement. Matching by name is safe on a roster this size
-- where names are unique, and this runs once; from here the flags are edited in
-- Settings, not here.
do $$
declare
  reporters text[] := array['Sujal', 'Pratik', 'Ismail', 'Ziya'];
  approvers text[] := array['Ismail', 'Ziya'];
  missing   text[];
  already   int;
begin
  -- Refuse rather than silently half-apply if the roster is not what this
  -- expects. A flag quietly not set is worse than a migration that stops.
  select array_agg(n) into missing
    from unnest(reporters || approvers) as n
   where not exists (select 1 from users u where u.name = n);
  if missing is not null then
    raise exception 'These people are not on the roster: %. Check the names, then re-run.', missing;
  end if;

  -- If anything is already flagged, the arrangement has been edited in Settings
  -- since. Leave it alone; re-running must not undo somebody's change.
  select count(*) into already from users where can_be_reported_to or can_approve;
  if already > 0 then
    raise notice 'reporting roles already set on % user(s); leaving them as they are', already;
    return;
  end if;

  update users set can_be_reported_to = (name = any(reporters)),
                   can_approve        = (name = any(approvers));
  raise notice 'reports-to: %   approvers: %', reporters, approvers;
end $$;
