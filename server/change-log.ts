/**
 * What a Change Log row is, shared by the two things that write one.
 *
 * The nightly export and the live append must produce byte-identical rows —
 * they write to the same tab, and the nightly run decides what is already
 * there by matching Entry IDs. If the two drifted apart in column order the
 * sheet would interleave two different shapes under one header.
 */
import type { ChangeRecord } from './work-tracker.js';

/**
 * The shared change-log tab: every edit anyone made that day, in one place.
 *
 * Separate from the per-person tabs because it answers a different question.
 * A person's tab says where their work stands tonight; this says what actually
 * moved today, and who moved it. Reviewing progress needs the second.
 */
export const LOG_TAB = 'Change Log';

/**
 * The tracker's own columns, in the tracker's order, so a row here reads the
 * same way the screen does — then what actually changed, then the entry id.
 *
 * The snapshot half is context and the What changed / From / To half is the
 * record. Reading only the left half tells you the state of a task; reading
 * across tells you why it moved.
 */
export const LOG_HEADER = [
  // Exactly the tracker table.
  'Name',
  'Title',
  'Priority',
  'Status',
  'Allocation',
  'Deadline',
  'Due',
  'Percentage',
  'Reports to',
  'Approver',
  // What happened to it.
  'Date',
  'Time',
  'Changed by',
  'What changed',
  'From',
  'To',
  'Entry ID',
] as const;

/** Index of the Time column, which has to be pinned to a 12-hour clock. */
export const LOG_TIME_COLUMN = LOG_HEADER.indexOf('Time');

/**
 * Spreadsheet letter of the Entry ID column, read back to find what is already
 * written. Derived rather than hardcoded: it was 'I', and adding the tracker's
 * ten columns in front of it moved it — a stale letter here would have read an
 * unrelated column, matched nothing, and appended the whole history again on
 * every single run.
 */
export const LOG_ID_COLUMN = String.fromCharCode(65 + LOG_HEADER.indexOf('Entry ID'));

/** One log row: the task as the tracker draws it, then the change itself. */
export function logRow(c: ChangeRecord): (string | number | null)[] {
  return [
    c.ownerName ?? '',
    c.title,
    c.priority ?? '',
    c.status ?? '',
    c.allocationDate ?? '',
    c.deadlineDate ?? '',
    // Blank when on time, matching the tracker's own blank rather than a 0.
    c.dueDays > 0 ? c.dueDays : '',
    c.percentage ?? '',
    c.reportToName ?? '',
    c.approverName ?? '',
    c.day,
    c.at,
    // Blank, not "Unknown": the actor is genuinely unrecorded on older rows
    // and inventing a name for a real edit would be worse than a gap.
    c.actorName ?? '',
    FIELD_LABELS[c.field] ?? c.field,
    c.oldValue ?? '',
    c.newValue ?? '',
    c.id,
  ];
}

/** Field keys are for code. A report gets the words people use. */
export const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  userId: 'Owner',
  priority: 'Priority',
  status: 'Status',
  allocationDate: 'Allocation date',
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
