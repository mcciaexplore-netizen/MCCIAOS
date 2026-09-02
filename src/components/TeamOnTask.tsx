import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Users2 } from 'lucide-react';
import { Avatar, AvatarStack } from '@/components/TrackerCells';
import { Button } from '@/components/ui';
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
 * The shared-work panel, opened from the toolbar.
 *
 * Answers one question the table cannot at a glance: which work has more than
 * one person on it, and who. The table lists a task once, under its owner, so a
 * collaborator's involvement is invisible until you look at that row.
 */
export function SharedWorkButton({ user }: { user: string }) {
  const [open, setOpen] = useState(false);
  // Sits in the toolbar, not in a sticky cell, so nothing above it needs
  // telling when it opens.
  const show = setOpen;
  const query = useQuery({
    queryKey: ['shared-work', user],
    queryFn: () => trackerApi.sharedWork(user || undefined),
    staleTime: 30_000,
  });
  const shared = query.data?.shared ?? [];

  if (shared.length === 0) return null;

  return (
    <span className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => show(!open)}
        aria-expanded={open}
        title="Work more than one person is on"
      >
        <Users2 className="h-4 w-4" />
        {shared.length} shared
      </Button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => show(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400">
              Worked on by more than one person
            </p>
            {shared.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
                    {s.title}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {s.people.map((p) => p.name).join(', ')}
                  </span>
                </span>
                <AvatarStack people={s.people} max={4} />
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {s.people.length}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
