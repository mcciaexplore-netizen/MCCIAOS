// Analytics aggregation. All counting happens in Postgres — nothing is pulled
// into JS to be counted here.
//
// SCHEMA NOTE. This app has no `consultations` / `application_setups` /
// `companies` tables. Everything lives in one `records` table discriminated by
// `sheet`, with entity fields in a `data` jsonb column, so:
//
//   consultations      -> records where sheet = 'Session'
//   application setups -> records where sheet = 'Project'
//   companies          -> records where sheet = 'Company'
//   team members       -> a jsonb array on the Settings record, not a table
//
// There are no foreign keys; Session/Project reference a company by storing its
// uuid as text in data->>'companyId', which is what the joins below use.
//
// TIMEZONE. Every bucket boundary is an Asia/Kolkata calendar day. The column
// is timestamptz, so `created_at at time zone 'Asia/Kolkata'` yields the local
// IST wall-clock time, and `::date` the IST calendar day. Window boundaries are
// built as IST-local timestamps and converted back to timestamptz the opposite
// way, so a row at 23:30 IST and one at 00:30 IST land on different days no
// matter what the server's own offset is. IST has no DST, so these expressions
// are stable and safe to index (db/analytics-indexes.sql).

import { requireSql } from './sql.js';

const IST = 'Asia/Kolkata';

export type PeriodName = 'today' | 'week' | 'month' | 'custom';
export type Granularity = 'day' | 'week' | 'month';
export type MetricName = 'consultations' | 'setups';
export type Dimension =
  | 'sector'
  | 'consultant'
  | 'status'
  | 'type'
  | 'source'
  | 'region';

export const PERIODS: PeriodName[] = ['today', 'week', 'month', 'custom'];
export const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];
export const METRICS: MetricName[] = ['consultations', 'setups'];
export const DIMENSIONS: Dimension[] = [
  'sector',
  'consultant',
  'status',
  'type',
  'source',
  'region',
];

/** The sheet backing each metric. Never taken from user input directly. */
const SHEET_FOR: Record<MetricName, 'Session' | 'Project'> = {
  consultations: 'Session',
  setups: 'Project',
};

// A Project is treated as delivered once it reaches one of these stages.
// ASSUMPTION: stages are user-configurable on the Settings page, so this is the
// default vocabulary from src/constants. If the stages are renamed there, this
// list needs to follow.
const DELIVERED_STAGES = ['Deployed', 'Using'];

/**
 * Computes the current and previous window as timestamptz.
 *
 * The previous window is the same-length span immediately before the current
 * one, shifted by exactly one period (1 day / 7 days / 1 calendar month / the
 * custom range's own length). That keeps the comparison honest part-way
 * through a period: Mon–Wed this week is compared with Mon–Wed last week, not
 * with a full seven days.
 */
const BOUNDS_CTE = `
raw_bounds as (
  select
    case $1::text
      when 'today' then date_trunc('day',   (now() at time zone '${IST}'))
      when 'week'  then date_trunc('week',  (now() at time zone '${IST}'))
      when 'month' then date_trunc('month', (now() at time zone '${IST}'))
      else $2::date::timestamp
    end as cs_local,
    -- Every window ends at "now" in IST, never at a future instant. A custom
    -- range is inclusive of its end date, so it runs to the start of the day
    -- after $3 — but clamped to now, so "custom today..today" and the "today"
    -- period can never disagree, and a record somehow stamped later today is
    -- excluded consistently rather than by one path and not the other.
    least(
      case $1::text
        when 'custom' then ($3::date + 1)::timestamp
        else (now() at time zone '${IST}')
      end,
      (now() at time zone '${IST}')
    ) as ce_local,
    case $1::text
      when 'today' then interval '1 day'
      when 'week'  then interval '7 days'
      when 'month' then interval '1 month'
      else make_interval(days => (($3::date - $2::date) + 1))
    end as shift
),
bounds as (
  select
    (cs_local at time zone '${IST}')            as cur_start,
    (ce_local at time zone '${IST}')            as cur_end,
    ((cs_local - shift) at time zone '${IST}')  as prev_start,
    ((ce_local - shift) at time zone '${IST}')  as prev_end,
    cs_local::date                              as cur_from,
    (ce_local - interval '1 microsecond')::date as cur_to
  from raw_bounds
)`;

export interface PeriodInput {
  period: PeriodName;
  from?: string | null;
  to?: string | null;
}

/**
 * Custom ranges need real dates; the named periods ignore them but the query
 * still binds three parameters, so supply harmless placeholders.
 */
