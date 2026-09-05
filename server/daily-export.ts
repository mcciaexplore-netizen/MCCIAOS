/**
 * The 18:00 IST export: everybody's work, written to their own tab.
 *
 * One tab per person, matched by name against the tabs already in the sheet and
 * created if absent. Each run appends a dated block, so the tab becomes a
 * history rather than a snapshot that overwrites yesterday.
 *
 * RUN TWICE, WRITTEN ONCE. Before writing a person's block the last date in
 * their tab is read; if today is already there, they are skipped. A cron that
 * fires twice, or somebody pressing "Run now" after the scheduled run, must not
 * double the record. Pass `force` to write anyway, which is what you want after
 * correcting a task late in the day.
 */
import { listChangesThrough, listTasks, listUsers } from './work-tracker.js';
import { listCallingStatus } from './calling-status.js';
import { LOG_HEADER, LOG_ID_COLUMN, LOG_TAB, LOG_TIME_COLUMN, logRow } from './change-log.js';
import { openSheet, sheetsConfig, SheetsError } from './google-sheets.js';
import { istDate } from '../src/lib/ist.js';
import type { Task } from '../src/types/index.js';

/** The columns written to each person's tab, in order. */
const HEADER = [
  'Date',
  'Title',
  'Priority',
  'Status',
  'Allocation',
  'Deadline',
  'Percentage',
  'Due days',
  'Reports to',
  'Approver',
  'Late',
] as const;

function row(day: string, t: Task): (string | number | null)[] {
  return [
    day,
    t.title,
    t.priority,
    t.status,
    t.allocationDate ?? '',
    t.deadlineDate ?? '',
    // Empty rather than 0: a task nobody has put a figure on should keep
    // saying nothing once it reaches the sheet.
    t.percentage ?? '',
    // Blank rather than 0 for work that is on time, so a column of numbers is
    // a list of problems rather than a wall of zeroes to read past.
    t.dueDays > 0 ? t.dueDays : '',
    t.reportToName ?? '',
    t.approverName ?? '',
    t.isOverdue ? 'LATE' : '',
  ];
}

/** The workbook handle `openSheet` hands back. `Sheet` is one tab's properties. */
type Workbook = Awaited<ReturnType<typeof openSheet>>;

async function writeChangeLog(
  sheet: Workbook,
  day: string,
): Promise<{ changes: number; skipped?: string }> {
  // Read through today, not only today: if an export was missed, its audit
  // rows are backfilled the next time instead of disappearing from Sheets.
  const changes = await listChangesThrough(day);
  if (changes.length === 0) return { changes: 0, skipped: 'nothing changed' };

  let tab = sheet.find(LOG_TAB);
  let created = false;
  if (!tab) {
    tab = await sheet.createTab(LOG_TAB);
    created = true;
    // Column B holds the time. Pin it before the first write, so the tab never
    // exists in a state where the clock depends on the spreadsheet's locale.
    await sheet.setTimeFormat(tab, LOG_TIME_COLUMN);
  }

  // Unlike the nightly snapshots, this tab is an incremental audit stream.
  // Stable database ids make a rerun safe while still allowing changes made
  // after an earlier same-day run to be appended on the next one.
  const writtenIds = created
    ? new Set<string>()
    : new Set(await sheet.columnValues(tab, LOG_ID_COLUMN));
  const pending = changes.filter((change) => !writtenIds.has(change.id));
  if (pending.length === 0) return { changes: 0, skipped: 'up to date' };

  const rows: (string | number | null)[][] = [];
  if (created || (await sheet.firstRow(tab)).length === 0) rows.push([...LOG_HEADER]);
  for (const c of pending) rows.push(logRow(c));
  await sheet.append(tab, rows);
  return { changes: pending.length };
}

/**
 * The calling tab: one row per person per day, appended as each day is written.
 *
 * A shared tab rather than one per person, because calling is read across the
 * team — who was given what, and how it went — in a way an individual's task
 * list is not.
 *
 * Somebody with nothing recorded is skipped. A row of four blanks says only
 * that a person exists, which the roster already says, and a tab of them buries
 * the days that do carry figures.
 */
const CALLING_TAB = 'Calling Status';

