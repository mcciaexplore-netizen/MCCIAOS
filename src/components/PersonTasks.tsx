import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  EditableDate,
  EditableNumber,
  EditableText,
  IconSelect,
  Lozenge,
  PriorityMark,
  UserCell,
} from '@/components/TrackerCells';
import { useToast } from '@/components/Toast';
import { trackerApi } from '@/lib/workTrackerApi';
import { readTrackerActor } from '@/lib/trackerIdentity';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '@/constants';
import type { TaskPriority, TaskStatus, User } from '@/types';

/**
 * One person's work, in full, edited in place.
 *
 * The Settings roster could already say how many tasks somebody was carrying
 * and offer to clear the lot. Seeing *which* tasks, and correcting a date on
 * one of them, meant leaving for the tracker and filtering back to them. This
 * closes that: the count is now a disclosure, and opening it gives every field.
 *
 * Unaffected by the edit lock on purpose. That lock guards the tracker against
 * a stray click while somebody is working in it; this panel is somewhere you
 * arrive deliberately, having chosen a person, in order to fix something.
 */
export function PersonTasks({ person, users }: { person: User; users: User[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const actor = readTrackerActor();

  const query = useQuery({
    queryKey: ['tasks', person.id, 'all'],
    queryFn: () => trackerApi.tasks({ user: person.id, tab: 'all' }),
  });
  const tasks = query.data?.tasks ?? [];

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-counts'] });
    qc.invalidateQueries({ queryKey: ['tracker-staleness'] });
  }, [qc]);

  const save = useCallback(
    async (id: string, field: string, value: unknown) => {
      const k = `${id}:${field}`;
      setSavingCells((s) => ({ ...s, [k]: true }));
      setCellErrors((e) => {
        const { [k]: _drop, ...rest } = e;
        return rest;
      });
      try {
        await trackerApi.update(id, { [field]: value }, actor);
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
    [actor, invalidate],
  );

  const remove = useMutation({
    mutationFn: (id: string) => trackerApi.remove(id, actor),
    onSuccess: (_d, id) => {
      invalidate();
      toast('Task deleted', 'success', {
        label: 'Undo',
        onAct: async () => {
          await trackerApi.restore(id, actor);
          invalidate();
          toast('Task restored');
        },
      });
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  /** Only people flagged for it, plus whoever the task already names. */
  const reportOptions = (keeping: string | null) =>
    users.filter((u) => u.canBeReportedTo || u.id === keeping);
  const approverOptions = (keeping: string | null) =>
    users.filter((u) => u.canApprove || u.id === keeping);

  if (query.isLoading) {
    return (
      <p className="px-1 py-3 text-xs text-slate-400" aria-live="polite">
        Loading {person.name}&rsquo;s work…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="px-1 py-3 text-xs text-rose-600 dark:text-rose-400">
        Could not load: {(query.error as Error).message}
      </p>
    );
  }
  if (tasks.length === 0) {
    return (
      <p className="px-1 py-3 text-xs text-slate-400">
        {person.name} has nothing on right now.
      </p>
    );
  }

  const cell = (id: string, field: string) => ({
    saving: savingCells[`${id}:${field}`],
    error: cellErrors[`${id}:${field}`] ?? null,
  });

  return (
    <div className="jira-table -mx-1 mt-1 overflow-x-auto pb-1">
      {/* 935px of fixed columns plus Title's 220 floor. Set smaller, and a
          fixed layout squeezes Title instead of scrolling — cell minWidth does
          not hold a floor here, the table's does. */}
      <table
        style={{ tableLayout: 'fixed', minWidth: 935 + 220 }}
        className="w-full border-collapse text-left"
      >
        <thead>
          <tr>
            <th style={{ width: 'auto', minWidth: 220 }}>Title</th>
            <th style={{ width: 94 }}>Priority</th>
            <th style={{ width: 111 }}>Status</th>
            <th style={{ width: 114 }}>Allocation</th>
            <th style={{ width: 114 }}>Due</th>
            <th style={{ width: 114 }}>Deadline</th>
            <th style={{ width: 84 }}>%</th>
            <th style={{ width: 132 }}>Reports to</th>
            <th style={{ width: 132 }}>Approver</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody className="divide-y-0">
          {tasks.map((t) => (
            <tr key={t.id} className="group" style={{ background: 'var(--n0)' }}>
              <td>
                <EditableText
                  value={t.title}
                  onSave={(v) => save(t.id, 'title', v)}
                  {...cell(t.id, 'title')}
                />
              </td>
              <td>
                <IconSelect<TaskPriority>
                  value={t.priority}
                  options={TASK_PRIORITIES}
                  labels={TASK_PRIORITY_LABELS}
                  onSave={(v) => save(t.id, 'priority', v)}
                  render={(v) => <PriorityMark priority={v} />}
                  width={94}
                  ariaLabel={`Priority of ${t.title}`}
                  {...cell(t.id, 'priority')}
                />
              </td>
              <td>
                <IconSelect<TaskStatus>
                  value={t.status}
                  options={TASK_STATUSES}
                  labels={TASK_STATUS_LABELS}
                  onSave={(v) => save(t.id, 'status', v)}
                  render={(v) => <Lozenge status={v} />}
                  width={104}
                  ariaLabel={`Status of ${t.title}`}
                  {...cell(t.id, 'status')}
                />
              </td>
              <td>
                <EditableDate
                  value={t.allocationDate}
                  ariaLabel={`Allocation date of ${t.title}`}
                  onSave={(v) => save(t.id, 'allocationDate', v)}
                  {...cell(t.id, 'allocationDate')}
                />
              </td>
              <td>
                <EditableDate
                  value={t.dueDate}
                  overdue={t.isOverdue && !t.deadlineDate}
                  slipped={t.hasSlipped}
                  ariaLabel={`Due date of ${t.title}`}
                  onSave={(v) => save(t.id, 'dueDate', v)}
                  {...cell(t.id, 'dueDate')}
                />
              </td>
              <td>
                <EditableDate
                  value={t.deadlineDate}
                  min={t.dueDate ?? undefined}
                  overdue={t.pastDeadline}
                  bold={t.pastDeadline}
                  ariaLabel={`Deadline of ${t.title}`}
                  onSave={(v) => save(t.id, 'deadlineDate', v)}
                  {...cell(t.id, 'deadlineDate')}
                />
              </td>
              <td>
                <EditableNumber
                  value={t.percentage}
                  max={100}
                  suffix="%"
                  ariaLabel={`Percentage of ${t.title}`}
                  onSave={(v) => save(t.id, 'percentage', v)}
                  {...cell(t.id, 'percentage')}
                />
              </td>
              <td>
                <UserCell
                  value={t.reportTo}
                  users={reportOptions(t.reportTo)}
                  ariaLabel={`Reports to, for ${t.title}`}
                  onSave={(v) => save(t.id, 'reportTo', v)}
                  {...cell(t.id, 'reportTo')}
                />
              </td>
              <td>
                <UserCell
                  value={t.approverId}
                  users={approverOptions(t.approverId)}
                  ariaLabel={`Approver of ${t.title}`}
                  onSave={(v) => save(t.id, 'approverId', v)}
                  {...cell(t.id, 'approverId')}
                />
              </td>
              <td className="text-right">
                <div className="row-menu">
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete "${t.title}"? This can be undone.`))
                        remove.mutate(t.id);
                    }}
                    aria-label={`Delete ${t.title}`}
                    title="Delete"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