function periodParams({ period, from, to }: PeriodInput): [string, string, string] {
  if (period === 'custom') {
    if (!from || !to) {
      throw new Error("A custom period needs both 'from' and 'to' dates (YYYY-MM-DD).");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new Error("'from' and 'to' must be YYYY-MM-DD dates.");
    }
    if (from > to) throw new Error("'from' must not be after 'to'.");
    return [period, from, to];
  }
  // Bound but unused by the CASE arms for named periods.
  return [period, '2000-01-01', '2000-01-01'];
}

const pct = (cur: number, prev: number): number | null =>
  prev === 0 ? (cur === 0 ? 0 : null) : Number((((cur - prev) / prev) * 100).toFixed(1));

export interface MetricSummary {
  total: number;
  previous: number;
  delta: number;
  /** null means "no baseline" — previous period was zero but this one is not. */
  percentChange: number | null;
  uniqueCompanies: number;
  newCompanies: number;
  repeatCompanies: number;
  statuses: { label: string; count: number; percent: number }[];
}

export interface SummaryResult {
  period: PeriodName;
  from: string;
  to: string;
  timezone: string;
  generatedAt: string;
  consultations: MetricSummary;
  setups: MetricSummary & {
    delivered: number;
    inProgress: number;
    avgDaysConsultationToSetup: number | null;
    linkableSetups: number;
  };
}

/** One round trip: totals, status split, company mix and setup lag together. */
export async function getSummary(input: PeriodInput): Promise<SummaryResult> {
  const db = requireSql();
  const params = [...periodParams(input), DELIVERED_STAGES];

  const text = `
with ${BOUNDS_CTE},
win as (
  select
    r.sheet,
    r.created_at,
    r.data ->> 'companyId' as company_id,
    coalesce(nullif(coalesce(r.data ->> 'status', r.data ->> 'stage'), ''), '(not set)') as status,
    (r.created_at >= b.cur_start and r.created_at < b.cur_end) as is_cur
  from records r
  cross join bounds b
  where r.sheet in ('Session', 'Project')
    and r.created_at >= b.prev_start
    and r.created_at <  b.cur_end
),
-- First ever interaction per company per sheet, over all history rather than
-- just the window: that is what makes a company "new" instead of "repeat".
first_touch as (
  select sheet, data ->> 'companyId' as company_id, min(created_at) as first_at
  from records
  where sheet in ('Session', 'Project') and data ? 'companyId'
  group by 1, 2
),
totals as (
  select
    sheet,
    count(*) filter (where is_cur)                              as cur_total,
    count(*) filter (where not is_cur)                          as prev_total,
    count(distinct company_id) filter (where is_cur)             as cur_companies,
    count(*) filter (where is_cur and sheet = 'Project'
                       and status = any($4::text[]))             as delivered
  from win
  group by sheet
),
company_mix as (
  select
    w.sheet,
    count(distinct w.company_id) filter (where ft.first_at >= b.cur_start) as new_companies,
    count(distinct w.company_id) filter (where ft.first_at <  b.cur_start) as repeat_companies
  from win w
  cross join bounds b
  join first_touch ft on ft.sheet = w.sheet and ft.company_id = w.company_id
  where w.is_cur and w.company_id is not null
  group by 1
),
status_counts as (
  select sheet, jsonb_agg(jsonb_build_object('label', status, 'count', n) order by n desc) as rows
  from (
    select sheet, status, count(*)::int as n
    from win where is_cur group by 1, 2
  ) s group by sheet
),
-- Days from a company's first consultation to each setup created in the window.
-- Only setups whose company had an earlier Session are linkable.
setup_lag as (
  select
    avg(extract(epoch from (p.created_at - fs.first_session)) / 86400.0)::numeric(10,2) as avg_days,
    count(*)::int as linkable
  from win p
  join lateral (
    select min(s.created_at) as first_session
    from records s
    where s.sheet = 'Session'
      and s.data ->> 'companyId' = p.company_id
      and s.created_at <= p.created_at
  ) fs on fs.first_session is not null
  where p.sheet = 'Project' and p.is_cur and p.company_id is not null
)
select
  (select to_char(cur_from, 'YYYY-MM-DD') from bounds) as from_date,
  (select to_char(cur_to,   'YYYY-MM-DD') from bounds) as to_date,
  coalesce((select cur_total     from totals where sheet='Session'), 0) as c_total,
  coalesce((select prev_total    from totals where sheet='Session'), 0) as c_prev,
  coalesce((select cur_companies from totals where sheet='Session'), 0) as c_companies,
  coalesce((select new_companies    from company_mix where sheet='Session'), 0) as c_new,
  coalesce((select repeat_companies from company_mix where sheet='Session'), 0) as c_repeat,
  coalesce((select rows from status_counts where sheet='Session'), '[]'::jsonb) as c_status,
  coalesce((select cur_total     from totals where sheet='Project'), 0) as p_total,
  coalesce((select prev_total    from totals where sheet='Project'), 0) as p_prev,
  coalesce((select cur_companies from totals where sheet='Project'), 0) as p_companies,
  coalesce((select new_companies    from company_mix where sheet='Project'), 0) as p_new,
  coalesce((select repeat_companies from company_mix where sheet='Project'), 0) as p_repeat,
  coalesce((select rows from status_counts where sheet='Project'), '[]'::jsonb) as p_status,
  coalesce((select delivered from totals where sheet='Project'), 0) as p_delivered,
  (select avg_days  from setup_lag) as p_avg_days,
  coalesce((select linkable from setup_lag), 0) as p_linkable
`;

  const rows = (await db.query(text, params)) as Record<string, unknown>[];
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);

  const withPercent = (raw: unknown, total: number) =>
    ((raw as { label: string; count: number }[]) ?? []).map((s) => ({
      label: s.label,
      count: Number(s.count),
      percent: total ? Number(((Number(s.count) / total) * 100).toFixed(1)) : 0,
    }));

  const cTotal = n('c_total');
  const pTotal = n('p_total');

  return {
    period: input.period,
    from: String(r.from_date ?? ''),
    to: String(r.to_date ?? ''),
    timezone: IST,
    generatedAt: new Date().toISOString(),
    consultations: {
      total: cTotal,
      previous: n('c_prev'),
      delta: cTotal - n('c_prev'),
      percentChange: pct(cTotal, n('c_prev')),
      uniqueCompanies: n('c_companies'),
      newCompanies: n('c_new'),
      repeatCompanies: n('c_repeat'),
      statuses: withPercent(r.c_status, cTotal),
    },
    setups: {
      total: pTotal,
      previous: n('p_prev'),
      delta: pTotal - n('p_prev'),
      percentChange: pct(pTotal, n('p_prev')),
      uniqueCompanies: n('p_companies'),
      newCompanies: n('p_new'),
      repeatCompanies: n('p_repeat'),
      statuses: withPercent(r.p_status, pTotal),
      delivered: n('p_delivered'),
      inProgress: pTotal - n('p_delivered'),
      avgDaysConsultationToSetup:
        r.p_avg_days == null ? null : Number(r.p_avg_days),
      linkableSetups: n('p_linkable'),
    },
  };
}

