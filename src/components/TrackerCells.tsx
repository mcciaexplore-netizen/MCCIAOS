// Editable cell primitives for the Work Tracker table.
//
// Every cell follows the same contract: show the value, let the user change it
// in place, hand the new value up, and never hold state the parent owns. The
// parent does the optimistic update and the rollback, so a cell only has to
// report "this is the new value" or "the user gave up".
//
// Escape reverts. Enter and blur commit. Dropdowns and dates commit on change.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import {
  TASK_STATUS_DOT,
  TASK_STATUS_LABELS,
  TASK_STATUS_TEXT,
} from '@/constants';
import type { TaskStatus, User } from '@/types';

// ---- Avatar ---------------------------------------------------------------

/**
 * Initials on a colour derived from the name, so the same person is the same
 * colour everywhere without storing anything. Nobody has an avatar_url yet.
 */
const AVATAR_TONES = [
  'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export function Avatar({
  name,
  size = 'sm',
  className,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'lg';
  className?: string;
}) {
  const dims =
    size === 'lg' ? 'h-11 w-11 text-sm' : size === 'xs' ? 'h-5 w-5 text-[9px]' : 'h-7 w-7 text-[11px]';
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        dims,
        toneFor(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping avatars for the people on a task. */
export function AvatarStack({
  names,
  max = 3,
  size = 'xs',
}: {
  names: string[];
  max?: number;
  size?: 'xs' | 'sm';
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((n, i) => (
        <Avatar
          key={n + i}
          name={n}
          size={size}
          className={cn('ring-2 ring-white dark:ring-slate-900', i > 0 && '-ml-1.5')}
        />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 inline-flex h-5 items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500 ring-2 ring-white dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-900">
          +{extra}
        </span>
      )}
    </span>
  );
}

// ---- Status --------------------------------------------------------------

/** Dot plus text. A filled chip on every row of a dense table is noise. */
export function StatusDot({ status }: { status: TaskStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', TASK_STATUS_DOT[status])} />
      <span className={cn('text-sm', TASK_STATUS_TEXT[status])}>
        {TASK_STATUS_LABELS[status]}
      </span>
    </span>
  );
}

// ---- Shared cell chrome ---------------------------------------------------

const cellBase =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-left text-sm ' +
  'hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-500/30 dark:hover:border-slate-700 dark:focus:bg-slate-800';

export interface CellProps {
  /** Set while this cell's PATCH is in flight. */
  saving?: boolean;
  /** Set when the last save for this cell failed. */
  error?: string | null;
  disabled?: boolean;
}

/** Wraps a cell so the saving pulse and the inline error are drawn identically. */
export function CellShell({
  saving,
  error,
  children,
}: CellProps & { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          'rounded-md',
          saving && 'animate-pulse ring-1 ring-brand-400/60',
          error && 'ring-1 ring-rose-500',
        )}
      >
        {children}
      </div>
      {error && (
        <p className="mt-0.5 px-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

// ---- Text -----------------------------------------------------------------

/**
 * Commits on Enter or blur, never per keystroke — so there is no request to
 * debounce. Escape restores the value that was there when editing began.
 */
export function EditableText({
  value,
  onSave,
  placeholder,
  saving,
  error,
  disabled,
  className,
}: CellProps & {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === committed.current) return;
    if (next === '') {
      // Required field: revert rather than storing an empty title.
      setDraft(committed.current);
      return;
    }
    committed.current = next;
    onSave(next);
  };

  return (
    <CellShell saving={saving} error={error}>
      <input
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        data-cell
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(committed.current);
            e.currentTarget.blur();
          }
        }}
        className={cn(cellBase, 'font-medium text-slate-800 dark:text-slate-100', className)}
      />
    </CellShell>
  );
}

// ---- Select ---------------------------------------------------------------

export function EditableSelect<T extends string>({
  value,
  options,
  onSave,
  saving,
  error,
  disabled,
  renderValue,
  optionDisabled,
  optionTitle,
}: CellProps & {
  value: T;
  options: readonly T[];
  onSave: (next: T) => void;
  renderValue?: (v: T) => ReactNode;
  labels?: Record<T, string>;
  optionDisabled?: (v: T) => boolean;
  optionTitle?: (v: T) => string | undefined;
}) {
  return (
    <CellShell saving={saving} error={error}>
      <div className="relative">
        {renderValue && (
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
            {renderValue(value)}
          </span>
        )}
        <select
          value={value}
          disabled={disabled}
          data-cell
          onChange={(e) => onSave(e.target.value as T)}
          className={cn(
            cellBase,
            'cursor-pointer appearance-none pr-6',
            renderValue && 'text-transparent',
          )}
        >
          {options.map((o) => (
            <option
              key={o}
              value={o}
              disabled={optionDisabled?.(o)}
              title={optionTitle?.(o)}
              className="text-slate-900 dark:text-slate-100"
            >
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    </CellShell>
  );
}

// ---- Date -----------------------------------------------------------------

export function EditableDate({
  value,
  onSave,
  saving,
  error,
  disabled,
  min,
  tone,
}: CellProps & {
  value: string | null;
  onSave: (next: string | null) => void;
  min?: string;
  tone?: 'danger';
}) {
  return (
    <CellShell saving={saving} error={error}>
      <input
        type="date"
        value={value ?? ''}
        min={min}
        disabled={disabled}
        data-cell
        onChange={(e) => onSave(e.target.value === '' ? null : e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        className={cn(
          cellBase,
          'tabular-nums',
          tone === 'danger'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-600 dark:text-slate-300',
        )}
      />
    </CellShell>
  );
}

// ---- User picker ----------------------------------------------------------

export function UserPicker({
  value,
  users,
  onSave,
  saving,
  error,
  disabled,
  allowEmpty = true,
  emptyLabel = 'Unassigned',
  showAvatar = true,
}: CellProps & {
  value: string | null;
  users: User[];
  onSave: (next: string | null) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  showAvatar?: boolean;
}) {
  const current = users.find((u) => u.id === value);
  return (
    <CellShell saving={saving} error={error}>
      <div className="relative flex items-center gap-1.5">
        {showAvatar && current && <Avatar name={current.name} size="sm" />}
        <select
          value={value ?? ''}
          disabled={disabled}
          data-cell
          onChange={(e) => onSave(e.target.value === '' ? null : e.target.value)}
          className={cn(cellBase, 'cursor-pointer truncate text-slate-700 dark:text-slate-200')}
        >
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
    </CellShell>
  );
}

/** Read-only cell for the two auto-set timestamps. */
export function ReadOnlyCell({ children }: { children: ReactNode }) {
  return (
    <span className="block px-2 py-1 text-sm tabular-nums text-slate-400">
      {children}
    </span>
  );
}
