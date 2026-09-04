import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  Users2,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button, Card, EmptyState, ErrorState, Input, Modal, Select } from '@/components/ui';
import { SlideOver } from '@/components/SlideOver';
import {
  Avatar,
  EditableDate,
  EditableNumber,
  EditableText,
  IconSelect,
  Lozenge,
  PriorityMark,
  UserCell,
  formatJiraDate,
  DueDays,
} from '@/components/TrackerCells';
import { ConsultationsTable } from '@/components/ConsultationsTable';
import { TeamOnTask } from '@/components/TeamOnTask';
import { useToast } from '@/components/Toast';
import { trackerApi, type TabKey } from '@/lib/workTrackerApi';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isCommitmentField,
} from '@/constants';
import { useEditLock } from '@/hooks/useEditLock';
import { formatIstDateTime, istToday } from '@/lib/ist';
import { readTrackerActor, writeTrackerActor } from '@/lib/trackerIdentity';
import { cn } from '@/lib/utils';
import type { Task, TaskPriority, TaskStatus, User, WorkStaleness } from '@/types';

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
 * Widths are measured from the real content — the longest name with its avatar,
 * a date like "01 Sept", the widest lozenge — plus room for the header label,
 * so nothing is cut off. Title carries no fixed width: it takes whatever space
 * is left over, and holds a floor so it stays readable on a narrow screen.
 */
const COLUMNS = [
  { key: 'name', label: 'Name', width: 132, sticky: true, flex: false, sort: 'name' },
  { key: 'title', label: 'Title', width: 360, sticky: false, flex: true, sort: 'title' },
  { key: 'priority', label: 'Priority', width: 94, sticky: false, flex: false, sort: '' },
  { key: 'status', label: 'Status', width: 111, sticky: false, flex: false, sort: '' },
  { key: 'allocation', label: 'Allocation', width: 80, sticky: false, flex: false, sort: 'allocation' },
  { key: 'deadline', label: 'Deadline', width: 130, sticky: false, flex: false, sort: 'deadline' },
  { key: 'due', label: 'Due', width: 70, sticky: false, flex: false, sort: '' },
  { key: 'percentage', label: 'Percentage', width: 92, sticky: false, flex: false, sort: '' },
  { key: 'reportTo', label: 'Reports to', width: 132, sticky: false, flex: false, sort: '' },
  { key: 'approver', label: 'Approver', width: 132, sticky: false, flex: false, sort: '' },
] as const;

/** The trailing column: a row's ⋯ menu, or the new-task row's two buttons. */
const MENU_WIDTH = 60;

type ColumnKey = (typeof COLUMNS)[number]['key'];
const COLUMN_PREF_KEY = 'mccia.tracker.columns';
// Whose work is on screen, remembered so each person lands on their own list.
const PERSON_PREF_KEY = 'mccia.tracker.person';
function freshnessLabel(person: WorkStaleness): string {
  if (person.openCount === 0) return 'No open work';
  if (person.daysSinceUpdate === null) return 'No identified update';
  if (person.daysSinceUpdate === 0) return 'Updated today';
  if (person.daysSinceUpdate === 1) return 'Updated yesterday';
  return `${person.daysSinceUpdate} days since update`;
}

