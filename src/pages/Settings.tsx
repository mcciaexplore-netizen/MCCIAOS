import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Check,
  Loader2,
  Lock,
  Users,
  Megaphone,
  Link2,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
} from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useSaveSettings, useSettings } from '@/settings/SettingsContext';
import { BADGE_TONES, DEFAULT_SETTINGS } from '@/constants';
import { api } from '@/lib/api';
import { trackerApi } from '@/lib/workTrackerApi';
import type { UserInput, UserUpdateInput } from '@/schemas/workTracker';
import { cn } from '@/lib/utils';
import type { AppSettings, SheetName, TonedOption, User } from '@/types';

// Pull just the persisted keys out of the context value, dropping the derived
// lookups so they never leak into storage.
function toAppSettings(s: AppSettings): AppSettings {
  return {
    resourceCategories: [...s.resourceCategories],
    creativePlatforms: [...s.creativePlatforms],
    creativeStatuses: s.creativeStatuses.map((o) => ({ ...o })),
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Every editor, grouped by the page it configures.
//
// These used to render all at once in a two-column grid — ten cards and around
// sixty inputs on one screen, with no signal about which list drove which page.
// Grouping them by destination means you open the section for the page you are
// changing and see only its lists.
interface Editor {
  key: keyof AppSettings;
  title: string;
  description: string;
  kind: 'plain' | 'toned';
  placeholder?: string;
}

/** Bulk wipe offered in a group's danger zone. Sheets are deleted together so
 *  dependent records never orphan. No group declares one at the moment — the
 *  three that did belonged to removed modules — but the mechanism is kept for
 *  whatever replaces them. */
interface DangerAction {
  title: string;
  description: string;
  sheets: { sheet: SheetName; label: string }[];
}

interface Group {
  id: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  editors: Editor[];
  danger?: DangerAction;
  /** Rendered by a dedicated component rather than the generic list editors. */
  custom?: 'team';
}

const GROUPS: Group[] = [
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    blurb: 'Who work can be assigned to.',
    editors: [],
    custom: 'team',
  },
  {
    id: 'social',
    label: 'Social',
    icon: Megaphone,
    blurb: 'Vocabularies used on the Social page.',
    editors: [
      { key: 'creativeStatuses', title: 'Post statuses', description: 'Status values available on a creative.', kind: 'toned' },
      { key: 'creativePlatforms', title: 'Platforms', description: 'Channels you can file a creative under.', kind: 'plain', placeholder: 'Platform' },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: Link2,
    blurb: 'Vocabularies used on the Resources page.',
    editors: [
      { key: 'resourceCategories', title: 'Categories', description: 'Buckets on the Resources page.', kind: 'plain', placeholder: 'Category' },
    ],
  },
];

// Unlocked for the life of the tab, not remembered on the device: a shared
// machine should not stay open on Settings after someone walks away.
const UNLOCK_KEY = 'mccia.settings.unlocked';

/**
 * Passcode gate for the Settings page.
 *
 * IMPORTANT: this hides the page, it does not protect the data. Every route in
 * this app is unauthenticated, so the same settings can be read and written
 * directly through /api/records without ever seeing this screen. It is checked
 * server-side only so the passcode is not sitting in the JavaScript bundle.
 */
function PasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await trackerApi.unlockSettings(passcode);
      try {
        sessionStorage.setItem(UNLOCK_KEY, 'true');
      } catch {
        /* private mode; the unlock just will not survive a reload */
      }
      onUnlock();
    } catch (err) {
      setError((err as Error).message || 'That passcode is not right');
      setPasscode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Admin only." />
      <Card className="mx-auto max-w-sm p-6">
        <div className="mb-4 flex flex-col items-center text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
            <Lock className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Enter the admin passcode
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Settings changes the team roster and the vocabularies the whole app uses.
          </p>
        </div>
        <form onSubmit={submit}>
          <Input
            type="password"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            aria-label="Admin passcode"
          />
          {error && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
          )}
          <Button type="submit" className="mt-3 w-full" disabled={busy || !passcode.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Unlock
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function Settings() {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return sessionStorage.getItem(UNLOCK_KEY) === 'true';
    } catch {
      return false;
    }
  });
  if (!unlocked) return <PasscodeGate onUnlock={() => setUnlocked(true)} />;
  return <SettingsInner />;
}

