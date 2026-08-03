// Typed client for /api/daily-logs, /api/daily-checkins and /api/users.
// Error handling is deliberately identical to ./api and ./eventsApi.

import type {
  CategoryCount,
  DailyCheckin,
  DailyLog,
  DailySummaryRow,
  DayStats,
  User,
} from '@/types';
import type {
  CarryForwardInput,
  CheckinInput,
  CompleteLogInput,
  DailyLogInput,
  DailyLogUpdateInput,
} from '@/schemas/dailyLogs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: JSON_HEADERS });
  const text = await res.text();

  let body: { error?: string } | null = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? 'Server returned an unreadable response'
          : `Request failed (${res.status})`,
      );
    }
  }

  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body ?? {}) as T;
}

export interface LogQuery {
  date?: string;
  from?: string;
  to?: string;
  user_id?: string;
  status?: string;
  category?: string;
}

function qs(params: object): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v) out.set(k, v);
  }
  return out.toString();
}

export const dailyApi = {
  /** The team roster. Backs every member dropdown and the "not reported" list. */
  users() {
    return request<{ users: User[] }>('/api/users');
  },

  /** Pulls in anyone added to the Settings roster since the last sync. */
  syncUsers() {
    return request<{ added: number; users: User[] }>('/api/users/sync', {
      method: 'POST',
    });
  },

  /** `stats` is present only when the query resolves to a single day. */
  logs(query: LogQuery) {
    return request<{ date: string | null; logs: DailyLog[]; stats: DayStats | null }>(
      `/api/daily-logs?${qs(query)}`,
    );
  },

  create(input: DailyLogInput) {
    return request<{ log: DailyLog }>('/api/daily-logs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, patch: DailyLogUpdateInput) {
    return request<{ log: DailyLog }>(`/api/daily-logs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  remove(id: string) {
    return request<{ success: boolean }>(`/api/daily-logs/${id}`, {
      method: 'DELETE',
    });
  },

  /** Mark done and record the output in one step. Rejected without an output. */
  complete(id: string, input: CompleteLogInput) {
    return request<{ log: DailyLog }>(`/api/daily-logs/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  carryForward(input: CarryForwardInput) {
    return request<{ created: number }>('/api/daily-logs/carry-forward', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  summary(from: string, to: string) {
    return request<{
      from: string;
      to: string;
      rows: DailySummaryRow[];
      categories: CategoryCount[];
    }>(`/api/daily-logs/summary?${qs({ from, to })}`);
  },

  checkins(date: string, userId?: string) {
    return request<{ checkins: DailyCheckin[] }>(
      `/api/daily-checkins?${qs({ date, user_id: userId })}`,
    );
  },

  saveCheckin(input: CheckinInput) {
    return request<{ checkin: DailyCheckin }>('/api/daily-checkins', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Downloads the range as CSV. Built server-side and streamed back, with the
   * filename taken from Content-Disposition so it matches what the server named.
   */
  async exportCsv(from: string, to: string): Promise<void> {
    const res = await fetch(`/api/daily-logs/export?${qs({ from, to })}`);
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
    a.download = named ?? `daily-log-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