/** The daily stand-up view: workload and identified update freshness together. */
function TeamFreshness({
  people,
  staleAfterDays,
  selected,
  loading,
  error,
  onSelect,
}: {
  people: WorkStaleness[];
  staleAfterDays: number;
  selected: string;
  loading: boolean;
  error?: string;
  onSelect: (userId: string) => void;
}) {
  return (
    <Card className="mb-3 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            Team freshness
          </p>
          <p className="text-xs text-slate-400">
            Open work and last self-identified update. Red after more than {staleAfterDays}{' '}
            day{staleAfterDays === 1 ? '' : 's'}.
          </p>
        </div>
        <span className="text-[11px] text-slate-400">Identity comes from the person selector</span>
      </div>

      {loading ? (
        <p className="py-2 text-xs text-slate-400">Checking team updates…</p>
      ) : error ? (
        <p className="py-2 text-xs text-rose-600 dark:text-rose-400">
          Could not load team freshness: {error}
        </p>
      ) : people.length === 0 ? (
        <p className="py-2 text-xs text-slate-400">No active people to show.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {people.map((person) => {
            const today = person.openCount > 0 && person.daysSinceUpdate === 0;
            const waiting =
              person.openCount > 0 && person.daysSinceUpdate !== null && !today && !person.isStale;
            return (
              <button
                key={person.userId}
                type="button"
                onClick={() => onSelect(person.userId)}
                title={
                  person.lastUpdateAt
                    ? `${person.userName}'s last identified update: ${formatIstDateTime(person.lastUpdateAt)}`
                    : `${person.userName} has no identified update on their current open work`
                }
                className={cn(
                  'min-w-40 rounded-lg border px-3 py-2 text-left transition-colors',
                  person.isStale
                    ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30'
                    : today
                      ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30'
                      : waiting
                        ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60',
                  selected === person.userId && 'ring-2 ring-brand-500/40',
                )}
              >
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {person.userName}
                </span>
                <span className="mt-0.5 block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {person.openCount} open · {freshnessLabel(person)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

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
  /**
   * Which table is on screen. In the URL like everything else here, so a link
   * to the consultations view is shareable and survives a refresh.
   */
  const view: 'work' | 'consultations' =
    params.get('view') === 'consultations' ? 'consultations' : 'work';

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

  return { tab, user, status, priority, sort, dir, view, set, setUser, urlHasUser: params.has('user') };
}

export default function WorkTracker() {
  const { tab, user, status, priority, sort, dir, view, set, setUser, urlHasUser } =
    useTrackerParams();
  const qc = useQueryClient();
  const { toast } = useToast();

  const usersQuery = useQuery({ queryKey: ['tracker-users'], queryFn: () => trackerApi.users() });
  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data]);

  /**
   * Reports to and Approver are not the whole roster — reporting goes to a few
   * people and approval to fewer. Both come from flags on the roster, editable
   * in Settings, rather than names in this file.
   *
   * `keeping` is the person a task already points at. Somebody who has since
   * lost the flag still has to render, or their name silently disappears from
   * every task that named them; they are offered on that task and nowhere else.
   */
  const reportOptions = useCallback(
    (keeping: string | null) =>
      users.filter((u) => u.canBeReportedTo || u.id === keeping),
    [users],
  );
  const approverOptions = useCallback(
    (keeping: string | null) => users.filter((u) => u.canApprove || u.id === keeping),
    [users],
  );

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
  const [actorId, setActorId] = useState<string>(() => readTrackerActor() ?? '');
  useEffect(() => {
    if (!user) return;
    setActorId(user);
    writeTrackerActor(user);
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
  const staleness = useQuery({
    queryKey: ['tracker-staleness'],
    queryFn: () => trackerApi.staleness(1),
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
    qc.invalidateQueries({ queryKey: ['tracker-staleness'] });
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

  const restore = useMutation({
    mutationFn: (id: string) => trackerApi.restore(id, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      refreshAside();
      toast('Task restored');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => trackerApi.remove(id, actor),
    // Removing hides the row rather than destroying it, so the offer to undo is
    // a real one. It is made here, next to the confirmation, because that is
    // the moment somebody realises they picked the wrong row.
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      refreshAside();
      toast('Task deleted', 'success', {
        label: 'Undo',
        onAct: () => restore.mutate(id),
      });
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

  /**
   * The three people columns are sized from the roster actually loaded, not a
   * fixed guess: a 132px column fits "Snahanku" and cuts "Vedshri Kulkarni".
   * 46px covers the avatar, its gap and the cell padding; the rest is the
   * longest name at roughly 7.8px a character, clamped so one very long name
   * cannot swallow the table. The floor is 112: enough for the roster's longest
   * name, and no wider, because the date columns need every pixel it does not
   * take — a clipped date field puts its calendar button over the text.
   */
  const peopleWidth = useMemo(() => {
    const longest = users.reduce((n, u) => Math.max(n, u.name.length), 0);
    // 46 for one avatar and the cell padding, +22 for the team button at the
    // end, +32 for the two extra avatars a stack of three adds (each overlaps
    // by 8). Without the last two the name was eaten: "Aarushi" showed as
    // "Aaru…" once a second person joined.
    return Math.min(280, Math.max(166, 46 + 22 + 32 + Math.ceil(longest * 7.8)));
  }, [users]);

  const widthOf = useCallback(
    (c: (typeof COLUMNS)[number]) =>
      c.key === 'name' || c.key === 'reportTo' || c.key === 'approver'
        ? peopleWidth
        : c.width,
    [peopleWidth],
  );

  /**
   * Under table-layout: fixed a cell's own min-width no longer holds a floor —
   * at 1280px Title was crushed to "Wh.". The floor has to be the table's, so
   * that a narrow window scrolls the container instead of squeezing the one
   * column that carries the actual sentence.
   */
  const tableMin = useMemo(
    () =>
      COLUMNS.filter((c) => visible(c.key)).reduce(
        (n, c) => n + (c.flex ? c.width : widthOf(c)),
        MENU_WIDTH,
      ),
    [visible, widthOf],
  );

  const [showColumns, setShowColumns] = useState(false);
  useEscape(showColumns, () => setShowColumns(false));
  const [adding, setAdding] = useState(false);
  const [addingConsultation, setAddingConsultation] = useState(false);
  /** Whether the open new-task row is naming several people rather than one. */
  const [groupMode, setGroupMode] = useState(false);
  const { unlocked } = useEditLock();
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
          {view === 'consultations' ? (
            <ViewSwitch onBack={() => set({ view: '' })} />
          ) : (
            <></>
          )}
          {view === 'work' &&
            TABS.filter((t) => t.key !== 'assigned_to_me' || user).map((t) => {
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

        {view === 'work' && atRiskCount > 0 && (
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
          {view === 'work' && anyFilter && (
            <Button variant="ghost" size="sm" onClick={() => set({ tab: '', status: '', priority: '' })}>
              Clear filters
            </Button>
          )}
          {/* Beside the person picker, because it answers the question that
              picker cannot: the table lists a task once, under its owner, so a
              collaborator's involvement is invisible until you open that row. */}

          {/* One control, doing both jobs: it narrows the table to one person
              and names who new work is filed under. Left on Everyone the table
              shows the whole team, which is what it opens on. */}
          {/* No label. The two bits of chrome that used to explain this — an
              "I am" prefix and an "acting as …" hint — read as clutter next to
              a dropdown that plainly holds names. What they conveyed now lives
              where it is actually needed: the hover title here, and the Approve
              item's tooltip, which names who you are when it refuses. */}
          <div className="w-40">
            <Select
              value={user}
              onChange={(e) => setUser(e.target.value)}
              aria-label="Who is adding this work"
              title={
                actorName
                  ? `Showing ${user ? actorName + "'s work" : 'everyone'}. New tasks and approvals are filed under ${actorName}.`
                  : 'Pick a person to see their work and file new tasks under them'
              }
              className="py-1.5 text-sm"
            >
              <option value="">Everyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          {/* Only on the work table. Offering "New task" while the consultations
              table is up would be a button that silently swaps which table you
              are looking at — the Work pill is the way back, and it says so. */}
          {view === 'work' && (
            <Button
              size="sm"
              onClick={() => {
                setAddingConsultation(false);
                setGroupMode(false);
                setAdding(true);
              }}
              disabled={users.length === 0}
            >
              <Plus className="h-4 w-4" /> New task
            </Button>
          )}
          {/* Group work: one title, the same fields as any task, but several
              people on it. The first person named owns it — a task has to
              belong to somebody for the table to list it — and the rest are
              recorded as working on it with them. */}
          {view === 'work' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={users.length < 2}
              title={
                users.length < 2
                  ? 'Group work needs at least two people on the roster'
                  : 'One title, several people'
              }
              onClick={() => {
                set({ view: '' });
                setAddingConsultation(false);
                setGroupMode(true);
                setAdding(true);
              }}
            >
              <Users2 className="h-4 w-4" /> Group
            </Button>
          )}
          {/* Beside New task, because the two are the same kind of act: putting
              a new record in. Which table it lands in is the difference. */}
          <Button
            variant="secondary"
            onClick={() => {
              set({ view: 'consultations' });
              setAdding(false);
              setAddingConsultation(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Consultation
          </Button>
        </div>
      </div>

      {view === 'work' && (
        <TeamFreshness
          people={staleness.data?.people ?? []}
          staleAfterDays={staleness.data?.staleAfterDays ?? 1}
          selected={user}
          loading={staleness.isLoading}
          error={staleness.isError ? (staleness.error as Error).message : undefined}
          onSelect={setUser}
        />
      )}

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
        {view === 'consultations' ? (
          <ConsultationsTable
            users={users}
            user={user}
            adding={addingConsultation}
            onDoneAdding={() => setAddingConsultation(false)}
          />
        ) : isLoading ? (
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
              {/* table-layout: fixed so a column's width is a property of its
                  header and nothing else. Under auto layout the widest cell
                  wins, which meant opening the new-task row — whose controls
                  are inevitably bulkier than the text they replace — dragged
                  every column out of line with its own heading. */}
              <table
                ref={tableRef}
                onKeyDown={onGridKey}
                style={{ tableLayout: 'fixed', minWidth: tableMin }}
                className="w-full border-collapse text-left"
              >
                {/* Headers stay put on vertical scroll, the Name column on
                    horizontal. z-30 for the corner cell so it wins both. */}
                <thead className="sticky top-0 z-20">
                  <tr>
                    {COLUMNS.filter((c) => visible(c.key)).map((c) => (
                      <th
                        key={c.key}
                        style={
                          c.flex
                            ? { width: 'auto', minWidth: c.width }
                            : {
                                width: widthOf(c),
                                minWidth: widthOf(c),
                                maxWidth: widthOf(c),
                                left: c.sticky ? 0 : undefined,
                              }
                        }
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
                    {/* Holds a row's ⋯ menu, and the new-task row's two
                        buttons — sized for the wider of the two so opening the
                        row does not reflow the table. */}
                    <th style={{ width: MENU_WIDTH, minWidth: MENU_WIDTH }} />
                  </tr>
                </thead>
                <tbody className="divide-y-0">
                  {adding && (
                    <NewTaskRow
                      users={users}
                      visible={visible}
                      group={groupMode}
                      lockedUser={groupMode ? undefined : user || undefined}
                      defaultUser={user || actor || users[0]?.id}
                      pending={create.isPending}
                      onCancel={() => {
                        setAdding(false);
                        setGroupMode(false);
                      }}
                      onCreate={async ({ userIds, ...input }) => {
                        // The first name owns it; a task has to belong to
                        // somebody for the table to list it once. The rest are
                        // recorded as working on it alongside them.
                        const [owner, ...rest] = userIds;
                        const made = await create.mutateAsync({ ...input, userId: owner });
                        if (rest.length) await trackerApi.setMembers(made.task.id, rest, actor);
                        qc.invalidateQueries({ queryKey: ['tasks'] });
                        qc.invalidateQueries({ queryKey: ['tracker-staleness'] });
                        setAdding(false);
                        setGroupMode(false);
                      }}
                    />
                  )}
                  {tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      users={users}
                      actor={actor}
                      actorName={actorName}
                      visible={visible}
                      reportOptions={reportOptions}
                      approverOptions={approverOptions}
                      unlocked={unlocked}
                      savingCells={savingCells}
                      cellErrors={cellErrors}
                      onSave={save}
                      onActivity={() => setActivityFor(t)}
                      onMembersChanged={() => {
                        qc.invalidateQueries({ queryKey: ['tasks'] });
                        qc.invalidateQueries({ queryKey: ['tracker-staleness'] });
                      }}
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
                <MobileCard
                  key={t.id}
                  task={t}
                  personColour={users.find((u) => u.id === t.userId)?.colour}
                  onSave={save}
                />
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
  actorName,
  visible,
  reportOptions,
  approverOptions,
  unlocked,
  savingCells,
  cellErrors,
  onSave,
  onActivity,
  onApprove,
  onDelete,
  onMembersChanged,
}: {
  task: Task;
  users: User[];
  actor?: string;
  actorName?: string;
  visible: (k: ColumnKey) => boolean;
  /** Who this task may report to / be approved by — see the page-level comment. */
  reportOptions: (keeping: string | null) => User[];
  approverOptions: (keeping: string | null) => User[];
  /** Whether recorded work may be edited. Switched in Settings; see lib/editLock. */
  unlocked: boolean;
  savingCells: Record<string, boolean>;
  cellErrors: Record<string, string>;
  onSave: (id: string, field: string, value: unknown) => void;
  onActivity: () => void;
  onApprove: () => void;
  onDelete: () => void;
  /** Refreshes the table after the people on a task change. */
  onMembersChanged: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  useEscape(menu, () => setMenu(false));
  const k = (field: string) => `${task.id}:${field}`;

  /**
   * A filled commitment field is read-only until the tab is unlocked. An empty
   * commitment stays editable because filling a gap does not revise an agreed
   * value. Operational updates stay editable because they are expected to move.
   * This is an accident guard in the UI, not an API permission boundary.
   */
  const frozen = (field: string) => {
    if (unlocked) return false;
    // Only the commitment fields. Status, percentage, priority and the due date
    // stay editable always — they are the daily update, and freezing them was
    // why nothing had been touched since the day it was entered.
    if (!isCommitmentField(field)) return false;
    const v = (task as unknown as Record<string, unknown>)[field];
    return v !== null && v !== undefined && v !== '';
  };

  const cell = (field: string) => ({
    saving: savingCells[k(field)],
    error: cellErrors[k(field)] ?? null,
    disabled: frozen(field),
  });

  /** Says why a cell will not open, on the element people actually hover. */
  const td = (field: string) =>
    frozen(field)
      ? {
          title:
            'Agreed when the work was set up. Settings \u2192 Work Tracker unlocks it.',
        }
      : {};

  // Approval is enabled only on completed work, and only for its own approver.
  const isApprover = Boolean(actor && task.approverId && actor === task.approverId);
  const canApprove = isApprover && task.status === 'completed' && !task.approvedAt;
  // Names both sides when it refuses, so a disabled item is never a mystery.
  const approveReason = task.approvedAt
    ? 'Already approved'
    : task.status !== 'completed'
      ? 'Only completed work can be approved'
      : !task.approverId
        ? 'No approver set for this task'
        : `Only ${task.approverName} can approve this${actorName ? `, and you are ${actorName}` : ''}`;

  return (
    <tr className="group" style={{ background: 'var(--n0)' }}>
      {visible('name') && (
        <td
          className="sticky"
          // Lifted while the picker is open. Sticky cells all sit at z-10, so a
          // popup in one is painted over by the cells after it.
          style={{ left: 0, background: 'inherit', zIndex: teamOpen ? 60 : 10 }}
          {...td('userId')}
        >
          <TeamOnTask
            task={task}
            users={users}
            actor={actor}
            disabled={frozen('userId')}
            onChanged={onMembersChanged}
            onOpenChange={setTeamOpen}
          />
        </td>
      )}

      {visible('title') && (
        <td {...td('title')}>
          <EditableText
            value={task.title}
            onSave={(v) => onSave(task.id, 'title', v)}
            {...cell('title')}
          />
        </td>
      )}

      {visible('priority') && (
        <td {...td('priority')}>
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
        <td {...td('status')}>
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
        <td {...td('allocationDate')}>
          <EditableDate
            value={task.allocationDate}
            ariaLabel={`Allocation date of ${task.title}`}
            onSave={(v) => onSave(task.id, 'allocationDate', v)}
            {...cell('allocationDate')}
          />
        </td>
      )}

      {visible('deadline') && (
        <td {...td('deadlineDate')}>
          <EditableDate
            value={task.deadlineDate}
            overdue={task.pastDeadline}
            bold={task.pastDeadline}
            ariaLabel={`Deadline of ${task.title}`}
            onSave={(v) => onSave(task.id, 'deadlineDate', v)}
            {...cell('deadlineDate')}
          />
        </td>
      )}

      {visible('due') && (
        <td>
          <DueDays days={task.dueDays} />
        </td>
      )}

      {visible('percentage') && (
        <td {...td('percentage')}>
          <EditableNumber
            value={task.percentage}
            max={100}
            suffix="%"
            ariaLabel={`Percentage of ${task.title}`}
            onSave={(v) => onSave(task.id, 'percentage', v)}
            {...cell('percentage')}
          />
        </td>
      )}




      {visible('reportTo') && (
        <td {...td('reportTo')}>
          <UserCell
            value={task.reportTo}
            users={reportOptions(task.reportTo)}
            ariaLabel={`Reports to, for ${task.title}`}
            onSave={(v) => onSave(task.id, 'reportTo', v)}
            {...cell('reportTo')}
          />
        </td>
      )}

      {visible('approver') && (
        <td {...td('approverId')}>
          <UserCell
            value={task.approverId}
            users={approverOptions(task.approverId)}
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
              {/* Deleting is the largest edit there is, so it needs the
                  passcode whatever state the individual fields are in. */}
              <button
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
                disabled={!unlocked}
                title={unlocked ? undefined : 'Settings \u2192 Work Tracker unlocks deleting'}
                style={{ color: unlocked ? 'var(--r400)' : 'var(--n200)' }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[color:var(--n20)] disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
/**
 * The new-task row's controls.
 *
 * The form Input/Select are built for a settings panel: 12px side padding, a
 * 32px arrow well, 8px of vertical padding. Dropped into a 32px table row they
 * are wider than the column they sit in, and because the table is auto-layout
 * that pushes every column out of line with its own header the moment the row
 * opens. These carry the same borders and focus ring at the row's density, so
 * adding a task leaves the table exactly where it was.
 */
const ROW_CONTROL =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm leading-5 ' +
  'text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800 ' +
  'dark:text-slate-100';

const RowInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(ROW_CONTROL, type === 'date' && 'row-date', className)}
      {...props}
    />
  ),
);
RowInput.displayName = 'RowInput';

/**
 * Chrome reserves room for a native select arrow *beyond* padding-right, which
 * is invisible to any width calculation and was eating "Medium" down to "Medi".
 * Drawing the chevron here makes that space something the column can account
 * for: 16px, and not a pixel more.
 */
function RowSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(ROW_CONTROL, 'row-select', className)} {...props} />;
}

/**
 * Shown in place of the work tabs while the consultations table is up: says
 * which table you are looking at, and gets you back.
 */
function ViewSwitch({ onBack }: { onBack: () => void }) {
  return (
    <>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:hover:text-slate-300"
      >
        Work
      </button>
      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700">
        Consultations
      </span>
    </>
  );
}

function NewTaskRow({
  users,
  visible,
  group,
  lockedUser,
  defaultUser,
  pending,
  onCancel,
  onCreate,
}: {
  users: User[];
  visible: (k: ColumnKey) => boolean;
  /**
   * Several people on one title rather than one. Everything else about the row
   * is identical — same fields, same validation, same table.
   */
  group?: boolean;
  /**
   * Set when the table is filtered to one person. Their work is the only work
   * this row could be adding, so Name stops being a question and becomes a
   * statement — a picker there could only ever file the task out of the view
   * that was just asked for.
   */
  lockedUser?: string;
  defaultUser?: string;
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: {
    /** Everyone on it. The first owns it; the rest work on it with them. */
    userIds: string[];
    title: string;
    priority: TaskPriority;
    status: TaskStatus;
    deadlineDate?: string | null;
    reportTo?: string | null;
    approverId?: string | null;
    percentage?: number | null;
  }) => Promise<void>;
}) {
  const [pickedUser, setPickedUser] = useState(defaultUser ?? users[0]?.id ?? '');
  const userId = lockedUser ?? pickedUser;
  /** Group mode only: everyone on the work, in the order they were ticked. */
  const [groupIds, setGroupIds] = useState<string[]>(
    defaultUser ? [defaultUser] : users[0] ? [users[0].id] : [],
  );
  const [namesOpen, setNamesOpen] = useState(false);
  const lockedPerson = lockedUser ? users.find((u) => u.id === lockedUser) : undefined;
  const lockedName = lockedPerson?.name;
  const lockedColour = lockedPerson?.colour;
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [statusValue, setStatusValue] = useState<TaskStatus>('upcoming');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [approverId, setApproverId] = useState('');
  const [percentage, setPercentage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => firstRef.current?.focus(), []);

  const commit = async () => {
    const people = group ? groupIds : [userId];
    if (!title.trim() || people.length === 0) {
      setError('A name and a title are required');
      return;
    }
    if (group && people.length < 2) {
      setError('Group work needs at least two people — use New task for one');
      return;
    }
    if (percentage !== '' && Number(percentage) > 100) {
      setError('Percentage cannot be above 100');
      return;
    }
    setError(null);
    await onCreate({
      userIds: people,
      title: title.trim(),
      priority,
      status: statusValue,
      deadlineDate: deadlineDate || null,
      reportTo: reportTo || null,
      approverId: approverId || null,
      // Blank stays blank: nobody having put a figure on it is not the same
      // as saying zero.
      percentage: percentage === '' ? null : Number(percentage),
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Escape closes the name list first. Discarding a half-filled row because
      // somebody dismissed a dropdown is the wrong thing to do with that key.
      if (namesOpen) {
        setNamesOpen(false);
        return;
      }
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
          <td
            className="sticky"
            style={{ left: 0, background: 'inherit', zIndex: namesOpen ? 60 : 10 }}
          >
            {group ? (
              /* Several names, one title. A list of ticks rather than a
                 multi-select: the roster is short, and a native multiple-select
                 needs ctrl-click to add a second person, which nobody guesses. */
              <span className="relative flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNamesOpen((v) => !v)}
                  aria-expanded={namesOpen}
                  aria-label="Who is on this work"
                  className={cn(ROW_CONTROL, 'flex items-center gap-1.5 text-left')}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {groupIds.length === 0
                      ? 'Pick people'
                      : groupIds
                          .map((id) => users.find((u) => u.id === id)?.name)
                          .filter(Boolean)
                          .join(', ')}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </button>
                {namesOpen && (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setNamesOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {users.map((u) => {
                        const on = groupIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              setGroupIds((ids) =>
                                ids.includes(u.id)
                                  ? ids.filter((x) => x !== u.id)
                                  : [...ids, u.id],
                              )
                            }
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Avatar name={u.name} colour={u.colour} size={20} />
                            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                              {u.name}
                              {/* The first ticked owns it, so say so rather than
                                  leaving the order to look arbitrary. */}
                              {groupIds[0] === u.id && (
                                <span className="ml-1 text-[11px] text-slate-400">owner</span>
                              )}
                            </span>
                            {on && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </span>
            ) : lockedUser ? (
              <span className="flex min-w-0 items-center gap-1.5 px-2">
                <Avatar name={lockedName ?? ''} colour={lockedColour} size={24} />
                <span
                  title={lockedName}
                  style={{ color: 'var(--n800)' }}
                  className="min-w-0 flex-1 truncate text-sm"
                >
                  {lockedName}
                </span>
              </span>
            ) : (
              <RowSelect
                value={pickedUser}
                onChange={(e) => setPickedUser(e.target.value)}
                aria-label="Name"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </RowSelect>
            )}
          </td>
        )}
        {visible('title') && (
          <td>
            <RowInput
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
            <RowSelect
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              aria-label="Priority"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </RowSelect>
          </td>
        )}
        {visible('status') && (
          <td>
            <RowSelect
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value as TaskStatus)}
              aria-label="Status"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </RowSelect>
          </td>
        )}
        {visible('allocation') && (
          <td className="px-2 text-xs text-slate-400">{formatJiraDate(istToday())}</td>
        )}
        {visible('deadline') && (
          <td>
            <RowInput
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              aria-label="Deadline"
            />
          </td>
        )}
        {visible('percentage') && (
          <td>
            <RowInput
              value={percentage}
              inputMode="numeric"
              placeholder="0-100"
              aria-label="Percentage"
              onChange={(e) => setPercentage(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </td>
        )}
        {visible('reportTo') && (
          <td>
            <RowSelect value={reportTo} onChange={(e) => setReportTo(e.target.value)} aria-label="Reports to">
              <option value="">Nobody</option>
              {users.filter((u) => u.canBeReportedTo).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </RowSelect>
          </td>
        )}
        {visible('approver') && (
          <td>
            <RowSelect value={approverId} onChange={(e) => setApproverId(e.target.value)} aria-label="Approver">
              <option value="">Nobody</option>
              {users.filter((u) => u.canApprove).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </RowSelect>
          </td>
        )}
        <td className="px-1">
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={() => void commit()}
              disabled={pending}
              aria-label="Add task"
              title="Add task (Enter)"
              className="rounded p-1 text-white disabled:opacity-60"
              style={{ background: 'var(--b400)' }}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={onCancel}
              aria-label="Discard new task"
              title="Discard (Esc)"
              className="rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
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
  personColour,
  onSave,
}: {
  task: Task;
  personColour?: string | null;
  onSave: (id: string, field: string, value: unknown) => void;
}) {
  const [sheet, setSheet] = useState<null | 'status' | 'priority'>(null);
  return (
    <li className={cn('border-l-4 px-4 py-3', task.isOverdue ? 'border-l-rose-500' : 'border-l-transparent')}>
      <div className="flex items-start gap-2">
        <Avatar name={task.userName} colour={personColour} size={24} />
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
          {task.dueDays > 0 && (
            <div>
              <dt className="text-slate-400">Due</dt>
              <dd className="tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                {task.dueDays} day{task.dueDays === 1 ? '' : 's'}
              </dd>
            </div>
          )}
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
                {formatIstDateTime(a.changedAt)}
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
