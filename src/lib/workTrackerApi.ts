// Typed client for the Work Tracker API.
// Error handling is deliberately identical to ./api and ./eventsApi.

import type { OrgSettings } from '@/schemas/orgSettings';
import type {
  AtRiskTask,
  Consultation,
  Task,
  TaskActivity,
  TaskTabCounts,
  TodayCounts,
  User,
} from '@/types';
import type {
  ConsultationInput,
  ConsultationUpdateInput,
  TaskInput,
  TaskUpdateInput,
  UserInput,
  UserUpdateInput,
} from '@/schemas/workTracker';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * `authorised` no longer adds anything to the request.
 *
 * The admin session is an HttpOnly cookie the browser attaches to same-origin
 * requests by itself, so there is nothing for this layer to carry. It used to
 * read the password out of sessionStorage and set a header, which meant any
 * script running in the page could take it.
 *
 * The flag is kept because it documents which calls need an admin — and the
 * server refuses them without one regardless of what this file does.
 */
async function request<T>(
  url: string,
  init?: RequestInit & { authorised?: boolean },
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: JSON_HEADERS,
  });
  const text = await res.text();

  let body: { error?: string; fieldErrors?: Record<string, string[]> } | null = null;
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
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
      fieldErrors?: Record<string, string[]>;
    };
    err.status = res.status;
    // Carried through so a form can put each message under its own input
    // rather than showing one toast that does not say which field is wrong.
    err.fieldErrors = (body as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
    throw err;
  }
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

  /** The organisation profile. Reading is open; saving needs an admin session. */
  orgSettings() {
    return request<{ settings: OrgSettings }>('/api/settings/org');
  },

  saveOrgSettings(patch: Partial<OrgSettings>) {
    return request<{ settings: OrgSettings }>('/api/settings/org', {
      method: 'PUT',
      body: JSON.stringify(patch),
      authorised: true,
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
      authorised: true,
    });
  },

  remove(id: string) {
    return request<{ success: boolean }>(`/api/tasks/${id}`, {
      method: 'DELETE',
      authorised: true,
    });
  },

  /**
   * Writes today's work to the Google Sheet now, rather than waiting for the
   * 18:00 run. `force` rewrites a day that has already been written, which is
   * what you want after correcting a task late in the day.
   */
  runDailyExport(force = false) {
    return request<{
      day: string;
      written: number;
      skipped: number;
      people: { name: string; tab: string; tasks: number; created: boolean; skipped?: string }[];
    }>(`/api/export/daily${force ? '?force=true' : ''}`, {
      method: 'POST',
      authorised: true,
    });
  },

  // ---- Consultations -------------------------------------------------------
  // None of these send the passcode. Consultations are not frozen: they are
  // running tallies the person who took them updates through the day.

  consultations(user?: string) {
    return request<{ consultations: Consultation[] }>(
      `/api/consultations?${qs({ user })}`,
    );
  },

  createConsultation(input: ConsultationInput) {
    return request<{ consultation: Consultation }>('/api/consultations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateConsultation(id: string, patch: ConsultationUpdateInput) {
    return request<{ consultation: Consultation }>(`/api/consultations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  removeConsultation(id: string) {
    return request<{ success: boolean }>(`/api/consultations/${id}`, {
      method: 'DELETE',
    });
  },

  restoreConsultation(id: string) {
    return request<{ consultation: Consultation }>(
      `/api/consultations/${id}/restore`,
      { method: 'POST' },
    );
  },

  /** Replaces who is on a task alongside its owner. Send the whole set. */
  setMembers(id: string, members: string[], actor?: string) {
    return request<{ task: Task }>(`/api/tasks/${id}/members?${qs({ actor })}`, {
      method: 'PUT',
      body: JSON.stringify({ members }),
      authorised: true,
    });
  },

  /** Work more than one person is on. */
  sharedWork(user?: string) {
    return request<{
      shared: {
        id: string;
        title: string;
        ownerName: string;
        people: { name: string; colour: string | null }[];
      }[];
    }>(`/api/shared-work?${qs({ user })}`);
  },

  /** Live task count per person, for the Settings roster. */
  taskCounts() {
    return request<{ counts: Record<string, number> }>('/api/task-counts');
  },

  /**
   * Clears everything one person is carrying. Hides rather than destroys, like
   * removing a single task, so a bulk clear made in error is recoverable —
   * which matters more here, not less, because the mistake is larger.
   */
  clearTasksFor(userId: string, actor?: string) {
    return request<{ removed: number }>(
      `/api/tasks?${qs({ user: userId, actor })}`,
      { method: 'DELETE', authorised: true },
    );
  },

  /** Undo for the bulk clear: puts back what it removed. */
  restoreTasksFor(userId: string, since: string, actor?: string) {
    return request<{ restored: number }>(`/api/tasks/restore-bulk?${qs({ actor })}`, {
      method: 'POST',
      body: JSON.stringify({ user: userId, since }),
      authorised: true,
    });
  },

  /**
   * Puts back a task that was removed. Removal hides the row rather than
   * destroying it, so this is a real undo rather than a re-creation.
   */
  restore(id: string, actor?: string) {
    return request<{ task: Task }>(`/api/tasks/${id}/restore?${qs({ actor })}`, {
      method: 'POST',
      authorised: true,
    });
  },

  /** Approval is an action, not a status. Approver-only, completed work only. */
  approve(id: string, actor?: string) {
    return request<{ task: Task }>(`/api/tasks/${id}/approve?${qs({ actor })}`, {
      method: 'POST',
    });
  },
};
