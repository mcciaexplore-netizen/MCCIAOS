-- More than one person on a piece of work.
--
-- `tasks.user_id` stays: it is the person the work belongs to, the one it is
-- filed under and listed by. This table holds everybody else on it.
--
-- Deliberately NOT a replacement for user_id. Making every task a bag of people
-- with no owner would lose the thing the tracker is built around — "whose work
-- is this" — and every list, filter and export would need a rule for picking a
-- representative anyway. One lead, plus collaborators, keeps both questions
-- answerable.
--
-- Safe to run more than once.

create table if not exists task_members (
  task_id  uuid not null references tasks(id) on delete cascade,
  user_id  uuid not null references users(id),
  added_at timestamptz not null default now(),

  primary key (task_id, user_id)
);

-- Every list of "who is on this" reads by task; the primary key already covers
-- that. This one answers the other direction — "what is this person on" — which
-- the per-person views need.
create index if not exists task_members_user_idx on task_members (user_id);

do $$
declare n int;
begin
  select count(*) into n from task_members;
  raise notice 'task_members holds % row(s)', n;
end $$;
