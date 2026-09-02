import { useEffect, useSyncExternalStore } from 'react';
import { msRemaining, refresh, snapshot, subscribe, type GateState } from '@/lib/settingsPassword';

const CLOSED: GateState = { open: false, expiresAt: null, resolved: false };

/**
 * Whether Settings is open for this browser, and whether that is known yet.
 *
 * `checking` matters: nothing is known on first paint, and rendering the
 * password prompt before the answer arrives would flash it at somebody who is
 * already through.
 *
 * A timer closes the gate exactly when the session lapses, so the page changes
 * on time rather than on the next click that mysteriously does nothing.
 */
export function useSettingsGate(): GateState & { checking: boolean } {
  const state = useSyncExternalStore(subscribe, snapshot, () => CLOSED);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const ms = msRemaining();
    if (ms === null) return;
    const t = setTimeout(() => void refresh(), ms + 1000);
    return () => clearTimeout(t);
  }, [state.expiresAt, state.open]);

  return { ...state, checking: !state.resolved };
}
