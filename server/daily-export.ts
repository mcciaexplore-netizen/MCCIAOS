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
import { listTasks, listUsers } from './work-tracker.js';
import { openSheet, sheetsConfig, SheetsError } from './google-sheets.js';
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
  'Consults allocated',
  'Consults done',
  'Callings done',
  'Reports to',
  'Approver',
  'Late',
] as const;

/** IST calendar day, matching how the rest of the app decides what "today" is. */
export function istDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function row(day: string, t: Task): (string | number | null)[] {
  return [
    day,
    t.title,
    t.priority,
    t.status,
    t.allocationDate ?? '',
    t.dueDate ?? '',
    t.deadlineDate ?? '',
    // Empty rather than 0: a task that says nothing about consultations should
    // keep saying nothing once it reaches the sheet.
    t.percentage ?? '',
    t.consultationsAllocated ?? '',
    t.consultationsDone ?? '',
    t.callingsDone ?? '',
    t.reportToName ?? '',
    t.approverName ?? '',
    t.isOverdue ? 'LATE' : '',
  ];
}

export interface ExportOutcome {
  day: string;
  spreadsheetId: string;
  people: { name: string; tab: string; tasks: number; created: boolean; skipped?: string }[];
  written: number;
  skipped: number;
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

  return outcome;
}
