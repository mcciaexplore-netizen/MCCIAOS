import { useSyncExternalStore } from 'react';
import { setUnlocked, snapshot, subscribe } from '@/lib/editLock';

/**
 * Whether recorded work can be edited, and the switch to change it.
 *
 * An accident guard, not a permission check — see src/lib/editLock.ts.
 */
export function useEditLock(): { unlocked: boolean; setUnlocked: (v: boolean) => void } {
  const unlocked = useSyncExternalStore(subscribe, snapshot, () => false);
  return { unlocked, setUnlocked };
}
