import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Users2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState, Input, Select } from '@/components/ui';
import { SlideOver } from '@/components/SlideOver';
import {
  Avatar,
  EditableDate,
  EditableText,
  IconSelect,
  Lozenge,
  PriorityMark,
  UserCell,
  formatJiraDate,
} from '@/components/TrackerCells';
import { useToast } from '@/components/Toast';
import { trackerApi, type TabKey } from '@/lib/workTrackerApi';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/constants';
import { istToday } from '@/lib/ist';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus, User } from '@/types';

// DESIGN NOTE. The table is Atlassian/Jira anatomy: Jira neutrals, 32px rows,
// filled lozenges, a border-bottom and no colour bar. Those tokens are scoped
// to `.jira-table` in src/index.css so the surrounding MCCIA shell keeps its
// own language. Two deliberate departures the module spec asks for: the people
// columns show avatar plus name rather than avatar alone, and priority is icon
// plus label rather than icon alone.

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All work' },
  { key: 'assigned_to_me', label: 'Assigned to me' },
  { key: 'overdue', label: 'Overdue' },
];

/**
 * Ten columns, in the order the spec gives. Name is the only sticky one; the
 * rest scroll horizontally past it.
 *
 * Title is given a fixed width rather than flexing: a sticky neighbour needs a
 * known left offset, which a flexible column cannot provide.
 */
const COLUMNS = [
  { key: 'name', label: 'Name', width: 160, sticky: true, sort: 'name' },
  { key: 'title', label: 'Title', width: 340, sticky: false, sort: 'title' },
  { key: 'priority', label: 'Priority', width: 110, sticky: false, sort: '' },
  { key: 'status', label: 'Status', width: 120, sticky: false, sort: '' },
  { key: 'allocation', label: 'Allocation', width: 110, sticky: false, sort: 'allocation' },
  { key: 'due', label: 'Due', width: 110, sticky: false, sort: 'due' },
  { key: 'deadline', label: 'Deadline', width: 110, sticky: false, sort: 'deadline' },
  { key: 'reportTo', label: 'Reports to', width: 150, sticky: false, sort: '' },
  { key: 'approver', label: 'Approver', width: 150, sticky: false, sort: '' },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];
const COLUMN_PREF_KEY = 'mccia.tracker.columns';
// Whose work is on screen, remembered so each person lands on their own list.
const PERSON_PREF_KEY = 'mccia.tracker.person';
// Who the app is acting as. Follows the person selector, but survives a switch
// back to Everyone — an approver signs off other people's work, so they must be
// able to see the whole team and still be themselves.
const ACTOR_PREF_KEY = 'mccia.tracker.actor';

/** Closes a popover on Escape, matching SlideOver and Modal. */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode; the preference just will not persist */
  }
};

