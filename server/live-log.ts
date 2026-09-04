/**
 * Appends every change to the sheet's Change Log as it happens, rather than
 * waiting for the 18:00 run.
 *
 * BEST EFFORT, ON PURPOSE. The append is not awaited by the request that
 * caused it, so saving a cell stays as fast as writing to Postgres and never
 * depends on Google being reachable. The costs of that are real and worth
 * stating:
 *
 *   - On a serverless host the function can be frozen once the response is
 *     sent, so an append in flight may simply not finish.
 *   - Google can rate-limit or fail.
 *
 * Neither loses anything. The nightly run reads the whole history and skips
 * what is already in the sheet by Entry ID, so anything dropped here is
 * written then. Live append is the fast path; the batch is the guarantee.
 *
 * The alternative — awaiting Google inside the save — would add most of a
 * second to every inline edit in the tracker, to buy a few hours of latency on
 * a row that the evening run would have written anyway.
 */
import { listChangesByIds, onActivityRecorded } from './work-tracker.js';
import { openSheet, sheetsConfig } from './google-sheets.js';
import { LOG_TAB, LOG_HEADER, LOG_ID_COLUMN, LOG_TIME_COLUMN, logRow } from './change-log.js';

/** Sheets is optional. With no credentials this does nothing and says nothing. */
function configured(): boolean {
  try {
    return sheetsConfig() !== null;
  } catch {
    // Half-configured. The daily export reports that properly; a background
    // append is the wrong place to raise it, and would raise it on every edit.
    return false;
  }
}

async function appendChanges(ids: string[]): Promise<void> {
  const cfg = sheetsConfig();
  if (!cfg) return;

  const changes = await listChangesByIds(ids);
  if (changes.length === 0) return;

  const sheet = await openSheet(cfg);
  let tab = sheet.find(LOG_TAB);
  const rows: (string | number | null)[][] = [];

  if (!tab) {
    tab = await sheet.createTab(LOG_TAB);
    await sheet.setTimeFormat(tab, LOG_TIME_COLUMN);
    rows.push([...LOG_HEADER]);
  } else if ((await sheet.firstRow(tab)).length === 0) {
    rows.push([...LOG_HEADER]);
  } else {
    // Guard against a double append: the same ids could arrive twice if a
    // retried request re-ran the mutation. Cheap next to the write itself.
    const written = new Set(await sheet.columnValues(tab, LOG_ID_COLUMN));
    if (changes.every((c) => written.has(c.id))) return;
  }

  for (const c of changes) rows.push(logRow(c));
  await sheet.append(tab, rows);
}

/**
 * Starts following changes. Safe to call more than once — the listener slot
 * holds one function, so a second call replaces the first rather than
 * doubling every append.
 */
export function startLiveLog(): void {
  if (!configured()) return;
  onActivityRecorded((ids) => {
    void appendChanges(ids).catch((err) => {
      // Deliberately only a log line. The database already holds the change and
      // tonight's run will put it in the sheet; failing the user's edit over a
      // Google outage would be far worse than a few hours of latency.
      // eslint-disable-next-line no-console
      console.warn('[live-log] could not append to the sheet:', (err as Error).message);
    });
  });
}
