import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Users2 } from 'lucide-react';
import { Avatar, AvatarStack } from '@/components/TrackerCells';
import { Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { trackerApi } from '@/lib/workTrackerApi';
import { cn } from '@/lib/utils';
import type { Task, User } from '@/types';

/**
 * Who is on a task, shown and edited in its Name cell.
 *
 * The owner comes first and always: they are `tasks.user_id`, the person the
 * work is filed under. Everybody after them is a collaborator. Keeping the
 * distinction visible matters — "whose work is this" and "who is on it" are
 * different questions, and a flat bag of avatars answers only the second.
 */
export function TeamOnTask({
  task,
  users,
  disabled,
  onChanged,
  onOpenChange,
}: {
  task: Task;
  users: User[];
  disabled?: boolean;
  onChanged: () => void;
  /**
   * Told when the picker opens, so the cell can lift itself above its
   * neighbours. The Name column is `sticky`, which makes every cell its own
   * stacking context — a popup inside one cannot paint over the cell below it
   * no matter how high its own z-index goes.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const show = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const owner = users.find((u) => u.id === task.userId);

  const save = useMutation({
    mutationFn: (ids: string[]) => trackerApi.setMembers(task.id, ids),
    onSuccess: (r) => {
      onChanged();
      const n = r.task.members.length;
      toast(n === 0 ? 'Now just one person' : `${n + 1} people on this`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const memberIds = new Set(task.members.map((m) => m.id));
  const people = [
    { name: task.userName, colour: owner?.colour ?? null },
    ...task.members.map((m) => ({ name: m.name, colour: m.colour })),
  ];

  const toggle = (id: string) => {
    const next = new Set(memberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save.mutate([...next]);
  };

  return (
    <span className="relative flex min-w-0 items-center gap-1.5">
      {people.length > 1 ? (
        <AvatarStack people={people} max={3} />
      ) : (
        <Avatar name={task.userName} colour={owner?.colour} size={24} />
      )}
      <span
        title={people.map((p) => p.name).join(', ')}
        style={{ color: 'var(--n800)' }}
        className="min-w-0 flex-1 truncate text-sm"
      >
        {task.userName}
        {task.members.length > 0 && (
          <span style={{ color: 'var(--n200)' }}> +{task.members.length}</span>
        )}
      </span>

      {!disabled && (
        <button
          onClick={() => show(!open)}
          aria-label={`Who is working on ${task.title}`}
          aria-expanded={open}
          title="Add or remove people on this"
          className="row-menu shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {save.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Users2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => show(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-slate-400">
              Working on this
            </p>
            {/* The owner is listed but cannot be unticked here — removing them
                would leave the task belonging to nobody. Change the Name cell
                instead. */}
            <span className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400">
              <Avatar name={task.userName} colour={owner?.colour} size={20} />
              <span className="min-w-0 flex-1 truncate">{task.userName}</span>
              <span className="text-[11px]">owner</span>
            </span>
            {users
              .filter((u) => u.id !== task.userId)
              .map((u) => {
                const on = memberIds.has(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    disabled={save.isPending}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                      'hover:bg-slate-50 dark:hover:bg-slate-800',
                    )}
                  >
                    <Avatar name={u.name} colour={u.colour} size={20} />
                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                      {u.name}
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
                  </button>
                );
              })}
          </div>
        </>
      )}
    </span>
  );
}

/**
 * The group block: pick a piece of work, see who is on it.
 *
 * Replaces a chip that only counted shared work. The table answers "what is
 * everyone doing"; this answers the other direction — "who is on this" — for
 * one piece of work at a time, and lets the team be changed from the same
 * place. A task is listed once, under its owner, so without this a
 * collaborator's involvement is invisible unless you happen to open that row.
 */
export function WorkGroupBlock({
  user,
  users,
  onChanged,
}: {
  /** The person the table is filtered to, or '' for everyone. */
  user: string;
  users: User[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ['tasks', user, 'group'],
    queryFn: () => trackerApi.tasks({ user: user || undefined, tab: 'all' }),
    staleTime: 15_000,
  });
  const tasks = query.data?.tasks ?? [];
  const task = tasks.find((t) => t.id === selected);

  const save = useMutation({
    mutationFn: (ids: string[]) => trackerApi.setMembers(task!.id, ids),
    onSuccess: (r) => {
      // Write the server's answer straight into the cache rather than waiting
      // for a refetch. Relying on the round trip left the count a step behind:
      // adding somebody showed no change until the *next* click, and the click
      // after that computed its toggle from the stale set.
      qc.setQueryData<{ tasks: Task[] }>(['tasks', user, 'group'], (prev) =>
        prev
          ? { tasks: prev.tasks.map((t) => (t.id === r.task.id ? r.task : t)) }
          : prev,
      );
      onChanged();
      const n = r.task.members.length + 1;
      toast(n === 1 ? 'Just one person on this' : `${n} people on this`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  if (tasks.length === 0) return null;

  const owner = task ? users.find((u) => u.id === task.userId) : undefined;
  const people = task
    ? [
        { name: task.userName, colour: owner?.colour ?? null },
        ...task.members.map((m) => ({ name: m.name, colour: m.colour })),
      ]
    : [];
  const memberIds = new Set(task?.members.map((m) => m.id) ?? []);

  const toggle = (id: string) => {
    const next = new Set(memberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save.mutate([...next]);
  };

  return (
    <span className="relative flex items-center gap-1.5">
      <span className="w-44">
        <label htmlFor="work-group" className="sr-only">
          Show who is working on a piece of work
        </label>
        <Select
          id="work-group"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setOpen(false);
          }}
          title="Pick a piece of work to see who is on it"
          className="py-1.5 text-sm"
        >
          <option value="">Group…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      </span>

      {task && (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${people.length} working on ${task.title}. Change who is on it.`}
          data-group-team
          title={`${people.length} on "${task.title}": ${people.map((p) => p.name).join(', ')}`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <AvatarStack people={people} max={4} />
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {people.length}
          </span>
        </button>
      )}

      {open && task && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="truncate px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400">
              Working on {task.title}
            </p>
            {/* The owner cannot be unticked: removing them would leave the work
                belonging to nobody. Change that in the table's Name cell. */}
            <span className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400">
              <Avatar name={task.userName} colour={owner?.colour} size={20} />
              <span className="min-w-0 flex-1 truncate">{task.userName}</span>
              <span className="text-[11px]">owner</span>
            </span>
            {users
              .filter((u) => u.id !== task.userId)
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  disabled={save.isPending}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Avatar name={u.name} colour={u.colour} size={20} />
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                    {u.name}
                  </span>
                  {memberIds.has(u.id) && (
                    <Check className="h-4 w-4 shrink-0 text-brand-600" />
                  )}
                </button>
              ))}
          </div>
        </>
      )}
    </span>
  );
}