export interface TimeseriesPoint {
  bucket: string;
  count: number;
}

/**
 * Zero-filled counts per bucket. generate_series produces every bucket in the
 * range and the left join fills the gaps, so a quiet day is a 0 rather than a
 * missing point the chart would silently close over.
 */
export async function getTimeseries(
  metric: MetricName,
  granularity: Granularity,
  buckets: number,
): Promise<TimeseriesPoint[]> {
  const db = requireSql();
  const sheet = SHEET_FOR[metric];

  const text = `
with span as (
  select
    date_trunc($2, (now() at time zone '${IST}')) as last_bucket,
    date_trunc($2, (now() at time zone '${IST}')) - make_interval(
      days   => case when $2 = 'day'   then ($3::int - 1) else 0 end,
      weeks  => case when $2 = 'week'  then ($3::int - 1) else 0 end,
      months => case when $2 = 'month' then ($3::int - 1) else 0 end
    ) as first_bucket
),
series as (
  select generate_series(first_bucket, last_bucket, ('1 ' || $2)::interval) as bucket
  from span
),
counts as (
  select date_trunc($2, (r.created_at at time zone '${IST}')) as bucket, count(*)::int as n
  from records r, span s
  where r.sheet = $1
    and (r.created_at at time zone '${IST}') >= s.first_bucket
    and (r.created_at at time zone '${IST}') <  s.last_bucket + ('1 ' || $2)::interval
  group by 1
)
select to_char(s.bucket, 'YYYY-MM-DD') as bucket, coalesce(c.n, 0)::int as count
from series s
left join counts c on c.bucket = s.bucket
order by s.bucket`;

  const rows = (await db.query(text, [sheet, granularity, buckets])) as {
    bucket: string;
    count: number;
  }[];
  return rows.map((x) => ({ bucket: x.bucket, count: Number(x.count) }));
}