const CALLING_HEADER = [
  'Date',
  'Name',
  'Calls Allocated',
  'Calls Picked',
  'Consultation Scheduled',
  'Not Picked',
] as const;

async function writeCallingStatus(
  sheet: Workbook,
  day: string,
): Promise<{ rows: number; skipped?: string }> {
  const people = (await listCallingStatus(null, day)).filter(
    (p) =>
      p.callsAllocated !== null ||
      p.callsPicked !== null ||
      p.consultationScheduled !== null ||
      p.notPicked !== null,
  );
  if (people.length === 0) return { rows: 0, skipped: 'nothing recorded' };

  let tab = sheet.find(CALLING_TAB);
  let created = false;
  if (!tab) {
    tab = await sheet.createTab(CALLING_TAB);
    created = true;
  }
  // Written once per day, like the per-person tabs: the figures are a day's
  // final state, not a stream of edits, so re-running must not append a second
  // copy of the same day.
  if (!created && (await sheet.lastDate(tab)) === day) {
    return { rows: people.length, skipped: 'already written today' };
  }

  const rows: (string | number | null)[][] = [];
  if (created || (await sheet.firstRow(tab)).length === 0) rows.push([...CALLING_HEADER]);
  for (const p of people) {
    rows.push([
      day,
      p.userName,
      // Blank rather than 0 for a figure nobody entered, matching the app: a
      // person given no calls and a person who picked none up are different.
      p.callsAllocated ?? '',
      p.callsPicked ?? '',
      p.consultationScheduled ?? '',
      p.notPicked ?? '',
    ]);
  }
  await sheet.append(tab, rows);
  return { rows: people.length };
}

export interface ExportOutcome {
  day: string;
  spreadsheetId: string;
  people: { name: string; tab: string; tasks: number; created: boolean; skipped?: string }[];
  written: number;
  skipped: number;
  log: { changes: number; skipped?: string };
  calling: { rows: number; skipped?: string };
}

export async function runDailyExport(
  { now = new Date(), force = false }: { now?: Date; force?: boolean } = {},
): Promise<ExportOutcome> {
  const cfg = sheetsConfig();
  if (!cfg) {
    throw new SheetsError(
      'Sheets export is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and SHEETS_SPREADSHEET_ID.',
      501,
    );
  }

  const day = istDate(now);
  const sheet = await openSheet(cfg);
  const people = await listUsers(true);

  const outcome: ExportOutcome = {
    day,
    spreadsheetId: cfg.spreadsheetId,
    people: [],
    written: 0,
    skipped: 0,
    log: { changes: 0 },
    calling: { rows: 0 },
  };

  for (const person of people) {
    const tasks = await listTasks({ user: person.id, tab: 'all' });

    // Somebody with nothing on is not written at all. A tab full of empty dated
    // rows is worse than a tab that simply has no entry for a quiet day.
    if (tasks.length === 0) {
      outcome.people.push({ name: person.name, tab: '—', tasks: 0, created: false, skipped: 'no work' });
      outcome.skipped++;
      continue;
    }

    let tab = sheet.find(person.name);
    let created = false;
    if (!tab) {
      tab = await sheet.createTab(person.name);
      created = true;
    }

    // Already written today? Then leave it alone, unless told otherwise.
    if (!created && !force && (await sheet.lastDate(tab)) === day) {
      outcome.people.push({
        name: person.name,
        tab,
        tasks: tasks.length,
        created: false,
        skipped: 'already written today',
      });
      outcome.skipped++;
      continue;
    }

    // Header once per tab, and only if the tab does not already start with one.
    const first = created ? [] : await sheet.firstRow(tab);
    const rows: (string | number | null)[][] = [];
    if (first.length === 0) rows.push([...HEADER]);
    for (const t of tasks) rows.push(row(day, t));

    await sheet.append(tab, rows);
    outcome.people.push({ name: person.name, tab, tasks: tasks.length, created });
    outcome.written += tasks.length;
  }

  // After the per-person tabs, so a failure here still leaves everybody's work
  // recorded rather than losing the whole run to the log.
  outcome.calling = await writeCallingStatus(sheet, day);
  outcome.log = await writeChangeLog(sheet, day);

  return outcome;
}
