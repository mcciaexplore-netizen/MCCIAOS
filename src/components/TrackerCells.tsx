// Work Tracker cell primitives, built to Atlassian/Jira anatomy.
//
// Colours come from the .jira-table token block in src/index.css rather than
// Tailwind classes, so light and dark resolve from one place and the values
// stay Atlassian's exact ones.
//
// Every cell follows the same contract: show the value, let the user change it
// in place, hand the new value up, and never hold state the parent owns. The
// parent does the optimistic update and the rollback.
//
// Escape reverts. Enter and blur commit. Dropdowns and dates commit on change.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ChevronsUp, Equal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_LOZENGE,
  TASK_TYPE_FILL,
  TASK_TYPE_LABELS,
} from '@/constants';
import type { TaskPriority, TaskStatus, TaskType, User } from '@/types';

// ---- Type square ----------------------------------------------------------

/** 16x16 solid square, Jira's issue-type marker. */
export function TypeSquare({ type }: { type: TaskType }) {
  return (
    <span
      title={TASK_TYPE_LABELS[type]}
      aria-label={TASK_TYPE_LABELS[type]}
      style={{ background: TASK_TYPE_FILL[type], borderRadius: 3 }}
      className="inline-block h-4 w-4 shrink-0"
    />
  );
}

// ---- Avatar ---------------------------------------------------------------

/**
 * 24px circle with initials. The name is deliberately not rendered — Jira
 * shows the avatar alone and puts the name in the tooltip, which is what keeps
 * the people columns to 40px.
 */
export function Avatar({
  name,
  size = 24,
  ring = false,
  dot = false,
  className,
}: {
  name: string;
  size?: number;
  ring?: boolean;
  /** Marks a collaborator who carries their own due date. */
  dot?: boolean;
  className?: string;
}) {
  const initials = initialsOf(name);
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        title={name}
        aria-label={name}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
          background: tintFor(name),
          color: '#fff',
          boxShadow: ring ? '0 0 0 2px var(--n0)' : undefined,
        }}
        className="inline-flex items-center justify-center rounded-full font-semibold"
      >
        {initials}
      </span>
      {dot && (
        <span
          title={`${name} has their own due date`}
          style={{ background: 'var(--y400)', boxShadow: '0 0 0 1.5px var(--n0)' }}
          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full"
        />
      )}
    </span>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Atlassian-ish avatar fills, picked deterministically so one person is always
// one colour without storing anything.
const AVATAR_FILLS = ['#0052CC', '#00875A', '#5243AA', '#BF2600', '#0747A6', '#006644'];
function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_FILLS[Math.abs(hash) % AVATAR_FILLS.length];
}

/** Overlapping avatars, Jira's -8px with a 2px ring in the row colour. */
export function AvatarStack({
  people,
  max = 3,
}: {
  people: { name: string; dot?: boolean }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <Avatar
          key={p.name + i}
          name={p.name}
          size={24}
          ring
          dot={p.dot}
          className={i > 0 ? '-ml-2' : undefined}
        />
      ))}
      {extra > 0 && (
        <span
          style={{ background: 'var(--n30)', color: 'var(--n500)', boxShadow: '0 0 0 2px var(--n0)' }}
          className="-ml-2 inline-flex h-6 items-center rounded-full px-1.5 text-[10px] font-semibold"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ---- Status lozenge -------------------------------------------------------

/** Filled rectangle, uppercase. Not a dot, not a pill. */
export function Lozenge({ status }: { status: TaskStatus }) {
  const { bg, fg } = TASK_STATUS_LOZENGE[status];
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: '2px 6px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '16px',
        letterSpacing: '0.3px',
      }}
      className="inline-block whitespace-nowrap uppercase"
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

// ---- Priority icon --------------------------------------------------------

const PRIORITY_ICON = {
  critical: ChevronsUp,
  high: ArrowUp,
  medium: Equal,
  low: ArrowDown,
} as const;

/** Icon only, 16px. The label lives in the tooltip, as in Jira. */
export function PriorityIcon({ priority }: { priority: TaskPriority }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <Icon
      className="h-4 w-4 shrink-0"
      style={{ color: TASK_PRIORITY_COLOR[priority] }}
      aria-label={TASK_PRIORITY_LABELS[priority]}
    />
  );
}

// ---- Shared cell chrome ---------------------------------------------------

export interface CellProps {
  saving?: boolean;
  error?: string | null;
  disabled?: boolean;
}

/** Draws the saving pulse and the inline error identically for every cell. */
export function CellShell({
  saving,
  error,
  children,
}: CellProps & { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div
        style={error ? { boxShadow: '0 0 0 1px var(--r400)', borderRadius: 3 } : undefined}
        className={cn(saving && 'animate-pulse')}
      >
        {children}
      </div>
      {error && (
        <p style={{ color: 'var(--r400)' }} className="mt-0.5 text-[11px]">
          {error}
        </p>
      )}
    </div>
  );
}

