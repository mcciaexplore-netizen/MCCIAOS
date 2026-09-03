/**
 * The Work Tracker's self-declared identity, shared by every task-editing view.
 * This improves audit attribution but is deliberately not authentication.
 */
const ACTOR_PREF_KEY = 'mccia.tracker.actor';

export function readTrackerActor(): string | undefined {
  try {
    return localStorage.getItem(ACTOR_PREF_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function writeTrackerActor(actor: string): void {
  try {
    localStorage.setItem(ACTOR_PREF_KEY, actor);
  } catch {
    /* private mode; the identity applies only while the tracker stays mounted */
  }
}
