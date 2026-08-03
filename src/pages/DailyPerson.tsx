import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Percent,
  Timer,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState, Input, Select } from '@/components/ui';
import {
  CategoryChip,
  PriorityChip,
  RowsSkeleton,
  StatTile,
  StatTileSkeleton,
  StatusChip,
  formatMins,
  formatPct,
} from '@/components/DailyChips';
import { dailyApi } from '@/lib/dailyLogsApi';
import { LOG_STATUSES } from '@/schemas/dailyLogs';
import { LOG_STATUS_LABELS } from '@/constants';
import { describeDate, istToday, shiftDate } from '@/lib/ist';
import { formatDate } from '@/lib/utils';
import type { DailyLog } from '@/types';

export default function DailyPerson() {
  const { userId = '' } = useParams<{ userId: string }>();
  const [params, setParams] = useSearchParams();

  // Defaults to the last 14 IST days, which is long enough to show a pattern
  // without pulling someone's whole history on first load.
  const to = params.get('to') || istToday();
  const from = params.get('from') || shiftDate(to, -13);
  const status = params.get('status') ?? '';

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => dailyApi.users() });
  const user = usersQuery.data?.users.find((u) => u.id === userId);

  const logsQuery = useQuery({
    queryKey: ['daily-logs', 'person', userId, from, to, status],
    queryFn: () =>
      dailyApi.logs({ from, to, user_id: userId, status: status || undefined }),
    enabled: Boolean(userId),
  });

  const logs = logsQuery.data?.logs ?? [];

  const { byDate, stats } = useMemo(() => {
    // Server orders by log_date desc, so insertion order into the Map is
    // already newest-first and needs no re-sorting here.
    const groups = new Map<string, DailyLog[]>();
    for (const log of logs) {
      const list = groups.get(log.logDate);
      if (list) list.push(log);
      else groups.set(log.logDate, [log]);
    }
    const done = logs.filter((l) => l.status === 'DONE').length;
    const mins = logs.reduce((sum, l) => sum + (l.timeSpentMins ?? 0), 0);
    return {
      byDate: [...groups.entries()],
      stats: {
        tasks: logs.length,
        done,
        mins,
        rate: logs.length ? Math.round((done / logs.length) * 1000) / 10 : null,
      },
    };
  }, [logs]);

  const error = (logsQuery.error ?? usersQuery.error) as Error | null;

  return (
    <div>
      <Link
        to="/daily"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" /> Team Day
      </Link>

      <PageHeader
        title={user?.name ?? 'Team member'}
        subtitle={`${formatDate(from)} — ${formatDate(to)}${
          status ? ` · ${LOG_STATUS_LABELS[status as keyof typeof LOG_STATUS_LABELS]} only` : ''
        }`}
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
        <div className="w-44">
          <Select
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LOG_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {(status || params.get('from') || params.get('to')) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ from: '', to: '', status: '' })}
          >
            Reset
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorState error={error} onRetry={() => logsQuery.refetch()} />
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {logsQuery.isLoading ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile
              label="Tasks logged"
              value={stats.tasks}
              tone="brand"
              icon={<ClipboardList className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Done"
              value={stats.done}
              tone="green"
              icon={<CheckCircle2 className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Completion"
              value={formatPct(stats.rate)}
              tone="violet"
              icon={<Percent className="h-[18px] w-[18px]" />}
              foot={stats.rate === null ? 'Nothing logged' : 'For this range'}
            />
            <StatTile
              label="Time recorded"
              value={formatMins(stats.mins)}
              tone="amber"
              icon={<Timer className="h-[18px] w-[18px]" />}
            />
          </>
        )}
      </div>

      {logsQuery.isLoading ? (
        <Card className="overflow-hidden">
          <RowsSkeleton />
        </Card>
      ) : byDate.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title="Nothing in this range"
          description={
            status
              ? 'No entries with that status. Try clearing the status filter or widening the dates.'
              : 'No entries were logged between these dates.'
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ from: '', to: '', status: '' })}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {byDate.map(([date, dayLogs]) => (
            <Card key={date} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {formatDate(date)}
                  {describeDate(date) && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {describeDate(date)}
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-slate-400">
                  {dayLogs.filter((l) => l.status === 'DONE').length}/{dayLogs.length} done
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dayLogs.map((log) => (
                      <tr key={log.id} className="align-top">
                        <td className="max-w-[24rem] px-4 py-2.5">
                          <div className="font-medium text-slate-800 dark:text-slate-100">
                            {log.title}
                          </div>
                          {log.output && (
                            <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                              {log.output}
                            </div>
                          )}
                          {log.status === 'BLOCKED' && log.blockerNote && (
                            <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">
                              Blocked: {log.blockerNote}
                            </div>
                          )}
                          {log.carriedFromId && (
                            <div className="mt-0.5 text-xs text-slate-400">
                              Carried over from an earlier day
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <CategoryChip category={log.category} />
                            <PriorityChip priority={log.priority} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <StatusChip status={log.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-500">
                          {formatMins(log.timeSpentMins)}
                        </td>
                        <td className="w-8 px-3 py-2.5 text-right">
                          {log.outputLink && (
                            <a
                              href={log.outputLink}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={`Open the deliverable for ${log.title}`}
                              className="text-slate-400 hover:text-brand-600"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
