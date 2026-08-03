import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardList,
  CornerDownRight,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  CategoryChip,
  DateStepper,
  RowsSkeleton,
  StatusChip,
  formatMins,
} from '@/components/DailyChips';
import { useToast } from '@/components/Toast';
import { dailyApi } from '@/lib/dailyLogsApi';
import {
  LOG_CATEGORIES,
  LOG_PRIORITIES,
  LOG_STATUSES,
  UNFINISHED_STATUSES,
} from '@/schemas/dailyLogs';
import {
  LOG_CATEGORY_LABELS,
  LOG_PRIORITY_LABELS,
  LOG_STATUS_LABELS,
} from '@/constants';
import { describeDate, istToday, shiftDate } from '@/lib/ist';
import { formatDate } from '@/lib/utils';
import type { DailyLog, LogCategory, LogPriority, LogStatus } from '@/types';

// Remembers only the last member picked, as a default for the next entry — the
// same convenience as the theme toggle, and explicitly not an identity: the app
// has no login, and the member is editable on every row.
const LAST_MEMBER_KEY = 'mccia.daily.lastMember';

export default function DailyMy() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const date = params.get('date') || istToday();
  const setDate = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('date', next);
    setParams(p, { replace: true });
  };

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => dailyApi.users() });
  const users = usersQuery.data?.users ?? [];

  const [memberId, setMemberId] = useState('');

  // Settle on a member once the roster arrives: whoever was used last, else the
  // first on the roster.
  useEffect(() => {
    if (memberId || users.length === 0) return;
    const remembered = localStorage.getItem(LAST_MEMBER_KEY);
    const valid = remembered && users.some((u) => u.id === remembered);
    setMemberId(valid ? (remembered as string) : users[0].id);
  }, [users, memberId]);

  useEffect(() => {
    if (memberId) localStorage.setItem(LAST_MEMBER_KEY, memberId);
  }, [memberId]);

  const logsKey = ['daily-logs', date, memberId];
  const logsQuery = useQuery({
    queryKey: logsKey,
    queryFn: () => dailyApi.logs({ date, user_id: memberId }),
    enabled: Boolean(memberId),
  });
  const logs = logsQuery.data?.logs ?? [];

  const checkinQuery = useQuery({
    queryKey: ['daily-checkins', date, memberId],
    queryFn: () => dailyApi.checkins(date, memberId),
    enabled: Boolean(memberId),
  });
  const checkin = checkinQuery.data?.checkins?.[0] ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['daily-logs'] });
    qc.invalidateQueries({ queryKey: ['daily-checkins'] });
  };

  const create = useMutation({
    mutationFn: dailyApi.create,
    onSuccess: invalidate,
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof dailyApi.update>[1] }) =>
      dailyApi.update(id, patch),
    onSuccess: invalidate,
    onError: (err: Error) => {
      toast(err.message, 'error');
      invalidate();
    },
  });

  const complete = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof dailyApi.complete>[1] }) =>
      dailyApi.complete(id, input),
    onSuccess: () => {
      invalidate();
      toast('Marked done');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: dailyApi.remove,
    onSuccess: () => {
      invalidate();
      toast('Entry deleted');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const carry = useMutation({
    mutationFn: () =>
      dailyApi.carryForward({
        fromDate: date,
        toDate: shiftDate(date, 1),
        userId: memberId,
      }),
    onSuccess: (res) => {
      invalidate();
      toast(
        res.created === 0
          ? 'Nothing unfinished to carry'
          : `Carried ${res.created} task${res.created === 1 ? '' : 's'} to ${formatDate(shiftDate(date, 1))}`,
        res.created === 0 ? 'info' : 'success',
      );
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const unfinished = useMemo(
    () =>
      logs.filter((l) =>
        (UNFINISHED_STATUSES as readonly string[]).includes(l.status),
      ).length,
    [logs],
  );

  const relative = describeDate(date);
  const memberName = users.find((u) => u.id === memberId)?.name ?? '';

  return (
    <div>
      <PageHeader
        title="My Day"
        subtitle={`${formatDate(date)}${relative ? ` · ${relative}` : ''} · times in IST`}
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

      {usersQuery.isError && (
        <div className="mb-4">
          <ErrorState
            error={usersQuery.error as Error}
            onRetry={() => usersQuery.refetch()}
          />
        </div>
      )}

      {!usersQuery.isLoading && users.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-10 w-10" />}
          title="No team members yet"
          description="Add the team on the Settings page, then sync the roster from the Summary view."
        />
      ) : (
        <>
          <AddRow
            users={users}
            memberId={memberId}
            onMemberChange={setMemberId}
            pending={create.isPending}
            onAdd={(input) =>
              create.mutateAsync({ ...input, logDate: date }).then(() => undefined)
            }
          />

          <Card className="mb-4 overflow-hidden">
            {logsQuery.isLoading ? (
              <RowsSkeleton />
            ) : logsQuery.isError ? (
              <div className="p-4">
                <ErrorState
                  error={logsQuery.error as Error}
                  onRetry={() => logsQuery.refetch()}
                />
              </div>
            ) : logs.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<ClipboardList className="h-10 w-10" />}
                  title={`Nothing logged for ${formatDate(date)}`}
                  description={
                    memberName
                      ? `Add ${memberName}'s first task using the row above.`
                      : 'Add the first task using the row above.'
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    saving={update.isPending || complete.isPending}
                    onPatch={(patch) => update.mutate({ id: log.id, patch })}
                    onComplete={(input) => complete.mutateAsync({ id: log.id, input })}
                    onDelete={() => remove.mutate(log.id)}
                  />
                ))}
              </ul>
            )}
          </Card>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {unfinished === 0
                ? 'Nothing unfinished on this day.'
                : `${unfinished} unfinished task${unfinished === 1 ? '' : 's'}.`}
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={unfinished === 0 || carry.isPending || !memberId}
              onClick={() => carry.mutate()}
              title={`Move unfinished work to ${formatDate(shiftDate(date, 1))}`}
            >
              {carry.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CornerDownRight className="h-4 w-4" />
              )}
              Carry unfinished to {describeDate(shiftDate(date, 1)) || 'the next day'}
            </Button>
          </div>

          <DaySummary
            key={`${memberId}-${date}`}
            initial={checkin?.daySummary ?? ''}
            savedAt={checkin?.submittedAt ?? null}
            disabled={!memberId}
            onSave={async (daySummary) => {
              await dailyApi.saveCheckin({ userId: memberId, logDate: date, daySummary });
              invalidate();
              toast('Day summary saved');
            }}
          />
        </>
      )}
    </div>
  );
}

