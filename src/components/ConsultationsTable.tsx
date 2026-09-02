import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Trash2, X } from 'lucide-react';
import {
  Avatar,
  EditableDate,
  EditableNumber,
  EditableText,
  EditableTime,
  UserCell,
} from '@/components/TrackerCells';
import { EmptyState, ErrorState } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { trackerApi } from '@/lib/workTrackerApi';
import { istToday } from '@/lib/ist';
import { cn } from '@/lib/utils';
import type { Consultation, User } from '@/types';

/**
 * The consultations table.
 *
 * Separate from the work table because a consultation is a different kind of
 * record, not a task with three extra numbers. Those numbers used to live on
 * every task, which meant a website build carried three permanently blank
 * consultation columns.
 *
 * NOT FROZEN. Nothing here honours the admin lock. A consultation is a running
 * tally the person who took it updates through the day, and making them find
 * the passcode to correct a count would only teach everyone to leave the app
 * unlocked. Removal still hides rather than destroys, so a mis-click is
 * recoverable.
 */
const COLUMNS = [
  { key: 'title', label: 'Consultation', width: 320, flex: true },
  { key: 'user', label: 'Taken by', width: 150, flex: false },
  { key: 'date', label: 'Date', width: 130, flex: false },
  { key: 'time', label: 'Time', width: 110, flex: false },
  { key: 'allocated', label: 'Allocated', width: 106, flex: false },
  { key: 'completed', label: 'Completed', width: 112, flex: false },
] as const;

/**
 * Wide enough for the new row's two buttons, not just the delete icon a normal
 * row shows. Sized for the wider of the two so opening the row does not push
 * the Completed field under them.
 */
const MENU_WIDTH = 60;

