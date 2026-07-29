import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Minus,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, ErrorState, FilterPill, Input } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { RankedBars, Sparkline, TimeBars, type Series } from '@/components/charts';
import {
  analytics,
  type ActivityRow,
  type CapacityRow,
  type Dimension,
  type Granularity,
  type MetricName,
  type MetricSummary,
  type PeriodName,
  type PeriodQuery,
  type ReportFormat,
  type Summary,
} from '@/lib/analyticsApi';

const PERIOD_LABELS: Record<PeriodName, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  custom: 'Custom Range',
};

const PAGE_SIZE = 20;

/**
 * The whole view is driven by the URL, so a filtered analytics view can be
 * pasted to someone else and survives a refresh.
 */
function usePeriodFromUrl() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const period: PeriodName = (
    ['today', 'week', 'month', 'custom'] as const
  ).includes(raw as PeriodName)
    ? (raw as PeriodName)
    : 'month';

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const set = useCallback(
    (next: Partial<{ period: PeriodName; from: string; to: string; g: Granularity }>) => {
      const p = new URLSearchParams(params);
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const granularity = (params.get('g') ?? 'day') as Granularity;

  // A custom period is only sent once both ends are chosen; until then the
  // query would 400, so fall back to the month view rather than flashing an error.
  const query: PeriodQuery =
    period === 'custom' && from && to ? { period, from, to } : { period: period === 'custom' ? 'month' : period };

  return { period, from, to, granularity, set, query, incomplete: period === 'custom' && !(from && to) };
}

export default function Analytics() {
  const { period, from, to, granularity, set, query, incomplete } = usePeriodFromUrl();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: keyof ActivityRow; dir: 1 | -1 }>({
    key: 'date',
    dir: -1,
  });

  const key = [query.period, query.from ?? '', query.to ?? ''];

  const summary = useQuery({
    queryKey: ['an-summary', ...key],
    queryFn: () => analytics.summary(query),
  });
  const cSeries = useQuery({
    queryKey: ['an-ts', 'consultations', granularity, ...key],
    queryFn: () => analytics.timeseries(query, 'consultations', granularity),
  });
  const sSeries = useQuery({
    queryKey: ['an-ts', 'setups', granularity, ...key],
    queryFn: () => analytics.timeseries(query, 'setups', granularity),
  });
  const activity = useQuery({
    queryKey: ['an-act', page, ...key],
    queryFn: () => analytics.activity(query, PAGE_SIZE, page * PAGE_SIZE),
  });

  async function download(format: ReportFormat) {
    setMenuOpen(false);
    setDownloading(format);
    try {
      await analytics.download(query, format);
      toast(`${format.toUpperCase()} report downloaded`);
    } catch (err) {
      toast((err as Error).message || 'Report failed', 'error');
    } finally {
      setDownloading(null);
    }
  }

  const rows = useMemo(() => {
    const list = [...(activity.data?.rows ?? [])];
    list.sort((a, b) => {
      const x = String(a[sort.key] ?? '');
      const y = String(b[sort.key] ?? '');
      return x.localeCompare(y) * sort.dir;
    });
    return list;
  }, [activity.data, sort]);

  const failed = summary.error as Error | null;

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={
          summary.data
            ? `${summary.data.from} to ${summary.data.to} · ${summary.data.timezone}`
            : 'Consultations and application setups'
        }
        actions={
          <div className="relative">
            <Button
              size="sm"
              variant="secondary"
              disabled={!!downloading}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? `Building ${downloading.toUpperCase()}...` : 'Download Report'}
            </Button>
            {menuOpen && !downloading && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <MenuItem onClick={() => download('pdf')} icon={<FileText className="h-4 w-4" />}>
                    PDF report
                  </MenuItem>
                  <MenuItem onClick={() => download('xlsx')} icon={<FileSpreadsheet className="h-4 w-4" />}>
                    Excel workbook
                  </MenuItem>
                  <MenuItem onClick={() => download('csv')} icon={<FileSpreadsheet className="h-4 w-4" />}>
                    CSV line items
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        }
      />

      {/* 1. Period selector */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(Object.keys(PERIOD_LABELS) as PeriodName[]).map((p) => (
            <FilterPill
              key={p}
              active={period === p}
              onClick={() => {
                setPage(0);
                set({ period: p });
              }}
            >
              {PERIOD_LABELS[p]}
            </FilterPill>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setPage(0);
                set({ from: e.target.value });
              }}
              className="w-auto"
              aria-label="From date"
            />
            <span className="text-sm text-slate-400">to</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setPage(0);
                set({ to: e.target.value });
              }}
              className="w-auto"
              aria-label="To date"
            />
          </div>
        )}
      </div>

      {incomplete && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          Pick both a start and an end date. Showing this month until then.
        </p>
      )}

      {failed && (
        <div className="mb-4">
          <ErrorState error={failed} onRetry={() => summary.refetch()} />
        </div>
      )}

      {/* 2. KPI cards */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {summary.isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : summary.data ? (
          <>
            <Kpi
              label="Consultations"
              m={summary.data.consultations}
              series="consultations"
              spark={cSeries.data?.points.map((p) => p.count) ?? []}
              foot={`${summary.data.consultations.uniqueCompanies} companies · ${summary.data.consultations.newCompanies} new`}
            />
            <Kpi
              label="Application Setups"
              m={summary.data.setups}
              series="setups"
              spark={sSeries.data?.points.map((p) => p.count) ?? []}
              foot={`${summary.data.setups.delivered} delivered · ${summary.data.setups.inProgress} in progress`}
            />
          </>
        ) : null}
      </div>

      {/* 3. Time series */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Over time</h3>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(['day', 'week', 'month'] as Granularity[]).map((g) => (
            <FilterPill key={g} active={granularity === g} onClick={() => set({ g })}>
              {g === 'day' ? '30 days' : g === 'week' ? '12 weeks' : '12 months'}
            </FilterPill>
          ))}
        </div>
      </div>
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Consultations"
          series="consultations"
          q={cSeries}
          emptyLabel={`No consultations recorded ${periodPhrase(period)}`}
        />
        <ChartCard
          title="Application setups"
          series="setups"
          q={sSeries}
          emptyLabel={`No application setups recorded ${periodPhrase(period)}`}
        />
      </div>

      {/* 4. Breakdowns */}
      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Breakdowns
      </h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BreakdownCard title="By sector" metric="consultations" dimension="sector" q={query} series="consultations" />
        <BreakdownCard title="By consultant" metric="consultations" dimension="consultant" q={query} series="consultations" />
        <BreakdownCard title="Consultation status" metric="consultations" dimension="status" q={query} series="consultations" />
        <BreakdownCard title="Application type" metric="setups" dimension="type" q={query} series="setups" />
      </div>

      {/* 4b. Team bandwidth */}
      <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Team bandwidth
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        Throughput is for the selected period; open and overdue counts are current,
        regardless of period — unfinished work does not stop mattering because it
        started earlier.
      </p>
      <CapacitySection q={query} />

      {/* 5. Recent activity */}
      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Recent activity
      </h3>
      <Card className="overflow-hidden">
        {activity.isLoading ? (
          <TableSkeleton />
        ) : activity.error ? (
          <div className="p-4">
            <ErrorState error={activity.error as Error} onRetry={() => activity.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No consultations or setups recorded {periodPhrase(period)}.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                  <tr>
                    {(
                      [
                        ['kind', 'Type'],
                        ['company', 'Company'],
                        ['date', 'Date (IST)'],
                        ['consultant', 'Consultant'],
                        ['status', 'Status'],
                      ] as [keyof ActivityRow, string][]
                    ).map(([k, label]) => (
                      <th key={k} className="whitespace-nowrap px-4 py-2 font-medium">
                        <button
                          className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                          onClick={() =>
                            setSort((s) =>
                              s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: 1 },
                            )
                          }
                        >
                          {label}
                          {sort.key === k && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-2">
                        <Badge tone={r.kind === 'consultation' ? 'green' : 'amber'}>
                          {r.kind === 'consultation' ? 'Consult' : 'Setup'}
                        </Badge>
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2 text-slate-700 dark:text-slate-200">
                        {r.company ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">{r.date}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{r.consultant ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{r.status ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
              <span>
                {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} of {activity.data?.total ?? 0}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(page + 1) * PAGE_SIZE >= (activity.data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Who is carrying what. The bar is the weighted load score, so the row order
 * and the bar agree; the raw counts sit alongside so the number is never only
 * readable as a length.
 */
function CapacitySection({ q }: { q: PeriodQuery }) {
  const query = useQuery({
    queryKey: ['an-cap', q.period, q.from ?? '', q.to ?? ''],
    queryFn: () => analytics.capacity(q),
  });

  if (query.isLoading) {
    return (
      <Card className="mb-6 p-4">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      </Card>
    );
  }
  if (query.error) {
    return (
      <div className="mb-6">
        <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />
      </div>
    );
  }

  const rows = query.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <Card className="mb-6 p-6">
        <p className="text-center text-sm text-slate-400">
          No team members configured yet. Add them in Settings → Team.
        </p>
      </Card>
    );
  }

  const maxLoad = Math.max(1, ...rows.map((r) => r.load));

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
            <tr>
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Current load</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Open</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Overdue</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Due soon</th>
              <th className="whitespace-nowrap px-4 py-2 text-right font-medium">In period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r: CapacityRow) => (
              <tr key={r.member}>
                <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700 dark:text-slate-200">
                  {r.member}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-full min-w-[3rem] max-w-[10rem] rounded-full bg-slate-100 dark:bg-slate-800">
                      <span
                        className={
                          'block h-full rounded-full ' +
                          (r.overdueFollowups > 0
                            ? 'bg-rose-500'
                            : r.load >= maxLoad * 0.75
                              ? 'bg-amber-500'
                              : 'bg-emerald-500')
                        }
                        style={{ width: `${Math.max((r.load / maxLoad) * 100, r.load > 0 ? 4 : 0)}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-xs text-slate-400">
                      {r.load.toFixed(1)}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-500">
                  {r.openSetups > 0 && (
                    <span title="Open setups">{r.openSetups}s</span>
                  )}
                  {r.openSetups > 0 && r.openConsultations > 0 && ' · '}
                  {r.openConsultations > 0 && (
                    <span title="Open consultations">{r.openConsultations}c</span>
                  )}
                  {r.openSetups === 0 && r.openConsultations === 0 && '—'}
                </td>
                <td
                  className={
                    'px-4 py-2 text-right tabular-nums ' +
                    (r.overdueFollowups > 0
                      ? 'font-medium text-rose-600 dark:text-rose-400'
                      : 'text-slate-400')
                  }
                >
                  {r.overdueFollowups || '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                  {r.dueSoonFollowups || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-500">
                  {r.consultations + r.setups + r.messages || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400 dark:border-slate-800">
        Load weights open work by type — a setup counts 3, a consultation 1, a
        follow-up 0.5 — so three live builds outrank ten reminders. Red marks
        anyone with an overdue follow-up.
      </p>
    </Card>
  );
}

const periodPhrase = (p: PeriodName) =>
  p === 'today' ? 'today' : p === 'week' ? 'this week' : p === 'month' ? 'this month' : 'in this range';

function MenuItem({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {icon}
      {children}
    </button>
  );
}

function Kpi({
  label,
  m,
  series,
  spark,
  foot,
}: {
  label: string;
  m: MetricSummary;
  series: Series;
  spark: number[];
  foot: string;
}) {
  const up = m.delta > 0;
  const flat = m.delta === 0;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {m.total}
          </p>
          <p
            className={
              'mt-1 flex flex-wrap items-center gap-1 text-xs ' +
              (flat
                ? 'text-slate-400'
                : up
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400')
            }
          >
            {flat ? (
              <Minus className="h-3 w-3" />
            ) : up ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            <span className="tabular-nums">
              {m.delta > 0 ? '+' : ''}
              {m.delta}
              {m.percentChange !== null && ` (${m.percentChange > 0 ? '+' : ''}${m.percentChange}%)`}
            </span>
            <span className="text-slate-400">vs previous</span>
          </p>
        </div>
        <Sparkline points={spark} series={series} className="h-8 w-28 shrink-0" />
      </div>
      <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800">
        {foot}
      </p>
    </Card>
  );
}

function ChartCard({
  title,
  series,
  q,
  emptyLabel,
}: {
  title: string;
  series: Series;
  q: { data?: { points: { bucket: string; count: number }[] }; isLoading: boolean; error: unknown; refetch: () => void };
  emptyLabel: string;
}) {
  const points = q.data?.points ?? [];
  const empty = points.length > 0 && points.every((p) => p.count === 0);
  return (
    <Card className="p-4">
      <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</h4>
      {q.isLoading ? (
        <div className="h-[196px] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : q.error ? (
        <ErrorState error={q.error as Error} onRetry={q.refetch} />
      ) : empty || points.length === 0 ? (
        <p className="flex h-[196px] items-center justify-center text-center text-sm text-slate-400">
          {emptyLabel}
        </p>
      ) : (
        <TimeBars points={points} series={series} />
      )}
    </Card>
  );
}

function BreakdownCard({
  title,
  metric,
  dimension,
  q,
  series,
}: {
  title: string;
  metric: MetricName;
  dimension: Dimension;
  q: PeriodQuery;
  series: Series;
}) {
  const query = useQuery({
    queryKey: ['an-bd', metric, dimension, q.period, q.from ?? '', q.to ?? ''],
    queryFn: () => analytics.breakdown(q, metric, dimension),
  });

  return (
    <Card className="p-4">
      <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">{title}</h4>
      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-1.5 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />
      ) : (query.data?.rows.length ?? 0) === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Nothing recorded in this period.</p>
      ) : (
        <RankedBars rows={query.data!.rows} series={series} />
      )}
    </Card>
  );
}

// Skeletons match the real components' dimensions so nothing shifts on load.
function KpiSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="w-full space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-8 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-40 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="h-8 w-28 shrink-0 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="mt-3 h-3 w-48 animate-pulse rounded bg-slate-100 pt-2 dark:bg-slate-800" />
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-4 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
