// Small presentational pieces shared by the three Workshops & Events pages, so
// a workshop's badges look identical in the list, the detail header and the
// form preview.

import { Badge, Card } from '@/components/ui';
import {
  EVENT_MODE_LABELS,
  EVENT_MODE_TONES,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONES,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_TONES,
} from '@/constants';
import type { EventMode, EventStatus, EventType } from '@/types';
import type { ReactNode } from 'react';

export const TypeBadge = ({ type }: { type: EventType }) => (
  <Badge tone={EVENT_TYPE_TONES[type]}>{EVENT_TYPE_LABELS[type]}</Badge>
);

export const ModeBadge = ({ mode }: { mode: EventMode }) => (
  <Badge tone={EVENT_MODE_TONES[mode]}>{EVENT_MODE_LABELS[mode]}</Badge>
);

export const StatusBadge = ({ status }: { status: EventStatus }) => (
  <Badge tone={EVENT_STATUS_TONES[status]}>{EVENT_STATUS_LABELS[status]}</Badge>
);

/**
 * Attendance as text. Null means nobody was registered, which is different from
 * 0% — an em dash says "not applicable" where "0%" would read as a failure.
 */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

/** "09:30 – 12:00", "from 09:30", or empty when no times were recorded. */
export function formatTimeRange(
  start: string | null,
  end: string | null,
): string {
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return '';
}

/** Matches the Dashboard's StatCard so the summary row reads as the same app. */
export function StatTile({
  label,
  value,
  tone,
  icon,
  foot,
}: {
  label: string;
  value: string | number;
  tone: 'brand' | 'violet' | 'amber' | 'green';
  icon: ReactNode;
  foot?: string;
}) {
  const tones: Record<string, string> = {
    brand: 'text-brand-500 bg-brand-50 dark:bg-brand-950/40',
    violet: 'text-violet-500 bg-violet-50 dark:bg-violet-950/40',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40',
    green: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}
        >
          {icon}
        </div>
        <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {value}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-500">{label}</p>
      {foot && <p className="mt-0.5 text-xs text-slate-400">{foot}</p>}
    </Card>
  );
}

export function StatTileSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="h-7 w-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="mt-3 h-3 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
    </Card>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-4 w-14 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