/** One-line fast entry. Stays mounted and clears itself, so tasks go in back to back. */
function AddRow({
  users,
  memberId,
  onMemberChange,
  pending,
  onAdd,
}: {
  users: { id: string; name: string }[];
  memberId: string;
  onMemberChange: (id: string) => void;
  pending: boolean;
  onAdd: (input: {
    userId: string;
    title: string;
    category: LogCategory;
    priority: LogPriority;
    status: LogStatus;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LogCategory>('CONSULTATION');
  const [priority, setPriority] = useState<LogPriority>('MEDIUM');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !memberId) return;
    await onAdd({ userId: memberId, title: title.trim(), category, priority, status: 'PLANNED' });
    // Only the title resets: the next task is usually the same kind of work,
    // and re-picking the category every time is what makes fast entry slow.
    setTitle('');
  }

  return (
    <Card className="mb-3 p-3">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-40">
          <Select
            value={memberId}
            onChange={(e) => onMemberChange(e.target.value)}
            aria-label="Team member"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you working on?"
            aria-label="Task title"
          />
        </div>
        <div className="w-full sm:w-40">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value as LogCategory)}
            aria-label="Category"
          >
            {LOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LOG_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-32">
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as LogPriority)}
            aria-label="Priority"
          >
            {LOG_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {LOG_PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="sm" disabled={!title.trim() || pending || !memberId}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </form>
    </Card>
  );
}