/** Everything that scopes the view lives in the URL, so a view is shareable. */
function useTrackerParams() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'all') as TabKey;
  // `has` rather than `get`: ?user= (deliberately blank) means everyone and
  // must not fall through to the remembered person.
  const user = params.has('user') ? (params.get('user') ?? '') : (readStored(PERSON_PREF_KEY) ?? '');
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const sort = params.get('sort') ?? '';
  const dir = (params.get('dir') ?? 'asc') as 'asc' | 'desc';

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

  /**
   * The person selector writes `?user=` even when empty.
   *
   * `set` drops empty values, which would delete the key — and an absent key
   * falls back to the remembered person, so choosing Everyone was immediately
   * undone. An explicit empty value is a deliberate choice and has to survive.
   */
  const setUser = useCallback(
    (id: string) => {
      const p = new URLSearchParams(params);
      p.set('user', id);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  return { tab, user, status, priority, sort, dir, set, setUser, urlHasUser: params.has('user') };
}

export default function WorkTracker() {
  const { tab, user, status, priority, sort, dir, set, setUser, urlHasUser } = useTrackerParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const usersQuery = useQuery({ queryKey: ['tracker-users'], queryFn: () => trackerApi.users() });
  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data]);

  // Remember whoever is selected, and reflect it back into the URL so the view
  // stays shareable and a refresh keeps it. Only ever writes the key when the
  // URL had none — an explicit `?user=` means Everyone and must stand.
  useEffect(() => {
    writeStored(PERSON_PREF_KEY, user);
    if (!urlHasUser && user) setUser(user);
  }, [user, urlHasUser, setUser]);

  // Who the app is acting as. It follows the selector, but a switch to Everyone
  // keeps the last person: approving is done on somebody else's work, so the
  // approver has to be able to widen the table without stopping being
  // themselves. A label, not a boundary — there is no session behind it.
  const [actorId, setActorId] = useState<string>(() => readStored(ACTOR_PREF_KEY) ?? '');
  useEffect(() => {
    if (!user) return;
    setActorId(user);
    writeStored(ACTOR_PREF_KEY, user);
  }, [user]);
  const actor = actorId && users.some((u) => u.id === actorId) ? actorId : undefined;
  const actorName = users.find((u) => u.id === actor)?.name;

  const filters = useMemo(
    () => ({ tab, user, status, priority, sort, dir }),
    [tab, user, status, priority, sort, dir],
  );

  const tasksQuery = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => trackerApi.tasks(filters),
  });
  const counts = useQuery({
    queryKey: ['tracker-summary', user],
    queryFn: () => trackerApi.summary(user || undefined),
  });
  const today = useQuery({
    queryKey: ['tracker-today', user],
    queryFn: () => trackerApi.today(user || undefined),
  });
  const atRisk = useQuery({
    queryKey: ['tracker-at-risk', user],
    queryFn: () => trackerApi.atRisk(user || undefined),
  });
  const atRiskCount = atRisk.data?.tasks.length ?? 0;

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
    qc.invalidateQueries({ queryKey: ['tracker-at-risk'] });
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
          ? { tasks: old.tasks.map((t) => (t.id === id ? ({ ...t, [field]: value } as Task) : t)) }
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

  const approve = useMutation({
    mutationFn: (id: string) => trackerApi.approve(id, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast('Approved');
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
    writeStored(COLUMN_PREF_KEY, JSON.stringify([...hidden]));
  }, [hidden]);
  const visible = useCallback((k: ColumnKey) => !hidden.has(k), [hidden]);

  const [showColumns, setShowColumns] = useState(false);
  useEscape(showColumns, () => setShowColumns(false));
  const [adding, setAdding] = useState(false);
  const [activityFor, setActivityFor] = useState<Task | null>(null);

  const anyFilter = Boolean(status || priority || tab !== 'all');

  // ---- Keyboard grid navigation -------------------------------------------
  const tableRef = useRef<HTMLTableElement>(null);
  const onGridKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return;

    const cells = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [],
    );
    const i = cells.indexOf(target);
    if (i === -1) return;
    const perRow =
      tableRef.current?.querySelectorAll('tbody tr:first-child [data-cell]').length ?? 1;

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
  const viewed = users.find((u) => u.id === user) ?? null;

  const sortBy = (key: string) => {
    if (!key) return;
    set(sort === key ? { sort: key, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' });
  };

  return (
    <div>
      <PageHeader
        title="Work Tracker"
        subtitle="What everyone is working on, and where it stands."
        actions={
          <>
            <div className="relative">
              <Button size="sm" variant="secondary" onClick={() => setShowColumns((v) => !v)}>
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
            {/* Team and reporting lines live on the one admin page, behind the
                passcode, next to the other vocabularies. */}
            <Link
              to="/settings?tab=team"
              title="Team settings"
              aria-label="Team settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <SettingsIcon className="h-[18px] w-[18px]" />
            </Link>
          </>
        }
      />

      {/* ---- One toolbar row: tabs, then the controls. ----
          The four header cards that used to sit here were too heavy for what
          they carried. Everything they did still exists: the person picker and
          "I am" are compact selects, overdue lives on its own tab badge, and
          at-risk is the chip below. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="inline-flex gap-1 rounded-full bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.filter((t) => t.key !== 'assigned_to_me' || user).map((t) => {
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

        {atRiskCount > 0 && (
          <button
            onClick={() => set({ tab: 'overdue' })}
            title={`${atRiskCount} with a deadline inside three days`}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {atRiskCount} at risk
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-400" aria-live="polite">
            {saveState === 'saving'
              ? 'Saving…'
              : savedAt
                ? `Saved ${Math.max(1, Math.round((Date.now() - savedAt) / 1000))}s ago`
                : ''}
          </span>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={() => set({ tab: '', status: '', priority: '' })}>
              Clear filters
            </Button>
          )}
          {/* One control, doing both jobs: it narrows the table to one person
              and names who new work is filed under. Left on Everyone the table
              shows the whole team, which is what it opens on. */}
          <label className="flex items-center gap-1.5">
            <span className="whitespace-nowrap text-xs text-slate-400">I am</span>
            <span className="w-36">
              <Select
                value={user}
                onChange={(e) => setUser(e.target.value)}
                aria-label="Who is adding this work"
                title="Picks whose work is shown, and who new tasks are filed under"
                className="py-1.5 text-sm"
              >
                <option value="">Everyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </span>
          </label>
          {/* On Everyone the selector no longer names you, so say it plainly
              rather than leave approvals looking arbitrary. */}
          {!user && actorName && (
            <span
              className="whitespace-nowrap text-xs text-slate-400"
              title="New work and approvals are filed under this name"
            >
              acting as {actorName}
            </span>
          )}
          <Button size="sm" onClick={() => setAdding(true)} disabled={users.length === 0}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        </div>
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

      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : users.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Users2 className="h-10 w-10" />}
              title="No team members yet"
              description="Add people in Settings, then work can be assigned to them."
            />
          </div>
        ) : tasks.length === 0 && !adding ? (
          <div className="p-4">
            <EmptyState
              icon={<AlertTriangle className="h-10 w-10" />}
              title={
                anyFilter
                  ? 'No tasks match these filters.'
                  : viewed
                    ? `No work assigned to ${viewed.name} yet.`
                    : 'No work tracked yet.'
              }
              action={
                anyFilter ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => set({ tab: '', status: '', priority: '' })}
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
            <div className="jira-table hidden max-h-[70vh] overflow-auto md:block">
              <table ref={tableRef} onKeyDown={onGridKey} className="w-full border-collapse text-left">
                {/* Headers stay put on vertical scroll, the Name column on
                    horizontal. z-30 for the corner cell so it wins both. */}
                <thead className="sticky top-0 z-20">
                  <tr>
                    {COLUMNS.filter((c) => visible(c.key)).map((c) => (
                      <th
                        key={c.key}
                        style={{
                          width: c.width,
                          minWidth: c.width,
                          left: c.sticky ? 0 : undefined,
                        }}
                        className={cn('whitespace-nowrap', c.sticky && 'sticky z-30')}
                      >
                        {c.key === 'status' ? (
                          <HeaderFilter
                            label="Status"
                            value={status}
                            options={TASK_STATUSES}
                            labels={TASK_STATUS_LABELS}
                            onChange={(v) => set({ status: v })}
                          />
                        ) : c.key === 'priority' ? (
                          <HeaderFilter
                            label="Priority"
                            value={priority}
                            options={TASK_PRIORITIES}
                            labels={TASK_PRIORITY_LABELS}
                            onChange={(v) => set({ priority: v })}
                          />
                        ) : c.sort ? (
                          <HeaderSort
                            label={c.label}
                            active={sort === c.sort}
                            dir={dir}
                            onClick={() => sortBy(c.sort)}
                          />
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                    <th style={{ width: 32, minWidth: 32 }} />
                  </tr>
                </thead>
                <tbody className="divide-y-0">
                  {adding && (
                    <NewTaskRow
                      users={users}
                      visible={visible}
                      defaultUser={user || actor || users[0]?.id}
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
                      savingCells={savingCells}
                      cellErrors={cellErrors}
                      onSave={save}
                      onActivity={() => setActivityFor(t)}
                      onApprove={() => approve.mutate(t.id)}
                      onDelete={() => {
                        if (window.confirm(`Delete "${t.title}"? This cannot be undone.`))
                          remove.mutate(t.id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* A ten-column table does not scroll usefully on a phone. */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {tasks.map((t) => (
                <MobileCard key={t.id} task={t} onSave={save} />
              ))}
            </ul>
          </>
        )}
      </Card>

      <ActivityPanel task={activityFor} onClose={() => setActivityFor(null)} />
    </div>
  );
}

// ---- Rows ------------------------------------------------------------------

function TaskRow({
  task,
  users,
  actor,
  visible,
  savingCells,
  cellErrors,
  onSave,
  onActivity,
  onApprove,
  onDelete,
}: {
  task: Task;
  users: User[];
  actor?: string;
  visible: (k: ColumnKey) => boolean;
  savingCells: Record<string, boolean>;
  cellErrors: Record<string, string>;
  onSave: (id: string, field: string, value: unknown) => void;
  onActivity: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  useEscape(menu, () => setMenu(false));
  const k = (field: string) => `${task.id}:${field}`;
  const cell = (field: string) => ({
    saving: savingCells[k(field)],
    error: cellErrors[k(field)] ?? null,
  });

  // Approval is enabled only on completed work, and only for its own approver.
  const isApprover = Boolean(actor && task.approverId && actor === task.approverId);
  const canApprove = isApprover && task.status === 'completed' && !task.approvedAt;
  const approveReason = task.approvedAt
    ? 'Already approved'
    : task.status !== 'completed'
      ? 'Only completed work can be approved'
      : !task.approverId
        ? 'No approver set for this task'
        : `Only ${task.approverName} can approve this`;

  return (
    <tr className="group" style={{ background: 'var(--n0)' }}>
      {visible('name') && (
        <td className="sticky z-10" style={{ left: 0, background: 'inherit' }}>
          <UserCell
            value={task.userId}
            users={users}
            allowEmpty={false}
            ariaLabel={`Person doing ${task.title}`}
            onSave={(v) => v && onSave(task.id, 'userId', v)}
            {...cell('userId')}
          />
        </td>
      )}

      {visible('title') && (
        <td>
          <EditableText
            value={task.title}
            onSave={(v) => onSave(task.id, 'title', v)}
            {...cell('title')}
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
            render={(v) => <PriorityMark priority={v} />}
            width={94}
            ariaLabel={`Priority of ${task.title}`}
            {...cell('priority')}
          />
        </td>
      )}

      {visible('status') && (
        <td>
          <IconSelect<TaskStatus>
            value={task.status}
            options={TASK_STATUSES}
            labels={TASK_STATUS_LABELS}
            onSave={(v) => onSave(task.id, 'status', v)}
            render={(v) => (
              <span title={task.completedAt ? `Completed ${formatJiraDate(task.completedAt)}` : undefined}>
                <Lozenge status={v} />
              </span>
            )}
            width={104}
            ariaLabel={`Status of ${task.title}`}
            {...cell('status')}
          />
        </td>
      )}

      {visible('allocation') && (
        <td>
          <EditableDate
            value={task.allocationDate}
            ariaLabel={`Allocation date of ${task.title}`}
            onSave={(v) => onSave(task.id, 'allocationDate', v)}
            {...cell('allocationDate')}
          />
        </td>
      )}

      {visible('due') && (
        <td>
          <EditableDate
            value={task.dueDate}
            // Red only when there is no deadline behind it, because then the
            // due date is the hard limit. A slipped target is amber.
            overdue={task.isOverdue && !task.deadlineDate}
            slipped={task.hasSlipped}
            ariaLabel={`Due date of ${task.title}`}
            onSave={(v) => onSave(task.id, 'dueDate', v)}
            {...cell('dueDate')}
          />
        </td>
      )}

      {visible('deadline') && (
        <td>
          <EditableDate
            value={task.deadlineDate}
            min={task.dueDate ?? undefined}
            overdue={task.pastDeadline}
            bold={task.pastDeadline}
            ariaLabel={`Deadline of ${task.title}`}
            onSave={(v) => onSave(task.id, 'deadlineDate', v)}
            {...cell('deadlineDate')}
          />
        </td>
      )}

      {visible('reportTo') && (
        <td>
          <UserCell
            value={task.reportTo}
            users={users}
            ariaLabel={`Reports to, for ${task.title}`}
            onSave={(v) => onSave(task.id, 'reportTo', v)}
            {...cell('reportTo')}
          />
        </td>
      )}

      {visible('approver') && (
        <td>
          <UserCell
            value={task.approverId}
            users={users}
            ariaLabel={`Approver of ${task.title}`}
            onSave={(v) => onSave(task.id, 'approverId', v)}
            {...cell('approverId')}
          />
        </td>
      )}

      <td className="relative text-right">
        <div className="row-menu">
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label={`Actions for ${task.title}`}
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
              className="absolute right-2 z-50 mt-1 w-52 overflow-hidden rounded-[3px] border py-1 text-left shadow-lg"
            >
              <button
                disabled={!canApprove}
                title={canApprove ? undefined : approveReason}
                onClick={() => {
                  setMenu(false);
                  onApprove();
                }}
                style={{ color: canApprove ? 'var(--g400)' : 'var(--n200)' }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[color:var(--n20)] disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="h-4 w-4" />
                {task.approvedAt ? 'Approved' : 'Approve'}
              </button>
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
  defaultUser,
  pending,
  onCancel,
  onCreate,
}: {
  users: User[];
  visible: (k: ColumnKey) => boolean;
  defaultUser?: string;
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: {
    userId: string;
    title: string;
    priority: TaskPriority;
    status: TaskStatus;
    dueDate?: string | null;
    deadlineDate?: string | null;
  }) => Promise<void>;
}) {
  const [userId, setUserId] = useState(defaultUser ?? users[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [statusValue, setStatusValue] = useState<TaskStatus>('upcoming');
  const [dueDate, setDueDate] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => firstRef.current?.focus(), []);

  const commit = async () => {
    if (!title.trim() || !userId) {
      setError('A name and a title are required');
      return;
    }
    if (dueDate && deadlineDate && deadlineDate < dueDate) {
      setError('The deadline cannot be earlier than the due date');
      return;
    }
    setError(null);
    await onCreate({
      userId,
      title: title.trim(),
      priority,
      status: statusValue,
      dueDate: dueDate || null,
      deadlineDate: deadlineDate || null,
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
      <tr onKeyDown={onKey} style={{ background: 'var(--b50)' }}>
        {visible('name') && (
          <td className="sticky z-10" style={{ left: 0, background: 'inherit' }}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Name">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('title') && (
          <td>
            <Input
              ref={firstRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is the work?"
              aria-label="Task title"
            />
          </td>
        )}
        {visible('priority') && (
          <td>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              aria-label="Priority"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('status') && (
          <td>
            <Select
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value as TaskStatus)}
              aria-label="Status"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </td>
        )}
        {visible('allocation') && (
          <td className="px-2 text-xs text-slate-400">{formatJiraDate(istToday())}</td>
        )}
        {visible('due') && (
          <td>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
          </td>
        )}
        {visible('deadline') && (
          <td>
            <Input
              type="date"
              value={deadlineDate}
              min={dueDate || undefined}
              onChange={(e) => setDeadlineDate(e.target.value)}
              aria-label="Deadline"
            />
          </td>
        )}
        {visible('reportTo') && <td className="px-2 text-xs text-slate-400">From the roster</td>}
        {visible('approver') && <td className="px-2 text-xs text-slate-400">—</td>}
        <td className="text-right">
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => void commit()} disabled={pending} aria-label="Add task">
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
          <td colSpan={span} style={{ background: 'var(--b50)', color: 'var(--r400)' }} className="px-3 pb-2 text-xs">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

/** Below 768px the table becomes cards; editing opens a bottom sheet. */
function MobileCard({
  task,
  onSave,
}: {
  task: Task;
  onSave: (id: string, field: string, value: unknown) => void;
}) {
  const [sheet, setSheet] = useState<null | 'status' | 'priority'>(null);
  return (
    <li className={cn('border-l-4 px-4 py-3', task.isOverdue ? 'border-l-rose-500' : 'border-l-transparent')}>
      <div className="flex items-start gap-2">
        <Avatar name={task.userName} size={24} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-800 dark:text-slate-100">{task.title}</p>
          <p className="text-[11px] text-slate-400">{task.userName}</p>
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
          className="jira-table flex min-h-[44px] items-center rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
        >
          <PriorityMark priority={task.priority} />
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-400">Allocated</dt>
          <dd className="tabular-nums text-slate-600 dark:text-slate-300">
            {task.allocationDate ? formatJiraDate(task.allocationDate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Due</dt>
          <dd
            className={cn(
              'tabular-nums',
              task.isOverdue && !task.deadlineDate
                ? 'text-rose-600'
                : task.hasSlipped
                  ? 'text-amber-600'
                  : 'text-slate-600 dark:text-slate-300',
            )}
          >
            {task.dueDate ? formatJiraDate(task.dueDate) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Deadline</dt>
          <dd
            className={cn(
              'tabular-nums',
              task.pastDeadline ? 'font-semibold text-rose-600' : 'text-slate-600 dark:text-slate-300',
            )}
          >
            {task.deadlineDate ? formatJiraDate(task.deadlineDate) : '—'}
          </dd>
        </div>
      </dl>

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSheet(null)} />
          <div className="relative w-full rounded-t-xl bg-white p-4 dark:bg-slate-900">
            <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              {sheet === 'status' ? 'Status' : 'Priority'}
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
                  className="jira-table flex min-h-[44px] w-full items-center rounded-lg px-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <PriorityMark priority={p} />
                </button>
              ))}
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setSheet(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---- Header controls -------------------------------------------------------

/** A column header that also filters that column. */
function HeaderFilter<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (next: string) => void;
}) {
  const active = Boolean(value);
  return (
    <span className="relative inline-flex items-center gap-1">
      <span className={cn('pointer-events-none', active && 'text-[color:var(--b400)]')}>
        {label}
      </span>
      <ChevronDown
        className={cn('pointer-events-none h-3 w-3', active ? 'text-[color:var(--b400)]' : 'opacity-50')}
      />
      {active && (
        <span
          aria-hidden
          style={{ background: 'var(--b400)' }}
          className="pointer-events-none absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full"
        />
      )}
      <select
        value={value}
        aria-label={`Filter by ${label.toLowerCase()}`}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Any {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A sortable column header. Chevron on hover, filled when active. */
function HeaderSort({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group/sort inline-flex items-center gap-1"
      aria-label={`Sort by ${label.toLowerCase()}`}
    >
      <span className={cn(active && 'text-[color:var(--b400)]')}>{label}</span>
      <ChevronDown
        className={cn(
          'h-3 w-3 transition',
          active
            ? cn('text-[color:var(--b400)]', dir === 'desc' && 'rotate-180')
            : 'opacity-0 group-hover/sort:opacity-50',
        )}
      />
    </button>
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
    <SlideOver open onClose={onClose} title="Activity" description={task.title}>
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
        <div key={i} className="flex items-center gap-4 px-4" style={{ height: 44 }}>
          <div className="h-6 w-6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
