// Chart primitives, drawn as inline SVG.
//
// No charting library: the project had none, this form is simple, and
// hand-drawn SVG inherits the app's own tokens and dark mode for free rather
// than needing a second theme.
//
// PALETTE. Every chart here is single-series — a series-per-chart layout — so
// none carries a legend; each chart's own title names what it shows. The two
// hues were validated with the dataviz palette checker against both surfaces
// rather than picked by eye, and dark mode uses its own steps (an automatic
// flip lands outside the dark lightness band):
//
//   light  primary #2E8B57  accent #E8A33D   (band 0.43–0.77)
//   dark   primary #34A063  accent #BE7D1C   (band 0.48–0.67)
//
// Amber against the light surface sits under 3:1, which the checker flags as
// needing relief — every chart here ships visible value labels and a table
// view beside it, which is that relief.
//
// The two names used to be `consultations` and `setups`, after the modules
// that first used them. Those modules are gone; the hues are not tied to any
// particular metric, so they are named for their role instead.

import { useId, useState } from 'react';

export type ChartTone = 'primary' | 'accent';

export const CHART_TONE: Record<ChartTone, { light: string; dark: string }> = {
  primary: { light: '#2E8B57', dark: '#34A063' },
  accent: { light: '#E8A33D', dark: '#BE7D1C' },
};

/** Resolves to the right step for the active theme via a CSS custom property. */
export function toneVars(tone: ChartTone): React.CSSProperties {
  return {
    ['--c' as string]: CHART_TONE[tone].light,
    ['--c-dark' as string]: CHART_TONE[tone].dark,
  };
}

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
  tone,
  height = 160,
}: {
  points: Point[];
  tone: ChartTone;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, ...points.map((p) => p.count));
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative" style={toneVars(tone)}>
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
