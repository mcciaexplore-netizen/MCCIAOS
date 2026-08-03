// Presentational pieces shared by the four Daily Work Log pages, so a status
// reads identically on the team view, my day, a person's history and the
// management table.

import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui';
import {
  LOG_CATEGORY_LABELS,
  LOG_PRIORITY_LABELS,
  LOG_STATUS_LABELS,
  LOG_STATUS_TONES,
} from '@/constants';
import { cn } from '@/lib/utils';
import type { LogCategory, LogPriority, LogStatus } from '@/types';

/**
 * CARRIED_FORWARD deliberately renders dimmer than the rest. It shares the
 * neutral tone with PLANNED, so without this a rolled-over row would compete
 * for attention with work actually planned for the day being viewed.
 */
export function StatusChip({ status }: { status: LogStatus }) {
  return (
    <Badge
      tone={LOG_STATUS_TONES[status]}
      className={cn(status === 'CARRIED_FORWARD' && 'opacity-60')}
    >
      {LOG_STATUS_LABELS[status]}
    </Badge>
  );
}

export const CategoryChip = ({ category }: { category: LogCategory }) => (
  <Badge tone="blue">{LOG_CATEGORY_LABELS[category]}</Badge>
);

/**
 * Only HIGH and LOW are shown. Medium is the default and the majority, so a
 * chip on every row would be noise that makes the exceptions harder to spot.
 */
export function PriorityChip({ priority }: { priority: LogPriority | null }) {
  if (!priority || priority === 'MEDIUM') return null;
  return (
    <Badge tone={priority === 'HIGH' ? 'rose' : 'gray'}>
      {LOG_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/** "1h 45m", "45m", or an em dash when nothing was recorded. */
export function formatMins(mins: number | null | undefined): string {
  if (mins == null || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A percentage, or an em dash when the denominator was zero. */
export const formatPct = (pct: number | null): string =>
  pct === null ? '—' : `${pct}%`;

/** Matches the Dashboard's StatCard so every summary strip reads as one app. */
export function StatTile({
  label,
  value,
  tone,
  icon,
  foot,
}: {
  label: string;
  value: string | number;
  tone: 'brand' | 'violet' | 'amber' | 'green' | 'rose' | 'gray';
  icon: ReactNode;
  foot?: string;
}) {
  const tones: Record<string, string> = {
    brand: 'text-brand-500 bg-brand-50 dark:bg-brand-950/40',
    violet: 'text-violet-500 bg-violet-50 dark:bg-violet-950/40',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40',
    green: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
    rose: 'text-rose-500 bg-rose-50 dark:bg-rose-950/40',
    gray: 'text-slate-400 bg-slate-100 dark:bg-slate-800',
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

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

/**
 * Prev / date / next, shared by the team and personal day views.
 *
 * "Today" is an Asia/Kolkata calendar day everywhere in this module — see
 * src/lib/ist.ts for why the server's own day is never used.
 */
export function DateStepper({
  date,
  onChange,
  onPrev,
  onNext,
  label,
}: {
  date: string;
  onChange: (next: string) => void;
  onPrev: () => void;
  onNext: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPrev}
        aria-label="Previous day"
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        ‹
      </button>
      <div className="relative">
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          aria-label="Date"
          className="w-[10rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
      <button
        onClick={onNext}
        aria-label="Next day"
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        ›
      </button>
      {label && (
        <span className="ml-1 text-sm font-medium text-slate-400">{label}</span>
      )}
    </div>
  );
}
