import type { SheetName } from '@/types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: JSON_HEADERS });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  list<T>(sheet: SheetName): Promise<{ records: T[] }> {
    return request(`/api/records?sheet=${encodeURIComponent(sheet)}`);
  },
  create<T>(sheet: SheetName, data: unknown): Promise<{ record: T }> {
    return request('/api/records', {
      method: 'POST',
      body: JSON.stringify({ sheet, data }),
    });
  },
  patch<T>(id: string, data: unknown): Promise<{ record: T }> {
    return request(`/api/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    });
  },
  remove(id: string): Promise<{ success: boolean }> {
    return request(`/api/records/${id}`, { method: 'DELETE' });
  },
  bulk(sheet: SheetName, records: unknown[]): Promise<{ created: number; errors: unknown[] }> {
    return request('/api/bulk', {
      method: 'POST',
      body: JSON.stringify({ sheet, records }),
    });
  },
};
