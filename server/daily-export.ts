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
  'Due',
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
    t.dueDate ?? '',
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

/**
 * The shared change-log tab: every edit anyone made that day, in one place.
 *
 * Separate from the per-person tabs because it answers a different question.
 * A person's tab says where their work stands tonight; this says what actually
 * moved today, and who moved it. Reviewing progress needs the second.
 */
const LOG_TAB = 'Change Log';

const LOG_HEADER = [
  'Date',
  'Time',
  'Changed by',
  'Whose work',
  'Task',
  'What changed',
  'From',
  'To',
  'Entry ID',
] as const;

/** Field keys are for code. A report gets the words people use. */
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  userId: 'Owner',
  priority: 'Priority',
  status: 'Status',
  allocationDate: 'Allocation date',
  dueDate: 'Due date',
  deadlineDate: 'Deadline',
  percentage: 'Percentage',
  reportTo: 'Reports to',
  approverId: 'Approver',
  members: 'Team',
  created: 'Created',
  deleted: 'Removed',
  restored: 'Restored',
  approval: 'Approval',
};

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
  }

  // Unlike the nightly snapshots, this tab is an incremental audit stream.
  // Stable database ids make a rerun safe while still allowing changes made
  // after an earlier same-day run to be appended on the next one.
  const writtenIds = created ? new Set<string>() : new Set(await sheet.columnValues(tab, 'I'));
  const pending = changes.filter((change) => !writtenIds.has(change.id));
  if (pending.length === 0) return { changes: 0, skipped: 'up to date' };

  const rows: (string | number | null)[][] = [];
  if (created || (await sheet.firstRow(tab)).length === 0) rows.push([...LOG_HEADER]);
  for (const c of pending) {
    rows.push([
      c.day,
      c.at,
      // Blank, not "Unknown": the actor is genuinely unrecorded on older rows
      // and inventing a name for a real edit would be worse than a gap.
      c.actorName ?? '',
      c.ownerName ?? '',
      c.title,
      FIELD_LABELS[c.field] ?? c.field,
      c.oldValue ?? '',
      c.newValue ?? '',
      c.id,
    ]);
  }
  await sheet.append(tab, rows);
  return { changes: pending.length };
}

export interface ExportOutcome {
  day: string;
  spreadsheetId: string;
  people: { name: string; tab: string; tasks: number; created: boolean; skipped?: string }[];
  written: number;
  skipped: number;
  log: { changes: number; skipped?: string };
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
  outcome.log = await writeChangeLog(sheet, day);

  return outcome;
}
