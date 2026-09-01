// Typed client for the Work Tracker API.
// Error handling is deliberately identical to ./api and ./eventsApi.

import type {
  SharedTask,
  Task,
  TaskActivity,
  TaskTabCounts,
  TodayCounts,
  User,
} from '@/types';
import type {
  CollaboratorInput,
  CollaboratorUpdateInput,
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

export type TabKey = 'all' | 'assigned_to_me' | 'due_soon' | 'overdue' | 'completed';

export interface TaskQuery {
  assignee?: string;
  status?: string;
  priority?: string;
  tab?: TabKey;
  overdue?: string;
}

function qs(params: object): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v) out.set(k, v);
  }
  return out.toString();
}

export const trackerApi = {
  users(includeInactive = false) {
    return request<{ users: User[] }>(
      `/api/users${includeInactive ? '?includeInactive=true' : ''}`,
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

  removeUser(id: string) {
    return request<{ success: boolean }>(`/api/users/${id}`, { method: 'DELETE' });
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
  summary(assignee?: string) {
    return request<TaskTabCounts>(`/api/summary?${qs({ assignee })}`);
  },

  today(assignee?: string) {
    return request<TodayCounts>(`/api/today?${qs({ assignee })}`);
  },

  shared(assignee?: string) {
    return request<{ tasks: SharedTask[] }>(`/api/shared?${qs({ assignee })}`);
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

  addCollaborator(taskId: string, input: CollaboratorInput, actor?: string) {
    return request<{ task: Task }>(
      `/api/tasks/${taskId}/collaborators?${qs({ actor })}`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  updateCollaborator(
    taskId: string,
    userId: string,
    patch: CollaboratorUpdateInput,
    actor?: string,
  ) {
    return request<{ task: Task }>(
      `/api/tasks/${taskId}/collaborators/${userId}?${qs({ actor })}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },

  removeCollaborator(taskId: string, userId: string, actor?: string) {
    return request<{ task: Task }>(
      `/api/tasks/${taskId}/collaborators/${userId}?${qs({ actor })}`,
      { method: 'DELETE' },
    );
  },
};