const cellBase =
  'w-full bg-transparent px-1 py-0.5 text-left text-sm text-[color:var(--n800)] ' +
  'rounded-[3px] border border-transparent hover:border-[color:var(--n40)] ' +
  'focus:outline-none focus:bg-[color:var(--n0)]';

// ---- Text -----------------------------------------------------------------

/**
 * Commits on Enter or blur, never per keystroke, so there is no request to
 * debounce. Escape restores the value that was there when editing began.
 */
export function EditableText({
  value,
  onSave,
  placeholder,
  saving,
  error,
  disabled,
}: CellProps & {
  value: string;
  onSave: (next: string) => void;
  placeholder?: string;
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
      setDraft(committed.current); // required field: revert, never store blank
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
        className={cn(cellBase, 'truncate')}
      />
    </CellShell>
  );
}

// ---- Icon-fronted select --------------------------------------------------

/**
 * A native select rendered behind a visual (lozenge, icon, square, avatar), so
 * the control keeps native keyboard and mobile behaviour while looking like
 * Jira's inline menus.
 */
export function IconSelect<T extends string>({
  value,
  options,
  labels,
  onSave,
  render,
  saving,
  error,
  disabled,
  width,
  optionDisabled,
  optionTitle,
  ariaLabel,
}: CellProps & {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onSave: (next: T) => void;
  render: (v: T) => ReactNode;
  width?: number;
  optionDisabled?: (v: T) => boolean;
  optionTitle?: (v: T) => string | undefined;
  ariaLabel: string;
}) {
  return (
    <CellShell saving={saving} error={error}>
      <span className="relative inline-flex items-center" style={{ width }}>
        <span className="pointer-events-none absolute left-0 flex items-center">
          {render(value)}
        </span>
        <select
          value={value}
          disabled={disabled}
          data-cell
          aria-label={ariaLabel}
          onChange={(e) => onSave(e.target.value as T)}
          className="w-full cursor-pointer rounded-[3px] border border-transparent bg-transparent py-0.5 text-transparent hover:border-[color:var(--n40)] focus:outline-none"
        >
          {options.map((o) => (
            <option
              key={o}
              value={o}
              disabled={optionDisabled?.(o)}
              title={optionTitle?.(o)}
              className="text-[color:var(--n800)]"
            >
              {labels[o]}
            </option>
          ))}
        </select>
      </span>
    </CellShell>
  );
}

// ---- Date -----------------------------------------------------------------

/** `12 Sep` in the current year, `12 Sep 2025` otherwise. */
export function formatJiraDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function EditableDate({
  value,
  onSave,
  saving,
  error,
  disabled,
  min,
  overdue,
  ariaLabel,
}: CellProps & {
  value: string | null;
  onSave: (next: string | null) => void;
  min?: string;
  overdue?: boolean;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CellShell saving={saving} error={error}>
        <input
          type="date"
          autoFocus
          defaultValue={value ?? ''}
          min={min}
          data-cell
          aria-label={ariaLabel}
          onChange={(e) => {
            onSave(e.target.value === '' ? null : e.target.value);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
          className={cn(cellBase, 'tabular-nums')}
        />
      </CellShell>
    );
  }

  // Reads as plain text until clicked, so a dense row is not a wall of native
  // date widgets.
  return (
    <CellShell saving={saving} error={error}>
      <button
        data-cell
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setEditing(true);
        }}
        style={{ color: overdue ? 'var(--r400)' : 'var(--n200)' }}
        className={cn(cellBase, 'tabular-nums')}
      >
        {value ? formatJiraDate(value) : '—'}
      </button>
    </CellShell>
  );
}

// ---- User picker, avatar only ---------------------------------------------

export function UserCell({
  value,
  users,
  onSave,
  saving,
  error,
  disabled,
  allowEmpty = true,
  ariaLabel,
}: CellProps & {
  value: string | null;
  users: User[];
  onSave: (next: string | null) => void;
  allowEmpty?: boolean;
  ariaLabel: string;
}) {
  const current = users.find((u) => u.id === value);
  return (
    <CellShell saving={saving} error={error}>
      <span className="relative inline-flex h-6 w-6 items-center">
        <span className="pointer-events-none absolute inset-0 flex items-center">
          {current ? (
            <Avatar name={current.name} size={24} />
          ) : (
            <span
              style={{ background: 'var(--n30)', color: 'var(--n200)' }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px]"
              title="Nobody"
            >
              ?
            </span>
          )}
        </span>
        <select
          value={value ?? ''}
          disabled={disabled}
          data-cell
          aria-label={ariaLabel}
          onChange={(e) => onSave(e.target.value === '' ? null : e.target.value)}
          className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent text-transparent opacity-0 focus:opacity-100 focus:outline-none"
        >
          {allowEmpty && <option value="">Nobody</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </span>
    </CellShell>
  );
}

/** Auto-set timestamps, muted and not editable. */
export function ReadOnlyDate({ value }: { value: string | null }) {
  return (
    <span style={{ color: 'var(--n200)' }} className="block px-1 text-sm tabular-nums">
      {value ? formatJiraDate(value) : '—'}
    </span>
  );
}
