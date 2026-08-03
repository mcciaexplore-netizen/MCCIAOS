import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, RefreshCw, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState, Input } from '@/components/ui';
import { RowsSkeleton, formatMins, formatPct } from '@/components/DailyChips';
import { useToast } from '@/components/Toast';
import { dailyApi } from '@/lib/dailyLogsApi';
import { LOG_CATEGORY_LABELS } from '@/constants';
import { istToday, shiftDate } from '@/lib/ist';
import { formatDate } from '@/lib/utils';

export default function DailySummary() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  // Defaults to the last 7 IST days inclusive — the same window the API uses
  // when no range is given.
  const to = params.get('to') || istToday();
  const from = params.get('from') || shiftDate(to, -6);

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const summary = useQuery({
    queryKey: ['daily-summary', from, to],
    queryFn: () => dailyApi.summary(from, to),
  });

  const sync = useMutation({
    mutationFn: () => dailyApi.syncUsers(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['daily-summary'] });
      toast(
        res.added === 0
          ? 'Roster already up to date'
          : `Added ${res.added} member${res.added === 1 ? '' : 's'} from Settings`,
        res.added === 0 ? 'info' : 'success',
      );
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const rows = summary.data?.rows ?? [];
  const categories = summary.data?.categories ?? [];

  const totals = rows.reduce(
    (acc, r) => ({
      tasks: acc.tasks + r.tasks,
      done: acc.done + r.done,
      mins: acc.mins + r.totalMins,
    }),
    { tasks: 0, done: 0, mins: 0 },
  );
  const overallRate = totals.tasks
    ? Math.round((totals.done / totals.tasks) * 1000) / 10
    : null;

  const maxCategory = Math.max(1, ...categories.map((c) => c.count));

  async function exportCsv() {
    setExporting(true);
    try {
      await dailyApi.exportCsv(from, to);
      toast('Export downloaded');
    } catch (err) {
      toast((err as Error).message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Daily Log Summary"
        subtitle={`${formatDate(from)} — ${formatDate(to)} · Asia/Kolkata days`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
              title="Add anyone who was added to the team roster in Settings"
            >
              {sync.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync roster
            </Button>
            <Button
              size="sm"
              disabled={exporting || rows.length === 0}
              onClick={exportCsv}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export CSV
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="w-[9.5rem]">
          <Input
            type="date"
            value={from}
            max={to}
            onChange={(e) => set({ from: e.target.value })}
            aria-label="From date"
          />
        </div>
        <span className="text-sm text-slate-400">to</span>
        <div className="w-[9.5rem]">
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => set({ to: e.target.value })}
            aria-label="To date"
          />
        </div>
        {[
          { label: 'Last 7 days', days: 6 },
          { label: 'Last 30 days', days: 29 },
        ].map((preset) => (
          <Button
            key={preset.label}
            variant="ghost"
            size="sm"
            onClick={() =>
              set({ from: shiftDate(istToday(), -preset.days), to: istToday() })
            }
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {summary.isError && (
        <div className="mb-4">
          <ErrorState
            error={summary.error as Error}
            onRetry={() => summary.refetch()}
          />
        </div>
      )}

      <Card className="mb-5 overflow-hidden">
        {summary.isLoading ? (
          <RowsSkeleton />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title="No team members yet"
              description="The roster is seeded from the team list on the Settings page. Add people there, then sync."
              action={
                <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  <RefreshCw className="h-4 w-4" /> Sync roster
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-3 py-2 font-medium">Member</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Tasks</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Done</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">In progress</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Blocked</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Carried</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Completion</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.userId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <Link
                        to={`/daily/person/${r.userId}?from=${from}&to=${to}`}
                        className="text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {r.userName}
                      </Link>
                    </td>
                    {/* A member who logged nothing is shown as a dash rather than
                        a zero: no data and a real zero are different facts. */}
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {r.tasks === 0 ? <span className="text-slate-300">—</span> : r.tasks}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.done}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.inProgress}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.blocked > 0 ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500'}>
                        {r.blocked}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.carriedForward}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatPct(r.completionRate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {formatMins(r.totalMins)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                <tr>
                  <td className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-300">
                    Team
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{totals.tasks}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{totals.done}</td>
                  <td colSpan={3} />
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatPct(overallRate)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatMins(totals.mins)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Where the time went
      </h3>
      <Card className="p-4">
        {summary.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No tasks logged in this range.
          </p>
        ) : (
          <div className="space-y-2.5">
            {categories.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-slate-600 dark:text-slate-300">
                  {LOG_CATEGORY_LABELS[c.category]}
                </span>
                <span className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max((c.count / maxCategory) * 100, 3)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-slate-700 dark:text-slate-200">
                  {c.count}
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-400">
                  {formatMins(c.totalMins)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
