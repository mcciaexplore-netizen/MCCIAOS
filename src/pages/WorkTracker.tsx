import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Columns3,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Users2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState, Input, Select } from '@/components/ui';
import { SlideOver } from '@/components/SlideOver';
import {
  Avatar,
  AvatarStack,
  EditableDate,
  EditableText,
  IconSelect,
  Lozenge,
  PriorityIcon,
  ReadOnlyDate,
  TypeSquare,
  UserCell,
} from '@/components/TrackerCells';
import { useToast } from '@/components/Toast';
import { trackerApi, type TabKey } from '@/lib/workTrackerApi';
import {
  COLLABORATOR_ROLES,
  COLLABORATOR_ROLE_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
} from '@/constants';
import { istToday } from '@/lib/ist';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type {
  CollaboratorRole,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
} from '@/types';

// DESIGN NOTE. The table is built to Atlassian/Jira anatomy exactly as the
// module spec asks — Jira neutrals, 32px rows, filled lozenges, icon-only
// priority, avatar-only people. Those tokens are scoped to `.jira-table` in
// src/index.css so the surrounding MCCIA shell, nav and buttons keep their own
// language: the spec asks for both, and scoping is what lets both be true.
//
// Dark mode is kept rather than dropped: spec 6.6 puts it out of scope "unless
// MCCIA OS already has it", and it does (there is a theme toggle in the header).

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All work' },
  { key: 'assigned_to_me', label: 'Assigned to me' },
  { key: 'due_soon', label: 'Due soon' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
];

