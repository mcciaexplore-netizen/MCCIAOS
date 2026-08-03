import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  UserX,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState } from '@/components/ui';
import {
  CategoryChip,
  DateStepper,
  PriorityChip,
  RowsSkeleton,
  StatTile,
  StatTileSkeleton,
  StatusChip,
  formatMins,
  formatPct,
} from '@/components/DailyChips';
import { dailyApi } from '@/lib/dailyLogsApi';
import { describeDate, istToday, shiftDate } from '@/lib/ist';
import { formatDate } from '@/lib/utils';
import type { DailyLog, User } from '@/types';

/** The viewed day lives in the URL so a specific day can be shared or refreshed. */
function useDay() {
  const [params, setParams] = useSearchParams();
  // Defaults to today in IST, never the browser's or the server's own day.
  const date = params.get('date') || istToday();
  const setDate = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('date', next);
    setParams(p, { replace: true });
  };
  return { date, setDate };
}

export default function DailyTeam() {
  const { date, setDate } = useDay();
  const navigate = useNavigate();

  const logsQuery = useQuery({
    queryKey: ['daily-logs', date],
    queryFn: () => dailyApi.logs({ date }),
  });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => dailyApi.users() });
  const checkinsQuery = useQuery({
    queryKey: ['daily-checkins', date],
    queryFn: () => dailyApi.checkins(date),
  });

  const logs = logsQuery.data?.logs ?? [];
  const stats = logsQuery.data?.stats ?? null;
  const users = usersQuery.data?.users ?? [];
  const checkins = checkinsQuery.data?.checkins ?? [];

  const { reported, notReported } = useMemo(() => {
    const byUser = new Map<string, DailyLog[]>();
    for (const log of logs) {
      const list = byUser.get(log.userId);
      if (list) list.push(log);
      else byUser.set(log.userId, [log]);
    }
    const summaryFor = new Map(
      checkins.filter((c) => c.submittedAt).map((c) => [c.userId, c.daySummary]),
    );

    // "Reported" means logged a task or left a day summary — the same rule the
    // server uses for the percentage in the top strip.
    const withWork: { user: User; logs: DailyLog[]; summary: string | null }[] = [];
    const without: User[] = [];
    for (const user of users) {
      const theirs = byUser.get(user.id) ?? [];
      const hasSummary = summaryFor.has(user.id);
      if (theirs.length || hasSummary) {
        withWork.push({
          user,
          logs: theirs,
          summary: summaryFor.get(user.id) ?? null,
        });
      } else {
        without.push(user);
      }
    }
    return { reported: withWork, notReported: without };
  }, [logs, users, checkins]);

  const isLoading = logsQuery.isLoading || usersQuery.isLoading;
  const error = (logsQuery.error ?? usersQuery.error) as Error | null;
  const relative = describeDate(date);

  return (
    <div>
      <PageHeader
        title="Team Day"
        subtitle={`${formatDate(date)}${relative ? ` · ${relative}` : ''} · times shown in IST`}
        actions={
          <Button size="sm" onClick={() => navigate('/daily/my')}>
            My Day
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <DateStepper
          date={date}
          onChange={setDate}
          onPrev={() => setDate(shiftDate(date, -1))}
          onNext={() => setDate(shiftDate(date, 1))}
        />
        {date !== istToday() && (
          <Button variant="ghost" size="sm" onClick={() => setDate(istToday())}>
            Back to today
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorState
            error={error}
            onRetry={() => {
              logsQuery.refetch();
              usersQuery.refetch();
            }}
          />
        </div>
      )}

      {/* Top strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {isLoading || !stats ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile
              label="Tasks logged"
              value={stats.totalTasks}
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
              label="In progress"
              value={stats.inProgress}
              tone="amber"
              icon={<Loader2 className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Blocked"
              value={stats.blocked}
              tone="rose"
              icon={<AlertCircle className="h-[18px] w-[18px]" />}
            />
            <StatTile
              label="Team reported"
              value={formatPct(stats.reportedPct)}
              tone={stats.reportedPct === 100 ? 'green' : 'violet'}
              icon={<Users className="h-[18px] w-[18px]" />}
              foot={`${stats.reported} of ${stats.teamSize}`}
            />
          </>
        )}
      </div>

      {/* Not reported — deliberately above the day's work. It is the signal
          management opens this page for, and putting it under a long list of
          cards would bury it. */}
      {!isLoading && notReported.length > 0 && (
        <Card className="mb-5 border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <UserX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Not reported yet — {notReported.length} of {users.length}
              </p>
              <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/80">
                No tasks and no day summary for {formatDate(date)}.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {notReported.map((u) => (
                  <Link
                    key={u.id}
                    to={`/daily/person/${u.id}`}
                    className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:ring-amber-400 dark:bg-slate-900 dark:text-amber-300 dark:ring-amber-900"
                  >
                    {u.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {!isLoading && users.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No team members yet"
          description="Add the team on the Settings page, then sync the roster from the Summary view."
          action={
            <Button size="sm" onClick={() => usersQuery.refetch()}>
              Reload
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <RowsSkeleton />
          </Card>
          <Card className="overflow-hidden">
            <RowsSkeleton rows={3} />
          </Card>
        </div>
      ) : reported.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title={`Nobody has logged anything for ${formatDate(date)}`}
          description="Entries appear here as the team fills in their day."
          action={
            <Button size="sm" onClick={() => navigate('/daily/my')}>
              Log my day
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {reported.map(({ user, logs: theirs, summary }) => (
            <MemberCard key={user.id} user={user} logs={theirs} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  user,
  logs,
  summary,
}: {
  user: User;
  logs: DailyLog[];
  summary: string | null;
}) {
  const done = logs.filter((l) => l.status === 'DONE').length;
  const mins = logs.reduce((sum, l) => sum + (l.timeSpentMins ?? 0), 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <Link
          to={`/daily/person/${user.id}`}
          className="font-semibold text-slate-900 hover:underline dark:text-slate-100"
        >
          {user.name}
        </Link>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="tabular-nums">
            {done}/{logs.length} done
          </span>
          {mins > 0 && <span className="tabular-nums">{formatMins(mins)}</span>}
        </div>
      </div>

      {summary && (
        <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
          {summary}
        </p>
      )}

      {logs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-400">
          Left a day summary but logged no tasks.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="max-w-[22rem] px-4 py-2.5">
                    <div className="font-medium text-slate-800 dark:text-slate-100">
                      {log.title}
                    </div>
                    {/* The output is the point of the module, so it is shown on
                        the row rather than hidden behind a click. */}
                    {log.output && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {log.output}
                      </div>
                    )}
                    {log.status === 'BLOCKED' && log.blockerNote && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-rose-600 dark:text-rose-400">
                        Blocked: {log.blockerNote}
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
      )}
    </Card>
  );
}