function SettingsInner() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const tab = GROUPS.find((g) => g.id === params.get('tab')) ?? GROUPS[0];
  const selectTab = (id: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', id);
    setParams(p, { replace: true });
  };

  const [draft, setDraft] = useState<AppSettings>(() => toAppSettings(settings));
  const [dirty, setDirty] = useState(false);

  // Re-sync once the stored settings arrive, unless there are unsaved edits.
  useEffect(() => {
    if (!settings.isLoading && !dirty) setDraft(toAppSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.isLoading, settings]);

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  /** Groups holding a blank entry, so the save error can point at the tab. */
  function groupsWithBlanks(): Group[] {
    return GROUPS.filter((g) =>
      g.editors.some((e) => {
        const v = draft[e.key] as (string | TonedOption)[];
        return v.length === 0 || v.some((x) => (typeof x === 'string' ? !x.trim() : !x.label.trim()));
      }),
    );
  }

  async function handleSave() {
    const bad = groupsWithBlanks();
    if (bad.length > 0) {
      // Naming the section matters now that only one is on screen — otherwise
      // the offending blank could be behind a tab you cannot see.
      toast(`Remove blank entries in ${bad.map((g) => g.label).join(', ')}`, 'error');
      selectTab(bad[0].id);
      return;
    }
    try {
      await save.mutateAsync(draft);
      setDirty(false);
      toast('Settings saved');
    } catch (err) {
      toast((err as Error).message || 'Could not save settings', 'error');
    }
  }

  function handleReset() {
    setDraft(toAppSettings(DEFAULT_SETTINGS));
    setDirty(true);
    toast('Defaults restored — press Save to apply');
  }

  function handleDiscard() {
    setDraft(toAppSettings(settings));
    setDirty(false);
    toast('Changes discarded');
  }

  const blanks = new Set(groupsWithBlanks().map((g) => g.id));

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure the lists and labels used across the app"
        actions={
          <Button variant="secondary" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" /> Reset to defaults
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Section rail: vertical on desktop, a scrollable row on mobile. */}
        <nav
          aria-label="Settings sections"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {GROUPS.map((g) => {
            const active = g.id === tab.id;
            return (
              <button
                key={g.id}
                onClick={() => selectTab(g.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full',
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )}
              >
                <g.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{g.label}</span>
                {blanks.has(g.id) && (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    title="Has a blank entry"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div>
          <p className="mb-3 text-sm text-slate-500">{tab.blurb}</p>
          <div className="space-y-4">
            {tab.custom === 'team' && <TeamRoster />}
            {tab.editors.map((e) =>
              e.kind === 'toned' ? (
                <TonedListEditor
                  key={e.key}
                  title={e.title}
                  description={e.description}
                  items={draft[e.key] as TonedOption[]}
                  onChange={(v) => patch(e.key, v as AppSettings[typeof e.key])}
                />
              ) : (
                <ListEditor
                  key={e.key}
                  title={e.title}
                  description={e.description}
                  placeholder={e.placeholder ?? 'Value'}
                  items={draft[e.key] as string[]}
                  onChange={(v) => patch(e.key, v as AppSettings[typeof e.key])}
                />
              ),
            )}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Renaming an entry does not rewrite records that already use the old
            value — those keep their stored label until you edit them.
          </p>
          {tab.danger && (
            // Keyed by tab so switching sections resets the confirm state.
            <DangerZone key={tab.id} action={tab.danger} />
          )}
        </div>
      </div>

      {/* Save stays reachable while scrolling, and reports unsaved changes
          across every section, not just the one on screen. */}
      <div className="sticky bottom-4 z-20 mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <p className="text-sm text-slate-500">
          {dirty ? (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              You have unsaved changes
            </span>
          ) : (
            'All changes saved'
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleDiscard} disabled={!dirty || save.isPending}>
            Discard
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || save.isPending}>
            <Check className="h-4 w-4" />
            {save.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DangerZone({ action }: { action: DangerAction }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  // Live counts fetched when the modal opens, so the warning names the real
  // blast radius instead of a vague "everything".
  const [counts, setCounts] = useState<number[] | null>(null);

  function openModal() {
    setConfirmText('');
    setCounts(null);
    setOpen(true);
    Promise.all(
      action.sheets.map((s) =>
        api.list(s.sheet).then((r) => r.records.length),
      ),
    )
      .then(setCounts)
      .catch(() => setCounts(null));
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const results = [];
      for (const s of action.sheets) {
        results.push(await api.removeAll(s.sheet));
        qc.invalidateQueries({ queryKey: ['records', s.sheet] });
      }
      const total = results.reduce((n, r) => n + r.deleted, 0);
      toast(`Deleted ${total} record${total === 1 ? '' : 's'}`);
      setOpen(false);
    } catch (err) {
      toast((err as Error).message || 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const summary = action.sheets
    .map((s, i) => (counts ? `${counts[i]} ${s.label}` : s.label))
    .join(' and ');

  return (
    <Card className="mt-4 border-rose-200 dark:border-rose-900">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <h2 className="font-semibold text-rose-700 dark:text-rose-400">
            Danger zone
          </h2>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {action.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{action.description}</p>
          </div>
          <Button variant="danger" size="sm" className="shrink-0" onClick={openModal}>
            <Trash2 className="h-4 w-4" /> Delete all
          </Button>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={action.title}
        description="This cannot be undone."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={busy || confirmText !== 'DELETE'}
            >
              <Trash2 className="h-4 w-4" />
              {busy ? 'Deleting...' : 'Delete all'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You are about to permanently delete{' '}
          <span className="font-semibold">{summary}</span>. {action.description}
        </p>
        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Type <span className="font-mono font-semibold">DELETE</span> to confirm
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoFocus
          />
        </div>
      </Modal>
    </Card>
  );
}

function SectionShell({
  title,
  description,
  children,
  onAdd,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onAdd: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      <div className="mt-3 space-y-2">{children}</div>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onAdd}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    </Card>
  );
}

function RowButtons({
  index,
  length,
  onMove,
  onRemove,
}: {
  index: number;
  length: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const iconBtn =
    'rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200';
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Move up"
        className={iconBtn}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Move down"
        className={iconBtn}
        disabled={index === length - 1}
        onClick={() => onMove(index + 1)}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Remove"
        className={`${iconBtn} hover:text-rose-600 dark:hover:text-rose-400`}
        disabled={length === 1}
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ListEditor({
  title,
  description,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <SectionShell
      title={title}
      description={description}
      onAdd={() => onChange([...items, ''])}
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="min-w-0 flex-1"
            value={item}
            placeholder={placeholder}
            onChange={(e) =>
              onChange(items.map((v, j) => (j === i ? e.target.value : v)))
            }
          />
          <RowButtons
            index={i}
            length={items.length}
            onMove={(to) => onChange(move(items, i, to))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </SectionShell>
  );
}

function TonedListEditor({
  title,
  description,
  items,
  onChange,
}: {
  title: string;
  description: string;
  items: TonedOption[];
  onChange: (items: TonedOption[]) => void;
}) {
  return (
    <SectionShell
      title={title}
      description={description}
      onAdd={() => onChange([...items, { label: '', tone: 'gray' }])}
    >
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className="min-w-0 flex-1"
            value={item.label}
            placeholder="Label"
            onChange={(e) =>
              onChange(
                items.map((v, j) =>
                  j === i ? { ...v, label: e.target.value } : v,
                ),
              )
            }
          />
          <div className="w-24 shrink-0 sm:w-28">
          <Select
            value={item.tone}
            aria-label="Colour"
            onChange={(e) =>
              onChange(
                items.map((v, j) =>
                  j === i ? { ...v, tone: e.target.value } : v,
                ),
              )
            }
          >
            {BADGE_TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          </div>
          <Badge tone={item.tone} className="hidden shrink-0 sm:inline-flex">
            {item.label || 'preview'}
          </Badge>
          <RowButtons
            index={i}
            length={items.length}
            onMove={(to) => onChange(move(items, i, to))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </SectionShell>
  );
}


// ---- Team roster -----------------------------------------------------------
// Backed by the `users` table, which is the single source for the roster. The
// old list of names on the Settings record is gone: it meant the same team
// existed in two places that could drift apart.

function TeamRoster() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);

  const query = useQuery({
    queryKey: ['tracker-users', 'all'],
    queryFn: () => trackerApi.users(true),
  });
  const users = query.data?.users ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tracker-users'] });
  };

  const create = useMutation({
    mutationFn: (input: UserInput) => trackerApi.createUser(input),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast('Team member added');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserUpdateInput }) =>
      trackerApi.updateUser(id, patch),
    onSuccess: invalidate,
    onError: (err: Error) => {
      toast(err.message, 'error');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => trackerApi.removeUser(id),
    onSuccess: () => {
      invalidate();
      toast('Team member removed');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState error={query.error as Error} onRetry={() => query.refetch()} />;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Team members
          </p>
          <p className="text-xs text-slate-400">
            The roster behind every picker in the app. Someone who has left should be
            made inactive rather than removed, so their work history survives.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="h-4 w-4" /> Add member
        </Button>
      </div>

      {adding && (
        <MemberForm
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSave={(input) => create.mutateAsync(input).then(() => undefined)}
        />
      )}

      {users.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
          Nobody on the team yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <MemberRow
              key={u.id}
              user={u}
              saving={update.isPending}
              onPatch={(patch) => update.mutate({ id: u.id, patch })}
              onDelete={() => {
                if (window.confirm(`Remove ${u.name} from the team?`)) remove.mutate(u.id);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  user,
  saving,
  onPatch,
  onDelete,
}: {
  user: User;
  saving: boolean;
  onPatch: (patch: UserUpdateInput) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className={cn(
        'rounded-lg border border-slate-200 p-3 dark:border-slate-800',
        !user.isActive && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {user.name}
            {user.role === 'ADMIN' && (
              <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                Admin
              </span>
            )}
            {!user.isActive && (
              <span className="ml-2 text-xs font-normal text-slate-400">Inactive</span>
            )}
          </p>
          <p className="truncate text-xs text-slate-400">
            {[user.designation, user.department, user.email].filter(Boolean).join(' · ') ||
              'No details yet'}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={user.isActive}
            disabled={saving}
            onChange={(e) => onPatch({ isActive: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
          />
          Active
        </label>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Edit'}
        </Button>
        <button
          onClick={onDelete}
          aria-label={`Remove ${user.name}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <MemberForm
          initial={user}
          pending={saving}
          onCancel={() => setOpen(false)}
          onSave={async (input) => {
            onPatch(input);
            setOpen(false);
          }}
        />
      )}
    </li>
  );
}

function MemberForm({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial?: User;
  pending: boolean;
  onCancel: () => void;
  onSave: (input: UserInput) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [designation, setDesignation] = useState(initial?.designation ?? '');
  const [department, setDepartment] = useState(initial?.department ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>(initial?.role ?? 'MEMBER');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError('A name is required');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email, or leave it blank');
      return;
    }
    setError(null);
    await onSave({
      name: name.trim(),
      designation: designation.trim() || null,
      department: department.trim() || null,
      email: email.trim() || null,
      role,
      isActive: initial?.isActive ?? true,
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Designation">
          <Input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="Analyst"
          />
        </Field>
        <Field label="Department">
          <Input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Applied AI Studio"
          />
        </Field>
        <Field label="Email">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {initial ? 'Save' : 'Add member'}
        </Button>
      </div>
    </div>
  );
}