// Jira's column order, with the assignee-first requirement honoured by putting
// people immediately after the summary. Type and key are 104px together, so the
// assignee is still visible without scrolling.
//
// Summary is given a fixed width rather than flexing: the first four columns
// are sticky, and a sticky column needs a known left offset, which a flexible
// neighbour cannot provide.
const COLUMNS = [
  { sticky: true, key: 'type', label: 'Type', width: 34, hideLabel: true },
  { sticky: true, key: 'ref', label: 'Key', width: 78, hideLabel: false },
  { sticky: true, key: 'title', label: 'Summary', width: 340, hideLabel: false },
  { sticky: true, key: 'assignee', label: 'Assignee', width: 40, hideLabel: false },
  { sticky: false, key: 'with', label: 'With', width: 60, hideLabel: false },
  { sticky: false, key: 'status', label: 'Status', width: 110, hideLabel: false },
  { sticky: false, key: 'priority', label: 'Priority', width: 36, hideLabel: true },
  { sticky: false, key: 'allocatedAt', label: 'Allocated', width: 90, hideLabel: false },
  { sticky: false, key: 'dueDate', label: 'Due', width: 90, hideLabel: false },
  { sticky: false, key: 'deadline', label: 'Deadline', width: 90, hideLabel: false },
  { sticky: false, key: 'completedAt', label: 'Completed', width: 90, hideLabel: false },
  { sticky: false, key: 'reportTo', label: 'Reports to', width: 40, hideLabel: false },
  { sticky: false, key: 'approverId', label: 'Approver', width: 40, hideLabel: false },
  { sticky: false, key: 'approvedAt', label: 'Approved', width: 90, hideLabel: false },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

/**
 * Left offsets for the sticky block, summed over the columns actually visible —
 * hiding Key must not leave Assignee floating at the wrong offset.
 */
function stickyOffsets(visible: (k: ColumnKey) => boolean): Partial<Record<ColumnKey, number>> {
  const out: Partial<Record<ColumnKey, number>> = {};
  let x = 0;
  for (const c of COLUMNS) {
    if (!c.sticky || !visible(c.key)) continue;
    out[c.key] = x;
    x += c.width;
  }
  return out;
}
const COLUMN_PREF_KEY = 'mccia.tracker.columns';

/** Everything that scopes the view lives in the URL, so a view is shareable. */
function useTrackerParams() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'all') as TabKey;
  const assignee = params.get('assignee') ?? '';
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';

  const set = useCallback(
    (next: Record<string, string>) => {
      const p = new URLSearchParams(params);
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  return { tab, assignee, status, priority, set };
}

export default function WorkTracker() {
  const { tab, assignee, status, priority, set } = useTrackerParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  // The person selected in "Viewing" is also who the app treats as the current
  // user, since there is no session. It gates the Assigned to me tab and the
  // approve permission. A label, never a security boundary.
  const actor = assignee || undefined;

  const usersQuery = useQuery({ queryKey: ['tracker-users'], queryFn: () => trackerApi.users() });
  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data]);

  const filters = useMemo(
    () => ({ tab, assignee, status, priority }),
    [tab, assignee, status, priority],
  );

  const tasksQuery = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => trackerApi.tasks(filters),
  });
  const counts = useQuery({
    queryKey: ['tracker-summary', assignee],
    queryFn: () => trackerApi.summary(assignee || undefined),
  });
  const today = useQuery({
    queryKey: ['tracker-today', assignee],
    queryFn: () => trackerApi.today(assignee || undefined),
  });
  const shared = useQuery({
    queryKey: ['tracker-shared', assignee],
    queryFn: () => trackerApi.shared(assignee || undefined),
  });

  const tasks = tasksQuery.data?.tasks ?? [];

  // ---- Save state ---------------------------------------------------------
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, force] = useState(0);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});

  // Re-render once a second so "Saved 2s ago" stays honest.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [savedAt]);

  const cellKey = (taskId: string, field: string) => `${taskId}:${field}`;

  const refreshAside = () => {
    qc.invalidateQueries({ queryKey: ['tracker-summary'] });
    qc.invalidateQueries({ queryKey: ['tracker-today'] });
    qc.invalidateQueries({ queryKey: ['tracker-shared'] });
  };

  /**
   * Optimistic single-field update. Paints the value immediately, rolls the
   * cell back on failure and shows the error on that cell alone — never a
   * page-level error for one cell.
   */
  const patch = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: unknown }) =>
      trackerApi.update(id, { [field]: value } as never, actor),

    onMutate: async ({ id, field, value }) => {
      const key = cellKey(id, field);
      setCellErrors((e) => {
        const { [key]: _drop, ...rest } = e;
        return rest;
      });
      setSavingCells((s) => ({ ...s, [key]: true }));
      setSaveState('saving');

      await qc.cancelQueries({ queryKey: ['tasks', filters] });
      const snapshot = qc.getQueryData(['tasks', filters]);
      qc.setQueryData<{ tasks: Task[] }>(['tasks', filters], (old) =>
        old
          ? {
              tasks: old.tasks.map((t) =>
                t.id === id ? ({ ...t, [field]: value } as Task) : t,
              ),
            }
          : old,
      );
      return { snapshot, key };
    },

    onError: (err: Error, _vars, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(['tasks', filters], ctx.snapshot);
      if (ctx?.key) setCellErrors((e) => ({ ...e, [ctx.key]: err.message }));
      setSaveState('idle');
    },

    onSuccess: () => {
      setSaveState('saved');
      setSavedAt(Date.now());
      refreshAside();
    },

    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.key) setSavingCells((s) => ({ ...s, [ctx.key]: false }));
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const save = (id: string, field: string, value: unknown) =>
    patch.mutate({ id, field, value });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof trackerApi.create>[0]) =>
      trackerApi.create(input, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      refreshAside();
      toast('Task added');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => trackerApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      refreshAside();
      toast('Task deleted');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  // ---- Column visibility ---------------------------------------------------
  const [hidden, setHidden] = useState<Set<ColumnKey>>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_PREF_KEY);
      return raw ? new Set(JSON.parse(raw) as ColumnKey[]) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify([...hidden]));
    } catch {
      /* private mode; the preference just will not persist */
    }
  }, [hidden]);
  const visible = (k: ColumnKey) => !hidden.has(k);

  const offsets = useMemo(() => stickyOffsets(visible), [hidden]);
  const [showColumns, setShowColumns] = useState(false);
  const [adding, setAdding] = useState(false);
  const [activityFor, setActivityFor] = useState<Task | null>(null);
  const [collabFor, setCollabFor] = useState<string | null>(null);

  const viewingUser = users.find((u) => u.id === assignee) ?? null;
  const anyFilter = Boolean(assignee || status || priority || tab !== 'all');

  // ---- Keyboard grid navigation -------------------------------------------
  const tableRef = useRef<HTMLTableElement>(null);
  const onGridKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const target = e.target as HTMLElement;
    // Let arrows work normally inside an open text field.
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return;

    const cells = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [],
    );
    const i = cells.indexOf(target);
    if (i === -1) return;
    const perRow = tableRef.current?.querySelectorAll('tbody tr:first-child [data-cell]').length ?? 1;

    let next = i;
    if (e.key === 'ArrowLeft') next = i - 1;
    if (e.key === 'ArrowRight') next = i + 1;
    if (e.key === 'ArrowUp') next = i - perRow;
    if (e.key === 'ArrowDown') next = i + perRow;
    if (next >= 0 && next < cells.length) {
      e.preventDefault();
      cells[next].focus();
    }
  };

  const isLoading = tasksQuery.isLoading || usersQuery.isLoading;
  const loadError = (tasksQuery.error ?? usersQuery.error) as Error | null;

  return (
    <div>
      <PageHeader
        title="Work Tracker"
        subtitle="What everyone is working on, and where it stands."
        actions={
          <>
            <div className="relative">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowColumns((v) => !v)}
              >
                <Columns3 className="h-4 w-4" /> Columns
              </Button>
              {showColumns && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColumns(false)} />
                  <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {COLUMNS.map((c) => (
                      <label
                        key={c.key}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={visible(c.key)}
                          onChange={() =>
                            setHidden((h) => {
                              const n = new Set(h);
                              if (n.has(c.key)) n.delete(c.key);
                              else n.add(c.key);
                              return n;
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          </>
        }
      />

      {/* ---- Header strip. Stacks below 900px, Viewing first. ---- */}
      <div className="mb-5 flex flex-col gap-3 min-[900px]:flex-row min-[900px]:items-stretch">
        <div className="order-2 min-[900px]:order-1 min-[900px]:w-56">
          <TodayBlock
            data={today.data}
            loading={today.isLoading}
            onPick={(t) => set({ tab: t })}
          />
        </div>
        <div className="order-3 min-[900px]:order-2 min-[900px]:flex-1">
          <SharedBlock
            tasks={shared.data?.tasks ?? []}
            loading={shared.isLoading}
            onSeeAll={() => set({ tab: 'all' })}
          />
        </div>
        <div className="order-1 min-[900px]:order-3 min-[900px]:w-64">
          <ViewingBlock
            user={viewingUser}
            users={users}
            counts={counts.data}
            loading={counts.isLoading}
            // A person is selected but the roster has not arrived yet. Without
            // this the block briefly reads "All team" while viewing one person,
            // which is the exact misread it exists to prevent.
            resolving={Boolean(assignee) && !viewingUser}
          />
        </div>
      </div>

      {/* ---- Tabs ---- */}
      <div className="mb-4 overflow-x-auto">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.filter((t) => t.key !== 'assigned_to_me' || assignee).map((t) => {
            const n = counts.data?.[t.key];
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => set({ tab: t.key === 'all' ? '' : t.key })}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs tabular-nums',
                    active
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'bg-slate-200/70 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
                  )}
                >
                  {n ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Filters + autosave indicator ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            value={assignee}
            onChange={(e) => set({ assignee: e.target.value })}
            aria-label="Filter by person"
          >
            <option value="">All team</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select
            value={priority}
            onChange={(e) => set({ priority: e.target.value })}
            aria-label="Filter by priority"
          >
            <option value="">Any priority</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ tab: '', assignee: '', status: '', priority: '' })}
          >
            Clear filters
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-400" aria-live="polite">
          {saveState === 'saving'
            ? 'Saving…'
            : savedAt
              ? `Saved ${Math.max(1, Math.round((Date.now() - savedAt) / 1000))}s ago`
              : ''}
        </span>
      </div>

      {loadError && (
        <div className="mb-4">
          <ErrorState
            title="Could not load tasks"
            error={loadError}
            onRetry={() => {
              tasksQuery.refetch();
              usersQuery.refetch();
            }}
          />
        </div>
      )}

      {/* ---- Table (desktop) / cards (mobile) ---- */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Users2 className="h-10 w-10" />}
              title="No team members yet"
              description="The roster is seeded from the team list on the Settings page."
            />
          </div>
        ) : tasks.length === 0 && !adding ? (
          <div className="p-4">
            <EmptyState
              icon={<AlertTriangle className="h-10 w-10" />}
              title={
                anyFilter
                  ? 'No tasks match these filters.'
                  : viewingUser
                    ? `No work assigned to ${viewingUser.name} yet.`
                    : 'No work tracked yet.'
              }
              action={
                anyFilter ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => set({ tab: '', assignee: '', status: '', priority: '' })}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> New task
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table. Horizontal scroll past the sticky assignee column. */}
            <div className="jira-table hidden max-h-[70vh] overflow-auto md:block">
              <table ref={tableRef} onKeyDown={onGridKey} className="w-full border-collapse text-left">
                {/* Headers stay put on vertical scroll, sticky columns on
                    horizontal. z-30 for the corner cells so they win both. */}
                <thead className="sticky top-0 z-20">
                  <tr>
                    {COLUMNS.filter((c) => visible(c.key)).map((c) => (
                      <th
                        key={c.key}
                        style={{
                          width: c.width,
                          minWidth: c.width,
                          left: c.sticky ? offsets[c.key] : undefined,
                        }}
                        className={cn(
                          'whitespace-nowrap',
                          c.sticky && 'sticky z-30',
                        )}
                      >
                        {/* The icon-only columns hide their label so the column
                            can hold the spec width; screen readers still get it. */}
                        <span className={c.hideLabel ? 'sr-only' : undefined}>
                          {c.label}
                        </span>
                      </th>
                    ))}
                    <th style={{ width: 32, minWidth: 32 }} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {adding && (
                    <NewTaskRow
                      users={users}
                      visible={visible}
                      defaultAssignee={assignee || users[0]?.id}
                      actor={actor}
                      pending={create.isPending}
                      onCancel={() => setAdding(false)}
                      onCreate={async (input) => {
                        await create.mutateAsync(input);
                        setAdding(false);
                      }}
                    />
                  )}
                  {tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      users={users}
                      actor={actor}
                      visible={visible}
                      offsets={offsets}
                      savingCells={savingCells}
                      cellErrors={cellErrors}
                      onSave={save}
                      onActivity={() => setActivityFor(t)}
                      onCollab={() => setCollabFor(t.id)}
                      onDelete={() => {
                        if (window.confirm(`Delete ${t.ref}? This cannot be undone.`))
                          remove.mutate(t.id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards. A 13-column table does not scroll usefully on a phone. */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {tasks.map((t) => (
                <MobileCard key={t.id} task={t} users={users} onSave={save} />
              ))}
            </ul>
          </>
        )}
      </Card>

      {collabFor && (
        <CollaboratorPanel
          task={tasks.find((t) => t.id === collabFor) ?? null}
          users={users}
          actor={actor}
          onClose={() => setCollabFor(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['tasks'] });
            refreshAside();
          }}
        />
      )}

      <ActivityPanel task={activityFor} onClose={() => setActivityFor(null)} />
    </div>
  );
}

