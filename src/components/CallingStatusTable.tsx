/**
 * Calling status: one row per person, four running tallies.
 *
 * Not a list of records like Consultations — nobody wants a row per phone call.
 * The roster is the table, and the numbers move through the day, so every
 * person on it appears whether or not they have been given calls yet.
 *
 * Each cell saves on its own, sending only the figure that changed. Two people
 * updating different columns at the same moment therefore cannot overwrite one
 * another, which a whole-row save from a stale table would do in silence.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneCall } from 'lucide-react';
import { Avatar, EditableNumber } from '@/components/TrackerCells';
import { EmptyState, ErrorState } from '@/components/ui';
import { trackerApi } from '@/lib/workTrackerApi';
import { CALLING_FIELDS } from '@/schemas/workTracker';
import type { CallingStatus } from '@/types';

/** The five columns, in order. Width is fixed so the header is authoritative. */
const COLUMNS = [
  { key: 'userName', label: 'Name', width: 200 },
  { key: 'callsAllocated', label: 'Calls Allocated', width: 130 },
  { key: 'callsPicked', label: 'Calls Picked', width: 120 },
  { key: 'consultationScheduled', label: 'Consultation Scheduled', width: 180 },
  { key: 'notPicked', label: 'Not Picked', width: 110 },
] as const;

type Field = (typeof CALLING_FIELDS)[number];

export function CallingStatusTable({ user }: { user: string }) {
  const qc = useQueryClient();
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ['calling-status', user],
    queryFn: () => trackerApi.callingStatus(user || undefined),
  });

  const save = useMutation({
    mutationFn: (v: { userId: string; field: Field; value: number | null }) =>
      trackerApi.setCallingField(v.userId, v.field, v.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calling-status'] }),
  });

  const key = (userId: string, field: string) => `${userId}:${field}`;

  async function onSave(userId: string, field: Field, value: number | null) {
    const k = key(userId, field);
    setSaving((s) => ({ ...s, [k]: true }));
    setCellErrors((e) => {
      const { [k]: _gone, ...rest } = e;
      return rest;
    });
    try {
      await save.mutateAsync({ userId, field, value });
    } catch (err) {
      // Kept on the cell rather than raised as a banner: the person needs to
      // know which figure failed, and a page-level message cannot say.
      setCellErrors((e) => ({ ...e, [k]: (err as Error).message }));
    } finally {
      setSaving((s) => ({ ...s, [k]: false }));
    }
  }

  if (query.isLoading) {
    return <p className="p-4 text-sm text-slate-400">Loading calling status…</p>;
  }
  if (query.isError) {
    return (
      <div className="p-4">
        <ErrorState
          title="Could not load calling status"
          error={query.error as Error}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const people: CallingStatus[] = query.data?.people ?? [];
  if (people.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<PhoneCall className="h-10 w-10" />}
          title="No team members yet"
          description="Add people to the roster and their calling tallies appear here."
        />
      </div>
    );
  }

  const total = (field: Field) =>
    people.reduce((sum, p) => sum + (p[field] ?? 0), 0);
  // A column of all-blanks totals 0, which would read as a real figure. Only
  // show a total once somebody has actually put a number in.
  const anyRecorded = (field: Field) => people.some((p) => p[field] !== null);

  return (
    <div className="overflow-x-auto">
      <table
        style={{ tableLayout: 'fixed', minWidth: 740 }}
        className="w-full border-collapse text-left"
      >
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-50 text-xs font-medium text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, minWidth: c.width }}
                className="border-b border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr
              key={p.userId}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40"
            >
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <Avatar name={p.userName} colour={p.colour ?? undefined} />
                  <span className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {p.userName}
                  </span>
                </span>
              </td>
              {CALLING_FIELDS.map((field) => (
                <td key={field}>
                  <EditableNumber
                    value={p[field]}
                    ariaLabel={`${COLUMNS.find((c) => c.key === field)?.label} for ${p.userName}`}
                    onSave={(v) => onSave(p.userId, field, v)}
                    saving={saving[key(p.userId, field)]}
                    error={cellErrors[key(p.userId, field)] ?? null}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 text-sm font-medium text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
            <td className="px-3 py-2">Total</td>
            {CALLING_FIELDS.map((field) => (
              <td key={field} className="px-2 py-2 tabular-nums">
                {anyRecorded(field) ? total(field) : '—'}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
