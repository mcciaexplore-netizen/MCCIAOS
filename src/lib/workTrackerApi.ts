// Typed client for the Work Tracker API.
// Error handling is deliberately identical to ./api and ./eventsApi.

import type {
  AtRiskTask,
  Task,
  TaskActivity,
  TaskTabCounts,
  TodayCounts,
  User,
} from '@/types';
import type {
  TaskInput,
  TaskUpdateInput,
  UserInput,
  UserUpdateInput,
} from '@/schemas/workTracker';

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

export type TabKey = 'all' | 'assigned_to_me' | 'overdue';

export interface TaskQuery {
  user?: string;
  status?: string;
  priority?: string;
  tab?: TabKey;
  sort?: string;
  dir?: string;
}

function qs(params: object): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v) out.set(k, v);
  }
  return out.toString();
}

export const trackerApi = {
  /** Active people only by default; the dropdowns must not offer leavers. */
  users(activeOnly = true) {
    return request<{ users: User[] }>(
      `/api/users${activeOnly ? '' : '?active=false'}`,
    );
  },

  createUser(input: UserInput) {
    return request<{ user: User }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateUser(id: string, patch: UserUpdateInput) {
    return request<{ user: User }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  /** Deactivate, never delete: removing somebody orphans all their work. */
  deactivateUser(id: string) {
    return request<{ user: User }>(`/api/users/${id}/deactivate`, {
      method: 'PATCH',
    });
  },

  /**
   * Checks the Settings passcode. Verified server-side so the value is not in
   * the client bundle — but this gates the page only, never the data.
   */
  unlockSettings(passcode: string) {
    return request<{ ok: boolean }>('/api/settings/unlock', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
  },

  tasks(query: TaskQuery) {
    return request<{ tasks: Task[] }>(`/api/tasks?${qs(query)}`);
  },

  task(id: string) {
    return request<{ task: Task; activity: TaskActivity[] }>(`/api/tasks/${id}`);
  },

  /** Counts for all five tab badges in one request. */
  summary(user?: string) {
    return request<TaskTabCounts>(`/api/summary?${qs({ user })}`);
  },

  today(user?: string) {
    return request<TodayCounts>(`/api/today?${qs({ user })}`);
  },

  atRisk(user?: string) {
    return request<{ tasks: AtRiskTask[] }>(`/api/at-risk?${qs({ user })}`);
  },

  create(input: TaskInput, actor?: string) {
    return request<{ task: Task }>(`/api/tasks?${qs({ actor })}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Partial update — inline editing sends one field at a time. Returns the full
   * row so the client can reconcile server-set fields.
   */
  update(id: string, patch: TaskUpdateInput, actor?: string) {
    return request<{ task: Task }>(`/api/tasks/${id}?${qs({ actor })}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  remove(id: string) {
    return request<{ success: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });
  },

  /** Approval is an action, not a status. Approver-only, completed work only. */
  approve(id: string, actor?: string) {
    return request<{ task: Task }>(`/api/tasks/${id}/approve?${qs({ actor })}`, {
      method: 'POST',
    });
  },
};
