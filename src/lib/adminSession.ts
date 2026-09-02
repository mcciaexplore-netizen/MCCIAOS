/**
 * The admin session, from the browser's side.
 *
 * There is deliberately almost nothing here. The session lives in an HttpOnly
 * cookie the browser attaches to same-origin requests by itself, so this file
 * never holds, reads or forwards a credential — it only asks the server what
 * the state is and tells subscribers when that answer changes.
 *
 * This replaces the previous scheme, which kept the password in sessionStorage
 * and echoed it on every write. Anything that could run a script in the page
 * could read it there; nothing in the page can read the cookie.
 */

export interface AdminSession {
  authenticated: boolean;
  expiresAt: number | null;
  /** Distinguishes "your session ran out" from "you never signed in". */
  reason?: 'absent' | 'malformed' | 'expired' | 'bad-signature' | 'not-configured';
  /** False when the server has no password set — a different problem entirely. */
  configured: boolean;
  /**
   * A complaint about the configured password — never the password itself.
   * Shown on the sign-in screen because a warning that only reaches the server
   * log is one nobody reads.
   */
  warning?: { level: 'severe' | 'weak'; message: string };
  /**
   * Whether the server has answered yet. Before it has, `authenticated: false`
   * means "not known", not "signed out" — and rendering a denial on that would
   * flash one at the very person entitled to be there.
   */
  resolved: boolean;
}

const UNKNOWN: AdminSession = {
  authenticated: false,
  expiresAt: null,
  configured: true,
  resolved: false,
};

let current: AdminSession = UNKNOWN;
const listeners = new Set<() => void>();

function announce() {
  for (const l of listeners) l();
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    // Same-origin sends cookies by default; stated rather than assumed, because
    // the whole mechanism silently stops working if it is ever not the case.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export async function refreshSession(): Promise<AdminSession> {
  try {
    const res = await request('/api/admin/session');
    const body = (await res.json()) as AdminSession;
    current = {
      authenticated: Boolean(body.authenticated),
      expiresAt: body.expiresAt ?? null,
      reason: body.reason,
      configured: body.configured !== false,
      warning: body.warning,
      resolved: true,
    };
  } catch {
    // Offline or the server is down. Treated as signed out: failing open on a
    // permission check is never the safe default.
    current = { ...UNKNOWN, reason: 'absent', resolved: true };
  }
  announce();
  return current;
}

export async function login(password: string): Promise<AdminSession> {
  const res = await request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || 'Could not sign in');
  }
  return refreshSession();
}

export async function logout(): Promise<AdminSession> {
  await request('/api/admin/logout', { method: 'POST' }).catch(() => null);
  return refreshSession();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): AdminSession {
  return current;
}

/**
 * Milliseconds until the session lapses, or null when there is none.
 * Used to sign out on time rather than on the next failed write.
 */
export function msRemaining(now = Date.now()): number | null {
  if (!current.authenticated || current.expiresAt === null) return null;
  return Math.max(0, current.expiresAt - now);
}