// ---- Header strip blocks ---------------------------------------------------

function TodayBlock({
  data,
  loading,
  onPick,
}: {
  data?: { date: string; dueToday: number; overdue: number; completedToday: number };
  loading: boolean;
  onPick: (tab: TabKey) => void;
}) {
  return (
    <Card className="h-full p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Today</p>
      {loading || !data ? (
        <div className="mt-2 space-y-2">
          <div className="h-6 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-36 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : (
        <>
          <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
            {formatDate(data.date)}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button
              onClick={() => onPick('due_soon')}
              className="tabular-nums text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {data.dueToday}
              </span>{' '}
              due
            </button>
            <button
              onClick={() => onPick('overdue')}
              className={cn(
                'tabular-nums hover:underline',
                data.overdue > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400',
              )}
            >
              <span className="font-semibold">{data.overdue}</span> overdue
            </button>
            <button
              onClick={() => onPick('completed')}
              className="tabular-nums text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {data.completedToday}
              </span>{' '}
              completed
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function SharedBlock({
  tasks,
  loading,
  onSeeAll,
}: {
  tasks: { id: string; ref: string; title: string; people: { id: string; name: string }[] }[];
  loading: boolean;
  onSeeAll: () => void;
}) {
  const shown = tasks.slice(0, 4);
  const extra = tasks.length - shown.length;
  return (
    <Card className="h-full p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Working together
        </p>
        <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
          {loading ? '' : tasks.length}
        </span>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        // Reads as a statement rather than disappearing, so the strip does not
        // change height when the team happens to be working solo.
        <p className="mt-3 text-sm text-slate-400">No shared work right now</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                {t.title}
              </span>
              <AvatarStack people={t.people.map((p) => ({ name: p.name }))} />
              <span className="w-4 text-right text-xs tabular-nums text-slate-400">
                {t.people.length}
              </span>
            </li>
          ))}
        </ul>
      )}
      {extra > 0 && (
        <button
          onClick={onSeeAll}
          className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          +{extra} more
        </button>
      )}
    </Card>
  );
}

