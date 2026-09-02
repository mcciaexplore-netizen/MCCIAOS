import { useSyncExternalStore } from 'react';
import { snapshot, subscribe } from '@/lib/lock';

/**
 * Whether this tab currently holds the admin passcode.
 *
 * Every component that shows or hides an edit reads it from here, so unlocking
 * on the Settings page and unlocking from the Work Tracker toolbar are the same
 * act — the table stops being read-only the moment either one succeeds.
 */
export function useUnlocked(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
