// Typed client for /api/analytics/*. Mirrors the server types in
// server/analytics.ts; kept separate so the page never reaches into server code.

export type PeriodName = 'today' | 'week' | 'month' | 'custom';
export type Granularity = 'day' | 'week' | 'month';
export type MetricName = 'consultations' | 'setups';
export type Dimension = 'sector' | 'consultant' | 'status' | 'type' | 'source' | 'region';
export type ReportFormat = 'pdf' | 'xlsx' | 'csv';

export interface BreakdownRow {
  label: string;
  count: number;
  percent: number;
}

export interface MetricSummary {
  total: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  uniqueCompanies: number;
  newCompanies: number;
  repeatCompanies: number;
  statuses: BreakdownRow[];
}

export interface Summary {
  period: PeriodName;
  from: string;
  to: string;
  timezone: string;
  generatedAt: string;
  consultations: MetricSummary;
  setups: MetricSummary & {
    delivered: number;
    inProgress: number;
    avgDaysConsultationToSetup: number | null;
    linkableSetups: number;
  };
}

export interface CapacityRow {
  member: string;
  consultations: number;
  setups: number;
  messages: number;
  openConsultations: number;
  openSetups: number;
  overdueFollowups: number;
  dueSoonFollowups: number;
  load: number;
}

export interface ActivityRow {
  id: string;
  kind: 'consultation' | 'setup';
  company: string | null;
  date: string;
  consultant: string | null;
  status: string | null;
  title: string | null;
}

export interface PeriodQuery {
  period: PeriodName;
  from?: string;
  to?: string;
}

/** Shared query-string builder so every call agrees on the period parameters. */
export function periodQs(p: PeriodQuery, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ period: p.period, ...extra });
  if (p.period === 'custom') {
    if (p.from) qs.set('from', p.from);
    if (p.to) qs.set('to', p.to);
  }
  return qs;
}

async function get<T>(path: string, qs: URLSearchParams): Promise<T> {
  const res = await fetch(`${path}?${qs}`);
  const text = await res.text();
  let body: { error?: string } | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok ? 'Server returned an unreadable response' : `Request failed (${res.status})`,
      );
    }
  }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body ?? {}) as T;
}

export const analytics = {
  summary: (p: PeriodQuery) => get<Summary>('/api/analytics/summary', periodQs(p)),

  timeseries: (p: PeriodQuery, metric: MetricName, granularity: Granularity) =>
    get<{ points: { bucket: string; count: number }[] }>(
      '/api/analytics/timeseries',
      periodQs(p, { metric, granularity }),
    ),

  breakdown: (p: PeriodQuery, metric: MetricName, dimension: Dimension) =>
    get<{ rows: BreakdownRow[] }>(
      '/api/analytics/breakdown',
      periodQs(p, { metric, dimension }),
    ),

  capacity: (p: PeriodQuery) =>
    get<{ rows: CapacityRow[] }>('/api/analytics/capacity', periodQs(p)),

  activity: (p: PeriodQuery, limit: number, offset: number) =>
    get<{ rows: ActivityRow[]; total: number }>(
      '/api/analytics/activity',
      periodQs(p, { limit: String(limit), offset: String(offset) }),
    ),

  /**
   * Downloads a report. The file is generated server-side and streamed back,
   * so this reads the blob and hands it to the browser rather than building
   * anything client-side. The filename comes from Content-Disposition so it
   * always matches what the server named it.
   */
  async download(p: PeriodQuery, format: ReportFormat): Promise<void> {
    const res = await fetch(`/api/analytics/export?${periodQs(p, { format })}`);
    if (!res.ok) {
      let message = `Export failed (${res.status})`;
      try {
        message = (await res.json())?.error ?? message;
      } catch {
        /* non-JSON error body; keep the status message */
      }
      throw new Error(message);
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = named ?? `MCCIA-Analytics.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