// Dimension -> SQL expression. An allowlist, so nothing user-supplied is ever
// interpolated into the statement.
//
// COLUMNS NOT FOUND. Session and Project carry no sector, region or channel of
// their own; those attributes belong to the linked Company, so these reach
// through data->>'companyId'. There is no application-type column at all — a
// Project has only a free-text `title` — so 'type' groups by title, which is
// the closest thing that exists.
const DIMENSION_SQL: Record<Dimension, string> = {
  sector: `co.data ->> 'industry'`,
  region: `co.data ->> 'district'`,
  consultant: `r.assigned_to`,
  status: `coalesce(r.data ->> 'status', r.data ->> 'stage')`,
  type: `case when r.sheet = 'Project' then r.data ->> 'title' else r.data ->> 'mode' end`,
  source: `coalesce(r.data ->> 'mode', co.data ->> 'leadSource')`,
};

export interface BreakdownRow {
  label: string;
  count: number;
  percent: number;
}

export async function getBreakdown(
  metric: MetricName,
  dimension: Dimension,
  input: PeriodInput,
  limit = 15,
): Promise<BreakdownRow[]> {
  const db = requireSql();
  const expr = DIMENSION_SQL[dimension];
  if (!expr) throw new Error(`Unknown dimension "${dimension}".`);

  const text = `
with ${BOUNDS_CTE},
rows_in_window as (
  select coalesce(nullif(trim(${expr}), ''), '(not set)') as label
  from records r
  cross join bounds b
  left join records co
    on co.sheet = 'Company'
   and co.id::text = r.data ->> 'companyId'
  where r.sheet = $4
    and r.created_at >= b.cur_start
    and r.created_at <  b.cur_end
),
tallied as (
  select label, count(*)::int as n from rows_in_window group by 1
)
select label, n as count,
       round((n::numeric * 100) / nullif(sum(n) over (), 0), 1)::float8 as percent
from tallied
order by n desc, label
limit $5`;

  const rows = (await db.query(text, [
    ...periodParams(input),
    SHEET_FOR[metric],
    limit,
  ])) as BreakdownRow[];
  return rows.map((x) => ({
    label: x.label,
    count: Number(x.count),
    percent: Number(x.percent ?? 0),
  }));
}

export interface ActivityRow {
  id: string;
  kind: 'consultation' | 'setup';
  company: string | null;
  date: string;
  consultant: string | null;
  status: string | null;
  title: string | null;
}

/** Recent line items across both metrics, newest first. */
export async function getActivity(
  input: PeriodInput,
  limit = 20,
  offset = 0,
): Promise<{ rows: ActivityRow[]; total: number }> {
  const db = requireSql();

  const text = `
with ${BOUNDS_CTE},
items as (
  select
    r.id::text as id,
    case when r.sheet = 'Session' then 'consultation' else 'setup' end as kind,
    co.data ->> 'companyName' as company,
    to_char(r.created_at at time zone '${IST}', 'YYYY-MM-DD HH24:MI') as date,
    r.assigned_to as consultant,
    coalesce(r.data ->> 'status', r.data ->> 'stage') as status,
    coalesce(r.data ->> 'title', r.data ->> 'query') as title,
    r.created_at
  from records r
  cross join bounds b
  left join records co
    on co.sheet = 'Company'
   and co.id::text = r.data ->> 'companyId'
  where r.sheet in ('Session', 'Project')
    and r.created_at >= b.cur_start
    and r.created_at <  b.cur_end
)
select *, count(*) over ()::int as total
from items order by created_at desc limit $4 offset $5`;

  const rows = (await db.query(text, [
    ...periodParams(input),
    limit,
    offset,
  ])) as (ActivityRow & { total: number; created_at: string })[];

  // created_at is selected only to sort by; drop it (along with the window
  // count) so the response shape matches ActivityRow exactly.
  return {
    rows: rows.map(({ total: _t, created_at: _c, ...r }) => r),
    total: rows[0]?.total ?? 0,
  };
}

export interface CapacityRow {
  member: string;
  /** Work created in the window — what they took on. */
  consultations: number;
  setups: number;
  messages: number;
  /** Open regardless of window — what is still on their plate right now. */
  openConsultations: number;
  openSetups: number;
  overdueFollowups: number;
  dueSoonFollowups: number;
  /** Open items weighted by type; the single number the bar is drawn from. */
  load: number;
}

// Relative weights for the load score. A half-built project occupies far more
// of someone's week than an open consultation, which in turn outweighs a
// follow-up ping — a flat count would rank a person with ten reminders above
// one carrying three live builds.
const LOAD_WEIGHTS = { setup: 3, consultation: 1, followup: 0.5 };

