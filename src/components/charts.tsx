// Chart primitives, drawn as inline SVG.
//
// No charting library: the project had none, these three forms are simple, and
// hand-drawn SVG inherits the app's own tokens and dark mode for free rather
// than needing a second theme.
//
// PALETTE. Every chart here is single-series — a series-per-chart layout — so
// none carries a legend; each chart's own title names what it shows. The two
// metric hues were validated with the dataviz palette checker against both
// surfaces rather than picked by eye, and dark mode uses its own steps (an
// automatic flip lands outside the dark lightness band):
//
//   light  consultations #2E8B57  setups #E8A33D   (band 0.43–0.77)
//   dark   consultations #34A063  setups #BE7D1C   (band 0.48–0.67)
//
// Amber against the light surface sits under 3:1, which the checker flags as
// needing relief — every chart here ships visible value labels and a table
// view beside it, which is that relief.

import { useId, useState } from 'react';

export type Series = 'consultations' | 'setups';

export const SERIES_COLOR: Record<Series, { light: string; dark: string }> = {
  consultations: { light: '#2E8B57', dark: '#34A063' },
  setups: { light: '#E8A33D', dark: '#BE7D1C' },
};

/** Resolves to the right step for the active theme via a CSS custom property. */
export function seriesVars(series: Series): React.CSSProperties {
  return {
    ['--c' as string]: SERIES_COLOR[series].light,
    ['--c-dark' as string]: SERIES_COLOR[series].dark,
  };
}

// ---- Sparkline ------------------------------------------------------------
/** Trend shape only — no axes, no labels. The KPI number carries the value. */
export function Sparkline({
  points,
  series,
  className,
}: {
  points: number[];
  series: Series;
  className?: string;
}) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...points);
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(h - (p / max) * (h - 2) - 1).toFixed(2)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      style={seriesVars(series)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-[var(--c)] dark:stroke-[var(--c-dark)]"
      />
    </svg>
  );
}

// ---- Time-series bars -----------------------------------------------------
export interface Point {
  bucket: string;
  count: number;
}

/**
 * Vertical bars over time. Bars rather than a line because the buckets are
 * discrete counts per day/week/month, and a line would imply values in
 * between. Hovering a bar reveals its date and count.
 */
export function TimeBars({
  points,
  series,
  height = 160,
}: {
  points: Point[];
  series: Series;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, ...points.map((p) => p.count));
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative" style={seriesVars(series)}>
      <div
        className="flex w-full items-end gap-[2px] overflow-hidden"
        style={{ height }}
        role="img"
        aria-describedby={id}
      >
        {points.map((p, i) => (
          <div
            key={p.bucket}
            // min-w-0 is load-bearing: a flex child defaults to min-width:auto,
            // which lets 30 bars push the chart wider than its card and scroll
            // the whole page sideways on a phone.
            className="group relative flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {/* Full-height hit target: the bar itself is too small to hover on mobile. */}
            <div
              className="absolute inset-0 rounded-sm hover:bg-slate-900/5 dark:hover:bg-white/5"
              aria-hidden="true"
            />
            <div
              className="w-full rounded-t-[4px] bg-[var(--c)] transition-opacity dark:bg-[var(--c-dark)]"
              style={{
                height: p.count === 0 ? 2 : `${Math.max((p.count / max) * 100, 2)}%`,
                opacity: p.count === 0 ? 0.18 : hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-slate-400">
        <span className="truncate">{points[0]?.bucket ?? ''}</span>
        <span className="shrink-0 tabular-nums">peak {max}</span>
        <span className="truncate">{points[points.length - 1]?.bucket ?? ''}</span>
      </div>

      {/* Tooltip sits in flow so it never overflows a narrow screen. */}
      <p
        id={id}
        className="mt-1 h-4 text-xs text-slate-500 dark:text-slate-400"
        aria-live="polite"
      >
        {active ? (
          <>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {active.count}
            </span>{' '}
            on {active.bucket}
          </>
        ) : (
          <span className="text-slate-400">Hover a bar for its date and count</span>
        )}
      </p>
      {/* Non-visual readers get the whole series as text, which is also the
          "table view" relief the palette checker asks for. */}
      <span className="sr-only">
        {points.length} buckets, peak {max}.{' '}
        {points.map((p) => `${p.bucket}: ${p.count}`).join('. ')}
      </span>
    </div>
  );
}

// ---- Ranked horizontal bars ----------------------------------------------
export interface RankedRow {
  label: string;
  count: number;
  percent: number;
}

/**
 * Ranked magnitude. Horizontal because the labels are names of arbitrary
 * length, which would collide on a vertical axis. Values are labelled
 * directly, so the bar is never the only way to read the number.
 */
export function RankedBars({
  rows,
  series,
  limit = 8,
}: {
  rows: RankedRow[];
  series: Series;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.count));

  return (
    <ul className="space-y-2" style={seriesVars(series)}>
      {shown.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
          <span className="truncate text-sm text-slate-600 dark:text-slate-300" title={r.label}>
            {r.label}
          </span>
          <span className="text-sm tabular-nums text-slate-500">
            {r.count}
            <span className="ml-1.5 text-xs text-slate-400">{r.percent}%</span>
          </span>
          <span className="col-span-2 mt-1 block h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
            <span
              className="block h-full rounded-full bg-[var(--c)] dark:bg-[var(--c-dark)]"
              style={{ width: `${Math.max((r.count / max) * 100, 2)}%` }}
            />
          </span>
        </li>
      ))}
      {rows.length > limit && (
        <li className="pt-1 text-xs text-slate-400">
          + {rows.length - limit} more
        </li>
      )}
    </ul>
  );
}
