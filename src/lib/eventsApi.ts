// Typed client for /api/events and /api/participants.
//
// Separate from ./api because that module speaks the generic records protocol
// (sheet + JSONB data) and this module's endpoints are resource routes over
// dedicated tables. The error handling is deliberately identical.

import type {
  EventParticipant,
  EventRecord,
  EventSummary,
  EventType,
} from '@/types';
import type {
  EventInput,
  EventUpdateInput,
  ParticipantInput,
  ParticipantUpdateInput,
} from '@/schemas/events';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: JSON_HEADERS });
  const text = await res.text();

  // Same guard as ./api: a crashed function or gateway timeout answers with
  // HTML, and parsing that unguarded hides the real status behind a JSON error.
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

/** Every filter the list page can apply. Empty values are left off the query. */
export interface EventListFilters {
  type?: EventType | '';
  mode?: string;
  status?: string;
  topic?: string;
  from?: string;
  to?: string;
  search?: string;
  sort?: 'date' | 'code';
  dir?: 'asc' | 'desc';
}

export function eventListQs(f: EventListFilters): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) {
    if (value) qs.set(key, String(value));
  }
  return qs;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export const eventsApi = {
  list(filters: EventListFilters) {
    return request<{ events: EventRecord[]; summary: EventSummary }>(
      `/api/events?${eventListQs(filters)}`,
    );
  },

  get(id: string) {
    return request<{ event: EventRecord; participants: EventParticipant[] }>(
      `/api/events/${id}`,
    );
  },

  /** The code a new event of this type would be given, for the form preview. */
  nextCode(type: EventType) {
    return request<{ code: string }>(`/api/events/next-code?type=${type}`);
  },

  create(input: EventInput) {
    return request<{ event: EventRecord }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, patch: EventUpdateInput) {
    return request<{ event: EventRecord }>(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  remove(id: string) {
    return request<{ success: boolean }>(`/api/events/${id}`, { method: 'DELETE' });
  },

  participants(eventId: string) {
    return request<{ participants: EventParticipant[] }>(
      `/api/events/${eventId}/participants`,
    );
  },

  addParticipant(eventId: string, input: ParticipantInput) {
    return request<{ participant: EventParticipant }>(
      `/api/events/${eventId}/participants`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },

  updateParticipant(id: string, patch: ParticipantUpdateInput) {
    return request<{ participant: EventParticipant }>(`/api/participants/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  removeParticipant(id: string) {
    return request<{ success: boolean }>(`/api/participants/${id}`, {
      method: 'DELETE',
    });
  },

  /** Sets attendance for everyone on the event at once. */
  setAllAttendance(eventId: string, attended: boolean) {
    return request<{ updated: number }>(
      `/api/events/${eventId}/participants/attendance`,
      { method: 'POST', body: JSON.stringify({ attended }) },
    );
  },

  /**
   * Uploads the raw text of a CSV. Parsing happens server-side so the column
   * aliases and the validation live in exactly one place.
   */
  importParticipants(eventId: string, csv: string) {
    return request<ImportResult>(`/api/events/${eventId}/participants/import`, {
      method: 'POST',
      body: JSON.stringify({ csv }),
    });
  },

  /**
   * Downloads the participant list. The file is built server-side and the
   * filename comes from Content-Disposition, so it always matches the event
   * code the server knows about.
   */
  async exportParticipants(eventId: string, fallbackName: string): Promise<void> {
    const res = await fetch(`/api/events/${eventId}/participants/export`);
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
    a.download = named ?? `${fallbackName}-participants.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
