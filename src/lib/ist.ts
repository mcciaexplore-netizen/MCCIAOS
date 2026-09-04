// Calendar-day helpers pinned to Asia/Kolkata.
//
// The team works in IST but the server runs in UTC, so `new Date()` rolls over
// to the next day at 05:30 IST. Every "today" in the Daily Work Log — the API's
// default log_date, the date picker's initial value, "carry to tomorrow" — has
// to be an IST calendar day or people lose the last five and a half hours of
// their evening to the following day's log.
//
// Uses Intl, which is built in; no date library is added. Server-side SQL uses
// `(now() at time zone 'Asia/Kolkata')::date`, which is the same instant
// resolved the same way.
//
// Imported by server code as `../src/lib/ist.js`, so it must stay free of any
// browser-only API.

export const IST = 'Asia/Kolkata';

const istParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The IST calendar day of `at`, as YYYY-MM-DD. */
export function istDate(at: Date = new Date()): string {
  // Built from parts rather than trusting a locale's format string, so the
  // result is YYYY-MM-DD no matter how en-CA is implemented.
  const parts = istParts.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today in IST, as YYYY-MM-DD. */
export const istToday = (): string => istDate();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE_RE.test(value);

/**
 * Moves a YYYY-MM-DD date by whole days.
 *
 * Done in UTC on a bare date so it is pure calendar arithmetic — no timezone or
 * DST can shift the result, and IST has no DST regardless.
 */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

/** "Today", "Yesterday", "Tomorrow", or a formatted date — relative to IST. */
export function describeDate(iso: string): string {
  const delta = daysBetween(istToday(), iso);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  return '';
}

/**
 * A timestamp as the team reads it: IST, day first, 12-hour.
 *
 * Pinned to IST rather than left to the viewer's zone, which is what
 * `toLocaleString('en-IN')` did here before — the same activity row read
 * differently depending on where it was opened.
 */
export function formatIstDateTime(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * A stored "HH:MM" or "HH:MM:SS" as a 12-hour clock: "14:30" reads "2:30 pm".
 *
 * Storage and transport stay 24-hour on purpose. `<input type="time">` accepts
 * and emits "HH:MM" in 24-hour form no matter how the browser draws its picker,
 * so a 12-hour value in the database would break every time field in the app.
 * The clock is a display concern and is converted here, at the edge.
 *
 * Anything unparseable is handed back untouched rather than blanked — a
 * surprising stored value should still be visible to whoever has to fix it.
 */
export function formatClock12(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!m) return value;
  const hour = Number(m[1]);
  if (hour > 23) return value;
  const suffix = hour < 12 ? 'am' : 'pm';
  // 0 and 12 both show as 12: midnight is 12 am, noon is 12 pm.
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[2]}${m[3] ? `:${m[3]}` : ''} ${suffix}`;
}
