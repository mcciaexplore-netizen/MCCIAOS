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
import { Avatar, EditableNumber, formatJiraDate } from '@/components/TrackerCells';
import { EmptyState, ErrorState } from '@/components/ui';
import { trackerApi } from '@/lib/workTrackerApi';
import { istToday, shiftDate } from '@/lib/ist';
import { CALLING_FIELDS } from '@/schemas/workTracker';
import type { CallingStatus } from '@/types';

/** The columns, in order. Width is fixed so the header is authoritative. */
const COLUMNS = [
  { key: 'statusDate', label: 'Date', width: 110 },
  { key: 'userName', label: 'Name', width: 180 },
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
  // Calls are handed out each morning, so the day being looked at is today
  // until somebody says otherwise. Past days are readable and still editable —
  // people finish yesterday's tally the next morning often enough that locking
  // it would just get worked around.
  const [day, setDay] = useState(istToday());
  const isToday = day === istToday();

  const query = useQuery({
    queryKey: ['calling-status', user, day],
    queryFn: () => trackerApi.callingStatus(user || undefined, day),
  });

  const save = useMutation({
    mutationFn: (v: { userId: string; field: Field; value: number | null }) =>
      trackerApi.setCallingField(v.userId, v.field, v.value, day),
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

  const people: CallingStatus[] = query.data?.people ?? [];

  const total = (field: Field) =>
    people.reduce((sum, p) => sum + (p[field] ?? 0), 0);
  // A column of all-blanks totals 0, which would read as a real figure. Only
  // show a total once somebody has actually put a number in.
  const anyRecorded = (field: Field) => people.some((p) => p[field] !== null);

  return (
    <>
      {/* The day being worked on. Calls are handed out each morning, so this
          opens on today and the table below is today's blank sheet; stepping
          back reads a past day exactly as it was left. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setDay(shiftDate(day, -1))}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          &larr; Previous day
        </button>
        <input
          type="date"
          value={day}
          max={istToday()}
          onChange={(e) => setDay(e.target.value || istToday())}
          aria-label="Day"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          disabled={isToday}
          onClick={() => setDay(shiftDate(day, 1))}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Next day &rarr;
        </button>
        {!isToday && (
          <button
            type="button"
            onClick={() => setDay(istToday())}
            className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            Back to today
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {isToday ? "Today's calls" : `Showing ${formatJiraDate(day)}`}
        </span>
      </div>

      {query.isLoading ? (
        <p className="p-4 text-sm text-slate-400">Loading calling status…</p>
      ) : query.isError ? (
        <div className="p-4">
          <ErrorState
            title="Could not load calling status"
            error={query.error as Error}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : people.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<PhoneCall className="h-10 w-10" />}
            title="No team members yet"
            description="Add people to the roster and their calling tallies appear here."
          />
        </div>
      ) : (
      <div className="overflow-x-auto">
      <table
        style={{ tableLayout: 'fixed', minWidth: 850 }}
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
              <td className="px-3 py-1.5 text-xs tabular-nums text-slate-400">
                {formatJiraDate(p.statusDate)}
              </td>
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
            <td />
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
      )}
    </>
  );
}