export function ConsultationsTable({
  users,
  user,
  adding,
  onDoneAdding,
}: {
  users: User[];
  /** The person the page is filtered to, or '' for everyone. */
  user: string;
  adding: boolean;
  onDoneAdding: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['consultations', user],
    queryFn: () => trackerApi.consultations(user || undefined),
  });
  const rows = query.data?.consultations ?? [];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['consultations'] });
  }, [qc]);

  const restore = useMutation({
    mutationFn: (id: string) => trackerApi.restoreConsultation(id),
    onSuccess: () => {
      invalidate();
      toast('Consultation restored');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => trackerApi.removeConsultation(id),
    onSuccess: (_d, id) => {
      invalidate();
      toast('Consultation deleted', 'success', {
        label: 'Undo',
        onAct: () => restore.mutate(id),
      });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof trackerApi.createConsultation>[0]) =>
      trackerApi.createConsultation(input),
    onSuccess: () => {
      invalidate();
      onDoneAdding();
      toast('Consultation added');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  /** One cell at a time, like the work table. */
  const save = useCallback(
    async (id: string, field: string, value: unknown) => {
      const k = `${id}:${field}`;
      setSavingCells((s) => ({ ...s, [k]: true }));
      setCellErrors((e) => {
        const { [k]: _drop, ...rest } = e;
        return rest;
      });
      try {
        await trackerApi.updateConsultation(id, { [field]: value });
        invalidate();
      } catch (err) {
        setCellErrors((e) => ({ ...e, [k]: (err as Error).message }));
      } finally {
        setSavingCells((s) => {
          const { [k]: _drop, ...rest } = s;
          return rest;
        });
      }
    },
    [invalidate],
  );

  const peopleWidth = useMemo(() => {
    const longest = users.reduce((n, u) => Math.max(n, u.name.length), 0);
    return Math.min(230, Math.max(112, 46 + Math.ceil(longest * 7.8)));
  }, [users]);

  const widthOf = useCallback(
    (c: (typeof COLUMNS)[number]) => (c.key === 'user' ? peopleWidth : c.width),
    [peopleWidth],
  );

  const tableMin = useMemo(
    () => COLUMNS.reduce((n, c) => n + (c.flex ? c.width : widthOf(c)), MENU_WIDTH),
    [widthOf],
  );

  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load consultations"
          error={query.error as Error}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  if (!adding && rows.length === 0 && !query.isLoading) {
    return (
      <div className="p-4">
        <EmptyState
          title="No consultations yet"
          description={
            user
              ? 'Nothing recorded for this person. Add Consultation puts the first one in.'
              : 'Add Consultation records one, with who took it and how many were allocated.'
          }
        />
      </div>
    );
  }

  return (
    <div className="jira-table max-h-[70vh] overflow-auto">
      <table
        style={{ tableLayout: 'fixed', minWidth: tableMin }}
        className="w-full border-collapse text-left"
      >
        <thead className="sticky top-0 z-20">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                style={
                  c.flex
                    ? { width: 'auto', minWidth: c.width }
                    : { width: widthOf(c), minWidth: widthOf(c), maxWidth: widthOf(c) }
                }
              >
                {c.label}
              </th>
            ))}
            <th style={{ width: MENU_WIDTH, minWidth: MENU_WIDTH }} />
          </tr>
        </thead>
        <tbody className="divide-y-0">
          {adding && (
            <NewConsultationRow
              users={users}
              defaultUser={user || users[0]?.id}
              pending={create.isPending}
              onCancel={onDoneAdding}
              onCreate={(input) => create.mutate(input)}
            />
          )}
          {rows.map((c) => (
            <ConsultationRow
              key={c.id}
              row={c}
              users={users}
              savingCells={savingCells}
              cellErrors={cellErrors}
              onSave={save}
              onDelete={() => {
                if (window.confirm(`Delete "${c.title}"? This can be undone.`))
                  remove.mutate(c.id);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsultationRow({
  row,
  users,
  savingCells,
  cellErrors,
  onSave,
  onDelete,
}: {
  row: Consultation;
  users: User[];
  savingCells: Record<string, boolean>;
  cellErrors: Record<string, string>;
  onSave: (id: string, field: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const cell = (field: string) => ({
    saving: savingCells[`${row.id}:${field}`],
    error: cellErrors[`${row.id}:${field}`] ?? null,
    // No `disabled`. Consultations are never frozen — see the file header.
  });

  return (
    <tr className="group" style={{ background: 'var(--n0)' }}>
      <td>
        <EditableText
          value={row.title}
          onSave={(v) => onSave(row.id, 'title', v)}
          {...cell('title')}
        />
      </td>
      <td>
        <UserCell
          value={row.userId}
          users={users}
          allowEmpty={false}
          ariaLabel={`Who took ${row.title}`}
          onSave={(v) => v && onSave(row.id, 'userId', v)}
          {...cell('userId')}
        />
      </td>
      <td>
        <EditableDate
          value={row.heldOn}
          ariaLabel={`Date of ${row.title}`}
          onSave={(v) => onSave(row.id, 'heldOn', v)}
          {...cell('heldOn')}
        />
      </td>
      <td>
        <EditableTime
          value={row.heldAt}
          ariaLabel={`Time of ${row.title}`}
          onSave={(v) => onSave(row.id, 'heldAt', v)}
          {...cell('heldAt')}
        />
      </td>
      <td>
        <EditableNumber
          value={row.allocated}
          ariaLabel={`Consultations allocated for ${row.title}`}
          onSave={(v) => onSave(row.id, 'allocated', v)}
          {...cell('allocated')}
        />
      </td>
      <td>
        <EditableNumber
          value={row.completed}
          ariaLabel={`Consultations completed for ${row.title}`}
          onSave={(v) => onSave(row.id, 'completed', v)}
          {...cell('completed')}
        />
      </td>
      <td className="text-right">
        <div className="row-menu">
          <button
            onClick={onDelete}
            aria-label={`Delete ${row.title}`}
            title="Delete"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

const ROW_CONTROL =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm leading-5 ' +
  'text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none ' +
  'focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800 ' +
  'dark:text-slate-100';

function NewConsultationRow({
  users,
  defaultUser,
  pending,
  onCancel,
  onCreate,
}: {
  users: User[];
  defaultUser?: string;
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    userId: string;
    heldOn?: string | null;
    heldAt?: string | null;
    allocated?: number | null;
    completed?: number | null;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [userId, setUserId] = useState(defaultUser ?? users[0]?.id ?? '');
  // Today, because a consultation is nearly always recorded on the day it
  // happened. Still editable for the one that is being caught up on.
  const [heldOn, setHeldOn] = useState(istToday());
  const [heldAt, setHeldAt] = useState('');
  const [allocated, setAllocated] = useState('');
  const [completed, setCompleted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (!title.trim()) {
      setError('Give the consultation a name');
      return;
    }
    if (!userId) {
      setError('Say who took it');
      return;
    }
    setError(null);
    onCreate({
      title: title.trim(),
      userId,
      heldOn: heldOn || null,
      heldAt: heldAt || null,
      // Blank stays blank: nobody having put a figure on it is not zero.
      allocated: allocated === '' ? null : Number(allocated),
      completed: completed === '' ? null : Number(completed),
    });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };

  const digits = (v: string) => v.replace(/[^0-9]/g, '');

  return (
    <>
      <tr onKeyDown={onKey} style={{ background: 'var(--b50)' }}>
        <td>
          <input
            autoFocus
            className={ROW_CONTROL}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What was the consultation?"
            aria-label="Consultation"
          />
        </td>
        <td>
          <select
            className={cn(ROW_CONTROL, 'row-select')}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            aria-label="Taken by"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            type="date"
            className={cn(ROW_CONTROL, 'row-date')}
            value={heldOn}
            onChange={(e) => setHeldOn(e.target.value)}
            aria-label="Consultation date"
          />
        </td>
        <td>
          <input
            type="time"
            className={cn(ROW_CONTROL, 'row-date')}
            value={heldAt}
            onChange={(e) => setHeldAt(e.target.value)}
            aria-label="Consultation time"
          />
        </td>
        <td>
          <input
            className={ROW_CONTROL}
            inputMode="numeric"
            value={allocated}
            onChange={(e) => setAllocated(digits(e.target.value))}
            aria-label="Consultations allocated"
          />
        </td>
        <td>
          <input
            className={ROW_CONTROL}
            inputMode="numeric"
            value={completed}
            onChange={(e) => setCompleted(digits(e.target.value))}
            aria-label="Consultations completed"
          />
        </td>
        <td className="px-1">
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={commit}
              disabled={pending}
              aria-label="Add consultation"
              title="Add (Enter)"
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
              aria-label="Discard new consultation"
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
          <td
            colSpan={COLUMNS.length + 1}
            style={{ background: 'var(--b50)', color: 'var(--r400)' }}
            className="px-3 pb-2 text-xs"
          >
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

/** Re-exported so the page can show a count beside the view switch. */
export function useConsultationCount(user: string) {
  const query = useQuery({
    queryKey: ['consultations', user],
    queryFn: () => trackerApi.consultations(user || undefined),
  });
  return query.data?.consultations.length ?? 0;
}

export { Avatar };