/** A task row. Everything is edited in place; nothing opens a modal. */
function LogRow({
  log,
  saving,
  onPatch,
  onComplete,
  onDelete,
}: {
  log: DailyLog;
  saving: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onComplete: (input: {
    output: string;
    outputLink?: string;
    timeSpentMins?: number;
  }) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(log.title);
  const [completing, setCompleting] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => setTitle(log.title), [log.title]);

  const carried = log.status === 'CARRIED_FORWARD';

  function changeStatus(next: LogStatus) {
    // BLOCKED needs a reason and DONE needs an output, so both open their inline
    // form instead of sending a request that the API would reject.
    if (next === 'BLOCKED' && !log.blockerNote) {
      setBlocking(true);
      return;
    }
    if (next === 'DONE' && !log.output) {
      setCompleting(true);
      return;
    }
    onPatch({ status: next });
  }

  return (
    <li className={carried ? 'opacity-60' : undefined}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const trimmed = title.trim();
            if (!trimmed) return setTitle(log.title);
            if (trimmed !== log.title) onPatch({ title: trimmed });
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={`Title of ${log.title}`}
          className="min-w-[10rem] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-800"
        />

        <div className="w-36">
          <Select
            value={log.category}
            onChange={(e) => onPatch({ category: e.target.value })}
            aria-label={`Category of ${log.title}`}
            className="py-1.5 text-xs"
          >
            {LOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LOG_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-36">
          <Select
            value={log.status}
            onChange={(e) => changeStatus(e.target.value as LogStatus)}
            aria-label={`Status of ${log.title}`}
            className="py-1.5 text-xs"
          >
            {LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LOG_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-20">
          <Input
            type="number"
            min={0}
            defaultValue={log.timeSpentMins ?? ''}
            placeholder="mins"
            aria-label={`Minutes spent on ${log.title}`}
            className="py-1.5 text-xs"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === '' ? null : Number(raw);
              if (next !== (log.timeSpentMins ?? null)) onPatch({ timeSpentMins: next });
            }}
          />
        </div>

        {log.status !== 'DONE' && !carried && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCompleting((v) => !v)}
            disabled={saving}
          >
            <CheckCircle2 className="h-4 w-4" /> Mark done
          </Button>
        )}

        <button
          onClick={onDelete}
          aria-label={`Delete ${log.title}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Recorded output, shown under the row so the evidence sits with the task. */}
      {log.output && !completing && (
        <p className="px-5 pb-2 text-xs text-slate-500">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">Output:</span>{' '}
          {log.output}
          {log.outputLink && (
            <>
              {' · '}
              <a
                href={log.outputLink}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand-600 hover:underline dark:text-brand-400"
              >
                link
              </a>
            </>
          )}
        </p>
      )}

      {log.blockerNote && !blocking && (
        <p className="px-5 pb-2 text-xs text-rose-600 dark:text-rose-400">
          Blocked: {log.blockerNote}
        </p>
      )}

      {completing && (
        <CompleteForm
          initialOutput={log.output ?? ''}
          initialLink={log.outputLink ?? ''}
          initialMins={log.timeSpentMins}
          onCancel={() => setCompleting(false)}
          onSubmit={async (input) => {
            await onComplete(input);
            setCompleting(false);
          }}
        />
      )}

      {blocking && (
        <BlockerForm
          initial={log.blockerNote ?? ''}
          onCancel={() => setBlocking(false)}
          onSubmit={(blockerNote) => {
            onPatch({ status: 'BLOCKED', blockerNote });
            setBlocking(false);
          }}
        />
      )}
    </li>
  );
}

/**
 * The inline "what came of it" form.
 *
 * Output is required, and the button stays disabled until there is one — the
 * API and a CHECK constraint both refuse a DONE row without an output, so
 * letting it be submitted would only produce an error.
 */
function CompleteForm({
  initialOutput,
  initialLink,
  initialMins,
  onCancel,
  onSubmit,
}: {
  initialOutput: string;
  initialLink: string;
  initialMins: number | null;
  onCancel: () => void;
  onSubmit: (input: {
    output: string;
    outputLink?: string;
    timeSpentMins?: number;
  }) => Promise<void>;
}) {
  const [output, setOutput] = useState(initialOutput);
  const [link, setLink] = useState(initialLink);
  const [mins, setMins] = useState(initialMins == null ? '' : String(initialMins));
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!output.trim()) return;
        setBusy(true);
        try {
          await onSubmit({
            output: output.trim(),
            outputLink: link.trim() || undefined,
            timeSpentMins: mins.trim() === '' ? undefined : Number(mins),
          });
        } finally {
          setBusy(false);
        }
      }}
      className="mx-3 mb-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20"
    >
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          What was produced? <span className="text-rose-500">*</span>
        </span>
        <Textarea
          autoFocus
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          placeholder="The deck was delivered, the query was answered with..., the script now runs nightly"
          className="min-h-[60px] bg-white dark:bg-slate-900"
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Link (optional)
          </span>
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://..."
            className="bg-white dark:bg-slate-900"
          />
        </div>
        <div className="w-28">
          <span className="mb-1 block text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Minutes
          </span>
          <Input
            type="number"
            min={0}
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            className="bg-white dark:bg-slate-900"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!output.trim() || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save as done
          </Button>
        </div>
      </div>
    </form>
  );
}

/** BLOCKED is refused without a reason, so the reason is asked for up front. */
function BlockerForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSubmit(note.trim());
      }}
      className="mx-3 mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900 dark:bg-rose-950/20"
    >
      <div className="min-w-[14rem] flex-1">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-rose-800 dark:text-rose-300">
          What is blocking this? <span className="text-rose-500">*</span>
        </span>
        <Input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Waiting on the client's data export"
          className="bg-white dark:bg-slate-900"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!note.trim()}>
          Mark blocked
        </Button>
      </div>
    </form>
  );
}

/** Free-text note for the day, written to daily_checkins. */
function DaySummary({
  initial,
  savedAt,
  disabled,
  onSave,
}: {
  initial: string;
  savedAt: string | null;
  disabled: boolean;
  onSave: (summary: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Day summary <span className="font-normal text-slate-400">(optional)</span>
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        Anything worth saying about the day as a whole. Saving this also marks you as
        having reported, even on a day with no tasks.
      </p>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Spent most of the day on the Kirloskar follow-up..."
        className="mt-2"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {savedAt ? `Last saved ${new Date(savedAt).toLocaleString('en-IN')}` : 'Not saved yet'}
        </span>
        <Button
          size="sm"
          disabled={busy || disabled}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(value);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save summary
        </Button>
      </div>
    </Card>
  );
}
