import { useEffect, useSyncExternalStore } from 'react';
import {
  msRemaining,
  refreshSession,
  snapshot,
  subscribe,
  type AdminSession,
} from '@/lib/adminSession';

/** Server-render / pre-hydration value. Nothing is known yet. */
const OFFLINE: AdminSession = {
  authenticated: false,
  expiresAt: null,
  configured: true,
  resolved: false,
};

/**
 * The admin session, and whether it is still being established.
 *
 * `checking` matters: on first paint nothing is known yet, and rendering
 * "Access denied" before the answer arrives would flash a denial at the very
 * person who is entitled to be there.
 *
 * The session also expires on its own schedule. A timer signs out exactly when
 * it lapses, so the page changes state on time instead of on the next failed
 * save — the difference between "your session ended" and "why did that not
 * work".
 */
export function useAdminSession(): AdminSession & { checking: boolean } {
  const session = useSyncExternalStore(subscribe, snapshot, () => OFFLINE);

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    const ms = msRemaining();
    if (ms === null) return;
    const t = setTimeout(() => void refreshSession(), ms + 1000);
    return () => clearTimeout(t);
  }, [session.expiresAt, session.authenticated]);

  return { ...session, checking: !session.resolved };
}