/**
 * Team bandwidth: who is carrying what right now.
 *
 * Deliberately mixes two horizons. Throughput columns are scoped to the
 * selected period, because "what did they do this month" is a period question.
 * The open/overdue columns ignore the period entirely — an unfinished project
 * from March is still on that person's plate today, and hiding it because it
 * started outside the window would defeat the point of a capacity view.
 */
export async function getCapacity(input: PeriodInput): Promise<CapacityRow[]> {
  const db = requireSql();

  const text = `
with ${BOUNDS_CTE},
-- The roster lives as a jsonb array on the Settings record, not a table, so
-- it is unnested here. Falling back to whoever appears in assigned_to keeps
-- the view honest if Settings has not been saved yet.
-- The LIMIT has to be applied to the Settings row *before* unnesting: a
-- set-returning function in the select list expands rows first, so
-- "... from records where sheet='Settings' limit 1" would return one team
-- member rather than one settings record.
roster as (
  select jsonb_array_elements_text(s.data -> 'teamMembers') as member
  from (
    select data from records where sheet = 'Settings' order by created_at limit 1
  ) s
),
members as (
  select member from roster
  union
  select distinct assigned_to from records
  where assigned_to is not null and assigned_to <> ''
    and sheet in ('Session', 'Project', 'Message', 'Followup')
),
in_period as (
  select r.assigned_to as member,
    count(*) filter (where r.sheet = 'Session') as consultations,
    count(*) filter (where r.sheet = 'Project') as setups,
    count(*) filter (where r.sheet = 'Message') as messages
  from records r cross join bounds b
  where r.created_at >= b.cur_start and r.created_at < b.cur_end
    and r.sheet in ('Session', 'Project', 'Message')
  group by 1
),
open_now as (
  select assigned_to as member,
    count(*) filter (
      where sheet = 'Session'
        and coalesce(data ->> 'status', '') not in ('Completed')
    ) as open_consultations,
    count(*) filter (
      where sheet = 'Project'
        and coalesce(data ->> 'stage', '') <> all($4::text[])
    ) as open_setups
  from records
  where sheet in ('Session', 'Project')
  group by 1
),
followups as (
  select assigned_to as member,
    count(*) filter (
      where (data ->> 'dueDate')::date < (now() at time zone '${IST}')::date
    ) as overdue,
    count(*) filter (
      where (data ->> 'dueDate')::date between (now() at time zone '${IST}')::date
        and (now() at time zone '${IST}')::date + 3
    ) as due_soon
  from records
  where sheet = 'Followup'
    and coalesce((data ->> 'done')::boolean, false) = false
    and (data ->> 'dueDate') ~ '^\\d{4}-\\d{2}-\\d{2}'
  group by 1
)
select
  m.member,
  coalesce(p.consultations, 0)::int      as consultations,
  coalesce(p.setups, 0)::int             as setups,
  coalesce(p.messages, 0)::int           as messages,
  coalesce(o.open_consultations, 0)::int as "openConsultations",
  coalesce(o.open_setups, 0)::int        as "openSetups",
  coalesce(f.overdue, 0)::int            as "overdueFollowups",
  coalesce(f.due_soon, 0)::int           as "dueSoonFollowups",
  (coalesce(o.open_setups, 0) * ${LOAD_WEIGHTS.setup}
   + coalesce(o.open_consultations, 0) * ${LOAD_WEIGHTS.consultation}
   + coalesce(f.overdue, 0) * ${LOAD_WEIGHTS.followup}
   + coalesce(f.due_soon, 0) * ${LOAD_WEIGHTS.followup})::float8 as load
from members m
left join in_period p on p.member = m.member
left join open_now  o on o.member = m.member
left join followups f on f.member = m.member
where m.member is not null and m.member <> ''
order by load desc, m.member`;

  const rows = (await db.query(text, [
    ...periodParams(input),
    DELIVERED_STAGES,
  ])) as CapacityRow[];

  return rows.map((r) => ({
    member: r.member,
    consultations: Number(r.consultations),
    setups: Number(r.setups),
    messages: Number(r.messages),
    openConsultations: Number(r.openConsultations),
    openSetups: Number(r.openSetups),
    overdueFollowups: Number(r.overdueFollowups),
    dueSoonFollowups: Number(r.dueSoonFollowups),
    load: Number(r.load),
  }));
}

/** Every line item in the period — the CSV export and the PDF appendix. */
export async function getLineItems(input: PeriodInput): Promise<ActivityRow[]> {
  const { rows } = await getActivity(input, 100000, 0);
  return rows;
}
