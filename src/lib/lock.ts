/**
 * The admin lock, shared by the Settings page and the Work Tracker table.
 *
 * Recorded work is read-only once it has a value. Changing it — or deleting it
 * — needs the Settings passcode, so a figure somebody entered cannot be quietly
 * altered later by whoever happens to have the tab open.
 *
 * WHAT THIS IS AND IS NOT. The passcode is verified server-side (so it is not
 * in the JavaScript bundle) and every edit carries it, so the API refuses
 * changes without it rather than trusting the screen to have hidden the button.
 * That makes it a real gate against ordinary use. It is still not
 * authentication: this app has no login, everyone shares one passcode, and
 * anyone holding it — or reading this tab's session storage — can change
 * anything. It stops accidents and casual edits. It does not identify who made
 * a change, and it does not keep out anybody determined.
 *
 * Unlocking lasts for the life of the tab, not the device: a shared machine
 * should not stay unlocked after somebody walks away.
 */

const UNLOCK_KEY = 'mccia.settings.unlocked';
/**
 * Held so each edit can present it. It is the passcode the person just typed,
 * in their own tab, gone when the tab closes — the same secret they already
 * hold, not a new one minted for them.
 */
const PASSCODE_KEY = 'mccia.settings.passcode';

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. Treated as locked rather than as
    // unlocked: failing open on a permission check is never the safe default.
    return null;
  }
}

function announce() {
  for (const l of listeners) l();
}

export function isUnlocked(): boolean {
  return read(UNLOCK_KEY) === 'true';
}

/** The passcode to send with an edit, or null when locked. */
export function unlockPasscode(): string | null {
  return isUnlocked() ? read(PASSCODE_KEY) : null;
}

/** Call only after the server has confirmed the passcode. */
export function unlock(passcode: string) {
  try {
    sessionStorage.setItem(UNLOCK_KEY, 'true');
    sessionStorage.setItem(PASSCODE_KEY, passcode);
  } catch {
    /* private mode: the unlock will not survive a reload */
  }
  announce();
}

export function lock() {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
    sessionStorage.removeItem(PASSCODE_KEY);
  } catch {
    /* nothing was stored to begin with */
  }
  announce();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): boolean {
  return isUnlocked();
}
