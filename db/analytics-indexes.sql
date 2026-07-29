-- Indexes supporting the Analytics module.
--
-- This app stores every entity in one `records` table discriminated by
-- `sheet`, with entity fields in a `data` jsonb column (see db/migrations.sql).
-- There are no separate consultations/companies tables and no foreign keys, so
-- the "index the FKs used in GROUP BY" requirement becomes: index the jsonb
-- expressions the analytics queries group by.
--
-- Safe to re-run: every statement is IF NOT EXISTS.

-- Every analytics query filters by sheet and a created_at range, in that
-- order of selectivity. The existing idx_records_sheet cannot serve the range
-- part, so pair them.
create index if not exists idx_records_sheet_created
  on records (sheet, created_at desc);

-- All bucketing is on the IST calendar day, never UTC. Indexing the same
-- expression the queries use lets a date-range scan use the index instead of
-- computing the timezone shift per row.
-- IMMUTABLE-safe: `AT TIME ZONE 'Asia/Kolkata'` on a timestamptz yields a
-- fixed local timestamp, and IST has no DST, so the result is stable.
create index if not exists idx_records_ist_date
  on records (sheet, ((created_at at time zone 'Asia/Kolkata')::date));

-- Breakdown dimensions. Partial indexes keep them small — a status index over
-- all 2000+ Company rows would be dead weight for Session queries.
create index if not exists idx_records_session_status
  on records ((data ->> 'status'))
  where sheet = 'Session';

create index if not exists idx_records_project_stage
  on records ((data ->> 'stage'))
  where sheet = 'Project';

create index if not exists idx_records_company_status
  on records ((data ->> 'status'))
  where sheet = 'Company';

-- companyId is the de-facto foreign key from Session/Project/Creative back to
-- Company. It is a jsonb string, so joins cast it to uuid; index the text form
-- that the join predicate actually uses.
create index if not exists idx_records_company_ref
  on records ((data ->> 'companyId'))
  where data ? 'companyId';

-- assigned_to is a real column and is the "team member" breakdown dimension.
-- idx_records_sheet_assigned from the base migration already covers it.

-- Company attributes used for sector / region breakdowns, reached by joining
-- Session and Project through companyId.
create index if not exists idx_records_company_industry
  on records ((data ->> 'industry'))
  where sheet = 'Company';

create index if not exists idx_records_company_district
  on records ((data ->> 'district'))
  where sheet = 'Company';
