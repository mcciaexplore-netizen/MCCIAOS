/**
 * The Settings password gate, from the browser's side.
 *
 * No username, no accounts, no roles — one password, and knowing it opens
 * Settings. That is the whole model.
 *
 * There is deliberately almost nothing in this file. The password is compared
 * on the server and never reaches the bundle; what comes back is an HttpOnly
 * cookie the browser attaches by itself, so nothing here holds or forwards a
 * credential. This only asks the server what the state is and tells subscribers
 * when it changes.
 */

export interface GateState {
  /** Whether this browser has entered the password. */
  open: boolean;
  /** When the session lapses, epoch ms. */
  expiresAt: number | null;
  /** False until the server has answered. Before that, `open: false` means "not known yet". */
  resolved: boolean;
}

const CLOSED: GateState = { open: false, expiresAt: null, resolved: false };

let current: GateState = CLOSED;
const listeners = new Set<() => void>();

function announce() {
  for (const l of listeners) l();
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    // Same-origin sends the cookie by default. Stated rather than assumed,
    // because the gate silently stops working if that ever changes.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export async function refresh(): Promise<GateState> {
  try {
    const res = await call('/api/admin/session');
    const body = (await res.json()) as { authenticated?: boolean; expiresAt?: number | null };
    current = {
      open: Boolean(body.authenticated),
      expiresAt: body.expiresAt ?? null,
      resolved: true,
    };
  } catch {
    // Offline, or the server is down. Treated as closed — failing open on a
    // gate is never the safe default.
    current = { ...CLOSED, resolved: true };
  }
  announce();
  return current;
}

export async function enter(password: string): Promise<GateState> {
  const res = await call('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || 'That password is not right');
  }
  return refresh();
}

export async function leave(): Promise<GateState> {
  await call('/api/admin/logout', { method: 'POST' }).catch(() => null);
  return refresh();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): GateState {
  return current;
}

/** Milliseconds until the session lapses, or null when there is none. */
export function msRemaining(now = Date.now()): number | null {
  if (!current.open || current.expiresAt === null) return null;
  return Math.max(0, current.expiresAt - now);
}