function ViewingBlock({
  user,
  users,
  counts,
  loading,
  resolving,
}: {
  user: User | null;
  users: User[];
  counts?: { all: number; overdue: number };
  loading: boolean;
  resolving: boolean;
}) {
  return (
    <Card className="h-full p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Viewing</p>
      <div className="mt-2 flex items-center gap-3">
        {resolving ? (
          <>
            <span className="h-11 w-11 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
            <span className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          </>
        ) : user ? (
          <>
            <Avatar name={user.name} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {user.name}
              </p>
              {/* Designations are blank until someone fills them in; inventing a
                  colleague's job title would be fabricating data about a real
                  person. */}
              <p className="truncate text-xs text-slate-400">
                {user.designation ?? 'No designation set'}
              </p>
            </div>
          </>
        ) : (
          <>
            <AvatarStack people={users.map((u) => ({ name: u.name }))} max={4} />
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              All team, {users.length} {users.length === 1 ? 'person' : 'people'}
            </p>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {loading || !counts ? (
          <span className="inline-block h-3 w-24 animate-pulse rounded bg-slate-100 align-middle dark:bg-slate-800" />
        ) : (
          <>
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {counts.all}
            </span>{' '}
            open
            {counts.overdue > 0 && (
              <>
                {', '}
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  {counts.overdue}
                </span>{' '}
                overdue
              </>
            )}
          </>
        )}
      </p>
    </Card>
  );
}

// ---- Rows ------------------------------------------------------------------

function TaskRow({
  task,
  users,
  actor,
  visible,
  offsets,
  savingCells,
  cellErrors,
  onSave,
  onActivity,
  onCollab,
  onDelete,
}: {
  task: Task;
  users: User[];
  actor?: string;
  visible: (k: ColumnKey) => boolean;
  offsets: Partial<Record<ColumnKey, number>>;
  savingCells: Record<string, boolean>;
  cellErrors: Record<string, string>;
  onSave: (id: string, field: string, value: unknown) => void;
  onActivity: () => void;
  onCollab: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const k = (field: string) => `${task.id}:${field}`;
  const cell = (field: string) => ({
    saving: savingCells[k(field)],
    error: cellErrors[k(field)] ?? null,
  });

  // Only the named approver may approve. The option renders but is disabled,
  // with a tooltip naming who can — the server enforces the same rule.
  const canApprove = Boolean(actor && task.approverId && actor === task.approverId);
  const approverName = task.approverName ?? 'nobody yet';

  // Sticky cells need their own background or the scrolling columns show
  // through; hover has to repaint them too.
  const stickyCell = (key: ColumnKey) =>
    ({
      left: offsets[key],
      background: 'inherit',
    }) as const;

  return (
    // Rows are uniform. The spec is explicit that collaborator rows are not
    // tinted — the stacked avatars in the With column are the signal.
    <tr className="group" style={{ background: 'var(--n0)' }}>
      {visible('type') && (
        <td className="sticky z-10" style={stickyCell('type')}>
          <IconSelect<TaskType>
            value={task.type}
            options={TASK_TYPES}
            labels={TASK_TYPE_LABELS}
            onSave={(v) => onSave(task.id, 'type', v)}
            render={(v) => <TypeSquare type={v} />}
            width={18}
            ariaLabel={`Type of ${task.ref}`}
            {...cell('type')}
          />
        </td>
      )}

      {visible('ref') && (
        <td className="sticky z-10" style={stickyCell('ref')}>
          <button
            onClick={onActivity}
            style={{ color: 'var(--b400)' }}
            className="whitespace-nowrap px-1 text-sm tabular-nums hover:underline"
          >
            {task.ref}
          </button>
        </td>
      )}

      {visible('title') && (
        <td className="sticky z-10" style={stickyCell('title')}>
          <EditableText
            value={task.title}
            onSave={(v) => onSave(task.id, 'title', v)}
            {...cell('title')}
          />
        </td>
      )}

      {visible('assignee') && (
        <td className="sticky z-10" style={stickyCell('assignee')}>
          <UserCell
            value={task.assigneeId}
            users={users}
            allowEmpty={false}
            ariaLabel={`Assignee of ${task.ref}`}
            onSave={(v) => v && onSave(task.id, 'assigneeId', v)}
            {...cell('assigneeId')}
          />
        </td>
      )}

      {visible('with') && (
        <td>
          <button
            onClick={onCollab}
            data-cell
            title="Add or remove people"
            aria-label={
              task.collaborators.length === 0
                ? `Add people to ${task.ref}`
                : `${task.collaborators.length} people on ${task.ref}`
            }
            className="rounded-[3px] px-0.5 py-0.5"
          >
            {task.collaborators.length === 0 ? (
              <span style={{ color: 'var(--n200)' }} className="text-xs">
                Add
              </span>
            ) : (
              <AvatarStack
                people={task.collaborators.map((c) => ({
                  name: c.userName,
                  // A dot marks someone carrying their own due date; the date
                  // itself lives in the With popover, not a date column.
                  dot: Boolean(c.memberDueDate),
                }))}
              />
            )}
          </button>
        </td>
      )}

      {visible('status') && (
        <td>
          <IconSelect<TaskStatus>
            value={task.status}
            options={TASK_STATUSES}
            labels={TASK_STATUS_LABELS}
            onSave={(v) => onSave(task.id, 'status', v)}
            render={(v) => <Lozenge status={v} />}
            width={102}
            ariaLabel={`Status of ${task.ref}`}
            optionDisabled={(v) => v === 'approved' && !canApprove}
            optionTitle={(v) =>
              v === 'approved' && !canApprove
                ? `Only ${approverName} can approve this task`
                : undefined
            }
            {...cell('status')}
          />
        </td>
      )}

      {visible('priority') && (
        <td>
          <IconSelect<TaskPriority>
            value={task.priority}
            options={TASK_PRIORITIES}
            labels={TASK_PRIORITY_LABELS}
            onSave={(v) => onSave(task.id, 'priority', v)}
            render={(v) => <PriorityIcon priority={v} />}
            width={20}
            ariaLabel={`Priority of ${task.ref}`}
            {...cell('priority')}
          />
        </td>
      )}

      {visible('allocatedAt') && (
        <td>
          <EditableDate
            value={task.allocatedAt.slice(0, 10)}
            ariaLabel={`Allocated date of ${task.ref}`}
            onSave={(v) => v && onSave(task.id, 'allocatedAt', v)}
            {...cell('allocatedAt')}
          />
        </td>
      )}

      {visible('dueDate') && (
        <td>
          <EditableDate
            value={task.dueDate}
            overdue={task.isOverdue}
            ariaLabel={`Due date of ${task.ref}`}
            onSave={(v) => onSave(task.id, 'dueDate', v)}
            {...cell('dueDate')}
          />
        </td>
      )}

      {visible('deadline') && (
        <td>
          <EditableDate
            value={task.deadline}
            min={task.dueDate ?? undefined}
            ariaLabel={`Deadline of ${task.ref}`}
            onSave={(v) => onSave(task.id, 'deadline', v)}
            {...cell('deadline')}
          />
        </td>
      )}

      {visible('completedAt') && (
        <td>
          <ReadOnlyDate value={task.completedAt} />
        </td>
      )}

      {visible('reportTo') && (
        <td>
          <UserCell
            value={task.reportTo}
            users={users}
            ariaLabel={`Reports to, for ${task.ref}`}
            onSave={(v) => onSave(task.id, 'reportTo', v)}
            {...cell('reportTo')}
          />
        </td>
      )}

      {visible('approverId') && (
        <td>
          <UserCell
            value={task.approverId}
            users={users}
            ariaLabel={`Approver of ${task.ref}`}
            onSave={(v) => onSave(task.id, 'approverId', v)}
            {...cell('approverId')}
          />
        </td>
      )}

      {visible('approvedAt') && (
        <td>
          <ReadOnlyDate value={task.approvedAt} />
        </td>
      )}

      <td className="relative text-right">
        <div className="row-menu">
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label={`Actions for ${task.ref}`}
            style={{ color: 'var(--n200)' }}
            className="rounded-[3px] p-1"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <div
              style={{ background: 'var(--n0)', borderColor: 'var(--n40)' }}
              className="absolute right-2 z-50 mt-1 w-40 overflow-hidden rounded-[3px] border py-1 text-left shadow-lg"
            >
              <button
                onClick={() => {
                  setMenu(false);
                  onActivity();
                }}
                style={{ color: 'var(--n500)' }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[color:var(--n20)]"
              >
                View activity
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
                style={{ color: 'var(--r400)' }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[color:var(--n20)]"
              >
                Delete
              </button>
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

/** Inline blank row at the top of the table. Enter commits, Escape discards. */
function NewTaskRow({
  users,
  visible,
  defaultAssignee,
  actor,
  pending,
  onCancel,
  onCreate,
}: {
  users: User[];
  visible: (k: ColumnKey) => boolean;
  defaultAssignee?: string;
  actor?: string;
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    assigneeId: string;
    type: TaskType;
    status: TaskStatus;
    priority: TaskPriority;
    allocatedBy?: string | null;
    dueDate?: string | null;
    deadline?: string | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(defaultAssignee ?? users[0]?.id ?? '');
  const [type, setType] = useState<TaskType>('task');
  const [status, setStatus] = useState<TaskStatus>('not_started');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => firstRef.current?.focus(), []);

  const commit = async () => {
    if (!title.trim() || !assigneeId) {
      setError('A title and an assignee are required');
      return;
    }
    if (dueDate && deadline && deadline < dueDate) {
      setError('Deadline cannot be earlier than the due date');
      return;
    }
    setError(null);
    await onCreate({
      title: title.trim(),
      assigneeId,
      type,
      status,
      priority,
      // The person in Viewing allocated it, since there is no session.
      allocatedBy: actor ?? null,
      dueDate: dueDate || null,
      deadline: deadline || null,
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    }
  };

  const span = COLUMNS.filter((c) => visible(c.key)).length + 1;

  return (
    <>
      <tr className="border-l-4 border-l-brand-500 bg-brand-50/40 dark:bg-brand-950/20" onKeyDown={onKey}>
        {visible('assignee') && (
          <td className="sticky left-0 z-10 bg-brand-50/40 px-2 py-1.5 dark:bg-brand-950/20">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Assignee">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('with') && <td className="px-3 py-1.5 text-xs text-slate-400">—</td>}
        {visible('title') && (
          <td className="px-2 py-1.5">
            <Input
              ref={firstRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is the work?"
              aria-label="Task title"
            />
          </td>
        )}
        {visible('status') && (
          <td className="px-2 py-1.5">
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} aria-label="Status">
              {TASK_STATUSES.filter((s) => s !== 'approved').map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('priority') && (
          <td className="px-2 py-1.5">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} aria-label="Priority">
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('allocatedAt') && (
          <td className="px-2 py-1.5 text-xs text-slate-400">{formatDate(istToday())}</td>
        )}
        {visible('dueDate') && (
          <td className="px-2 py-1.5">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
          </td>
        )}
        {visible('deadline') && (
          <td className="px-2 py-1.5">
            <Input
              type="date"
              value={deadline}
              min={dueDate || undefined}
              onChange={(e) => setDeadline(e.target.value)}
              aria-label="Deadline"
            />
          </td>
        )}
        {visible('completedAt') && <td className="px-2 py-1.5 text-xs text-slate-400">—</td>}
        {visible('reportTo') && <td className="px-2 py-1.5 text-xs text-slate-400">—</td>}
        {visible('approverId') && <td className="px-2 py-1.5 text-xs text-slate-400">—</td>}
        {visible('approvedAt') && <td className="px-2 py-1.5 text-xs text-slate-400">—</td>}
        <td className="px-2 py-1.5 text-right">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              onClick={() => void commit()}
              disabled={pending}
              aria-label="Add task"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
            <button
              onClick={onCancel}
              aria-label="Discard new task"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={span} className="bg-brand-50/40 px-3 pb-2 text-xs text-rose-600 dark:bg-brand-950/20 dark:text-rose-400">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

/** Below 768px a 13-column table is unusable, so each row becomes a card. */
function MobileCard({
  task,
  users,
  onSave,
}: {
  task: Task;
  users: User[];
  onSave: (id: string, field: string, value: unknown) => void;
}) {
  const [sheet, setSheet] = useState<null | 'status' | 'priority' | 'dueDate'>(null);
  return (
    // Cards, not dense rows, so the "no left colour bar" rule for the Jira
    // table does not apply here. Overdue still needs to be visible at a glance.
    <li
      className={cn(
        'border-l-4 px-4 py-3',
        task.isOverdue ? 'border-l-rose-500' : 'border-l-transparent',
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar name={task.assigneeName} size={24} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-800 dark:text-slate-100">{task.title}</p>
          <p className="text-[11px] tabular-nums text-slate-400">
            {task.ref} · {task.assigneeName}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* 44px targets: the dense 32px rows are desktop only. */}
        <button
          onClick={() => setSheet('status')}
          className="jira-table flex min-h-[44px] items-center rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
        >
          <Lozenge status={task.status} />
        </button>
        <button
          onClick={() => setSheet('priority')}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          <span className="jira-table inline-flex">
            <PriorityIcon priority={task.priority} />
          </span>
          {TASK_PRIORITY_LABELS[task.priority]}
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-400">Due</dt>
          <dd className={cn('tabular-nums', task.isOverdue ? 'text-rose-600' : 'text-slate-600 dark:text-slate-300')}>
            {task.dueDate ? formatDate(task.dueDate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Deadline</dt>
          <dd className="tabular-nums text-slate-600 dark:text-slate-300">
            {task.deadline ? formatDate(task.deadline) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">With</dt>
          <dd>
            {task.collaborators.length ? (
              <AvatarStack
                people={task.collaborators.map((c) => ({
                  name: c.userName,
                  dot: Boolean(c.memberDueDate),
                }))}
              />
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSheet(null)} />
          <div className="relative w-full rounded-t-xl bg-white p-4 dark:bg-slate-900">
            <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              {sheet === 'status' ? 'Status' : sheet === 'priority' ? 'Priority' : 'Due date'}
            </p>
            {sheet === 'status' &&
              TASK_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    onSave(task.id, 'status', s);
                    setSheet(null);
                  }}
                  className="jira-table flex min-h-[44px] w-full items-center rounded-lg px-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Lozenge status={s} />
                </button>
              ))}
            {sheet === 'priority' &&
              TASK_PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onSave(task.id, 'priority', p);
                    setSheet(null);
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {TASK_PRIORITY_LABELS[p]}
                </button>
              ))}
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setSheet(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
      {users.length === 0 && null}
    </li>
  );
}

// ---- Panels ----------------------------------------------------------------

function CollaboratorPanel({
  task,
  users,
  actor,
  onClose,
  onChanged,
}: {
  task: Task | null;
  users: User[];
  actor?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  if (!task) return null;

  const available = users.filter(
    (u) => u.id !== task.assigneeId && !task.collaborators.some((c) => c.userId === u.id),
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      title="People on this task"
      description={`${task.ref} · ${task.title}`}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Owner</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
            <Avatar name={task.assigneeName} size={24} />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {task.assigneeName}
            </span>
            <span className="ml-auto text-xs text-slate-400">Lead</span>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Also working on it
          </p>
          {task.collaborators.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400 dark:border-slate-700">
              Nobody else yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {task.collaborators.map((c) => (
                <li
                  key={c.userId}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={c.userName} size={24} />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {c.userName}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(() => trackerApi.removeCollaborator(task.id, c.userId, actor))
                      }
                      aria-label={`Remove ${c.userName}`}
                      className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-400">Role</span>
                      <Select
                        value={c.role}
                        disabled={busy}
                        onChange={(e) =>
                          run(() =>
                            trackerApi.updateCollaborator(
                              task.id,
                              c.userId,
                              { role: e.target.value as CollaboratorRole },
                              actor,
                            ),
                          )
                        }
                      >
                        {COLLABORATOR_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {COLLABORATOR_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-400">Their due date</span>
                      <Input
                        type="date"
                        defaultValue={c.memberDueDate ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          run(() =>
                            trackerApi.updateCollaborator(
                              task.id,
                              c.userId,
                              { memberDueDate: e.target.value || null },
                              actor,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {available.length > 0 && (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-slate-400">Add someone</span>
              <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose a person</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              size="sm"
              disabled={!adding || busy}
              onClick={() =>
                run(async () => {
                  await trackerApi.addCollaborator(
                    task.id,
                    { userId: adding, role: 'contributor', memberDueDate: null },
                    actor,
                  );
                  setAdding('');
                })
              }
            >
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        )}
      </div>
    </SlideOver>
  );
}

function ActivityPanel({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['task-activity', task?.id],
    queryFn: () => trackerApi.task(task!.id),
    enabled: Boolean(task),
  });
  if (!task) return null;

  const rows = query.data?.activity ?? [];

  return (
    <SlideOver open onClose={onClose} title="Activity" description={`${task.ref} · ${task.title}`}>
      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Could not load the activity trail"
          error={query.error as Error}
          onRetry={() => query.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-medium">{a.actorName ?? 'Someone'}</span> changed{' '}
                <span className="font-medium">{a.field}</span>
                {a.oldValue && (
                  <>
                    {' from '}
                    <span className="text-slate-500">{a.oldValue}</span>
                  </>
                )}
                {a.newValue && (
                  <>
                    {' to '}
                    <span className="text-slate-500">{a.newValue}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-slate-400">
                {new Date(a.changedAt).toLocaleString('en-IN')}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SlideOver>
  );
}

/** Skeleton rows at the real row height, so the table does not jump on load. */
function TableSkeleton() {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-7 w-7 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
