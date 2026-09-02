/**
 * The edit lock for recorded work.
 *
 * NOT A PERMISSION CHECK. The password that used to sit in front of this was
 * removed by request, so this is now purely a guard against accidents — a
 * switch that stops a stray click changing a figure somebody recorded. Anyone
 * using the app can flip it, and the API no longer enforces anything.
 *
 * Kept because the underlying want is real: a filled cell should not be
 * editable by accident. What is gone is the claim that it could not be edited
 * by someone without authority — there is no authority any more.
 *
 * Per-browser, in localStorage rather than sessionStorage, because it is a
 * preference now rather than a session and should survive closing the tab.
 */

const KEY = 'mccia.edit.unlocked';

const listeners = new Set<() => void>();
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  try {
    cached = localStorage.getItem(KEY) === 'true';
  } catch {
    // Private mode or storage disabled. Locked is the safer default: it makes
    // a change take one extra deliberate action rather than none.
    cached = false;
  }
  return cached;
}

export function isUnlocked(): boolean {
  return read();
}

export function setUnlocked(next: boolean) {
  cached = next;
  try {
    if (next) localStorage.setItem(KEY, 'true');
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing persisted; the in-memory value still applies for this page */
  }
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): boolean {
  return read();
}
