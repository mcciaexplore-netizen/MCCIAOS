-- A colour per person, chosen rather than derived.
--
-- Avatars currently hash the name into a tint, which means nobody can change
-- their colour, two people can collide, and renaming somebody silently changes
-- how they look everywhere. A stored colour fixes all three.
--
-- Nullable on purpose: null means "no choice made", and the app falls back to
-- the same hash it uses today. Nothing has to be filled in for the app to work.
--
-- Safe to run more than once.

alter table users
  add column if not exists colour text;

comment on column users.colour is
  'Avatar colour as #rrggbb. Null falls back to the name-derived tint.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_colour_hex') then
    alter table users add constraint users_colour_hex
      check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- Seed a distinct colour per person, in roster order, so the team starts out
-- visually separable instead of everyone having to pick one. Only fills rows
-- that have made no choice, so re-running never overwrites a preference.
do $$
declare
  palette text[] := array[
    '#2E7CD6', '#E9494A', '#1F9D6B', '#B45FD6', '#E9730C',
    '#0F9AA8', '#D6337F', '#6C63C9', '#8A8F00', '#C2410C'
  ];
  r record;
  i int := 0;
begin
  for r in select id from users where colour is null order by created_at, name loop
    update users set colour = palette[(i % array_length(palette, 1)) + 1] where id = r.id;
    i := i + 1;
  end loop;
  raise notice 'gave % people a starting colour', i;
end $$;
