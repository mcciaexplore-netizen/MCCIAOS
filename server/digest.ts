/**
 * The daily digest: one email per member about their own day, and one
 * different email per admin — a roundup of the members' day, not the admin's
 * own (admins don't get a personal recap, and don't appear as a row in the
 * roundup either).
 *
 * Runs right after the 17:00 sheet export, from the same data that export just
 * gathered — no second trip to the Sheets API, only the Postgres reads the
 * export was already going to make.
 *
 * WHY A DIGEST. The sheet export can only write what somebody already entered.
 * Three quiet days in a row look identical to the export whether the team
 * simply had nothing to report or forgot to log anything at all. A personal
 * email that says "you haven't logged your calls today" turns that silence
 * into something a person actually sees.
 *
 * TWO DIFFERENT AUDIENCES, TWO DIFFERENT EMAILS. A `role = 'ADMIN'` user never
 * gets the personal recap — only the admin roundup, covering the whole team's
 * consultations, tasks and calling for the day. Everyone else gets only the
 * personal recap. Nobody gets both, and nobody gets neither.
 *
 * IDEMPOTENT PER DAY, not per run. See db/digest.sql: nothing here re-sends
 * once `digest_log` holds today's date, however many times the export runs.
 *
 * LAYOUT. Table-based cards throughout, not flexbox/grid — the one CSS
 * decision every email client actually agrees on. Colour comes from the same
 * palette the app itself uses (tailwind.config's `brand`, and the org's own
 * `#0B1F3A` header colour), so the email reads as the same product.
 */
import { requireSql } from './sql.js';
import { mailConfig, sendMail, type MailConfig } from './mailer.js';
import type { ChangeRecord } from './work-tracker.js';
import type { CallingStatus, Consultation, Task, User } from '../src/types/index.js';

async function alreadySentToday(day: string): Promise<boolean> {
  const db = requireSql();
  const rows = (await db.query(`select 1 from digest_log where day = $1::date`, [day])) as unknown[];
  return rows.length > 0;
}

async function markSent(day: string): Promise<void> {
  const db = requireSql();
  await db.query(
    `insert into digest_log (day) values ($1::date) on conflict (day) do nothing`,
    [day],
  );
}

// ---- Design tokens, matching tailwind.config's `brand` and the app's navy --

const NAVY = '#0B1F3A';
const BRAND = '#3366ff';
const BRAND_TINT = '#eef4ff';
const BRAND_DARK = '#1936e1';
const INK = '#1e293b';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const LINE = '#e2e8f0';
const PANEL = '#f8fafc';
const GOOD_BG = '#dcfce7';
const GOOD_FG = '#15803d';
const BAD_BG = '#fee2e2';
const BAD_FG = '#b91c1c';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page: a navy header band, a white card, a muted footer. One shell for both email kinds. */
function wrap(title: string, subtitle: string, body: string): string {
  return `<div style="background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid ${LINE};overflow:hidden">
      <div style="background:${NAVY};padding:20px 24px">
        <p style="margin:0;color:${BRAND_TINT};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">MCCIA OS</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;line-height:1.3">${esc(title)}</h1>
        <p style="margin:4px 0 0;color:#bcd3ff;font-size:13px">${esc(subtitle)}</p>
      </div>
      <div style="padding:20px 24px">${body}</div>
      <div style="padding:14px 24px;background:${PANEL};border-top:1px solid ${LINE}">
        <p style="margin:0;font-size:11px;color:${FAINT}">Automated daily digest from MCCIA OS. You're receiving this because you're on the active roster.</p>
      </div>
    </div>
  </div>`;
}

/** A titled box — the "card" every section lives in. */
function card(label: string, innerHtml: string): string {
  return `<div style="margin:0 0 16px;border:1px solid ${LINE};border-radius:12px;overflow:hidden">
    <div style="background:${PANEL};padding:9px 16px;border-bottom:1px solid ${LINE}">
      <span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${esc(label)}</span>
    </div>
    <div style="padding:14px 16px">${innerHtml}</div>
  </div>`;
}

const empty = (text: string): string => `<p style="margin:0;font-size:13px;color:${FAINT}">${esc(text)}</p>`;

/** A row of equal-width number tiles — table cells, so it survives Outlook too. */
function statTiles(items: { value: string | number; label: string; tone: 'good' | 'bad' | 'neutral' }[]): string {
  const palette = {
    good: [GOOD_BG, GOOD_FG],
    bad: [BAD_BG, BAD_FG],
    neutral: [BRAND_TINT, BRAND_DARK],
  } as const;
  const cells = items
    .map(({ value, label, tone }) => {
      const [bg, fg] = palette[tone];
      return `<td style="padding:3px;width:${Math.floor(100 / items.length)}%">
        <div style="background:${bg};border-radius:10px;padding:10px 6px;text-align:center">
          <div style="font-size:19px;font-weight:700;color:${fg};line-height:1.2">${esc(String(value))}</div>
          <div style="font-size:10.5px;color:${MUTED};margin-top:2px">${esc(label)}</div>
        </div>
      </td>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse"><tr>${cells}</tr></table>`;
}

const STATUS_TONE: Record<string, [string, string]> = {
  completed: [GOOD_BG, GOOD_FG],
  ongoing: [BRAND_TINT, BRAND_DARK],
  upcoming: ['#fef9c3', '#854d0e'],
  hold: ['#fef3c7', '#92400e'],
  stopped: [PANEL, MUTED],
};

function statusPill(status: string): string {
  const [bg, fg] = STATUS_TONE[status] ?? [PANEL, MUTED];
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;white-space:nowrap">${esc(status)}</span>`;
}

function taskTable(tasks: Task[]): string {
  if (tasks.length === 0) return empty('No open tasks on the board right now.');
  const rows = tasks
    .map(
      (t) => `<tr>
        <td style="padding:8px 6px;border-bottom:1px solid ${PANEL};font-size:13px;color:${INK}">${esc(t.title)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid ${PANEL}">${statusPill(t.status)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid ${PANEL};font-size:13px;text-align:center;color:${INK}">${t.percentage ?? '—'}</td>
        <td style="padding:8px 6px;border-bottom:1px solid ${PANEL};font-size:13px;text-align:right;color:${MUTED}">${esc(t.deadlineDate ?? '—')}</td>
      </tr>`,
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="text-align:left">
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT}">Task</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT}">Status</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT};text-align:center">%</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT};text-align:right">Deadline</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Personal digest (members) ----------------------------------------------

function filledPill(done: boolean): string {
  const [bg, fg] = done ? [GOOD_BG, GOOD_FG] : [BAD_BG, BAD_FG];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600">${done ? 'Filled in today' : 'Not filled in today'}</span>`;
}

function statusRow(label: string, done: boolean): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${INK}">${esc(label)}</td>
    <td style="padding:6px 0;text-align:right">${filledPill(done)}</td>
  </tr>`;
}

function personalDigestHtml(name: string, day: string, tasks: Task[], touchedTask: boolean, loggedCalling: boolean): string {
  const status = `<table style="width:100%;border-collapse:collapse">
    ${statusRow('Tasks updated', touchedTask)}
    ${statusRow('Calling numbers logged', loggedCalling)}
  </table>`;
  return wrap(
    `Your day`,
    `${name} — ${day}`,
    `${card("Today's data", status)}
     ${card('What you’re working on', taskTable(tasks))}`,
  );
}

// ---- Admin roundup: consultations + work + calling, per member -------------

function consultationList(rows: Consultation[]): string {
  if (rows.length === 0) return empty('No consultations logged today.');
  const items = rows
    .map(
      (c) => `<tr>
        <td style="padding:7px 6px;border-bottom:1px solid ${PANEL};font-size:13px;color:${INK}">${esc(c.title)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid ${PANEL};font-size:13px;color:${MUTED}">${esc(c.heldAt ?? '—')}</td>
        <td style="padding:7px 6px;border-bottom:1px solid ${PANEL};font-size:13px;text-align:center">${c.allocated ?? '—'}</td>
        <td style="padding:7px 6px;border-bottom:1px solid ${PANEL};font-size:13px;text-align:center">${c.completed ?? '—'}</td>
      </tr>`,
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="text-align:left">
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT}">Consultation</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT}">Time</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT};text-align:center">Alloc.</th>
      <th style="padding:0 6px 6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${FAINT};text-align:center">Done</th>
    </tr></thead>
    <tbody>${items}</tbody>
  </table>`;
}

function callingTiles(calling: CallingStatus | null): string {
  const blank =
    !calling ||
    (calling.callsAllocated === null &&
      calling.callsPicked === null &&
      calling.consultationScheduled === null &&
      calling.notPicked === null);
  if (blank) return empty('Nothing logged today.');
  return statTiles([
    { value: calling!.callsAllocated ?? '—', label: 'Allocated', tone: 'neutral' },
    { value: calling!.callsPicked ?? '—', label: 'Picked', tone: 'good' },
    { value: calling!.consultationScheduled ?? '—', label: 'Scheduled', tone: 'neutral' },
    { value: calling!.notPicked ?? '—', label: 'Not picked', tone: 'bad' },
  ]);
}

interface AdminRow {
  name: string;
  colour: string | null;
  tasks: Task[];
  consultations: Consultation[];
  calling: CallingStatus | null;
}

/** Initials for the little avatar circle, matching how the app's own Avatar reads a name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function memberCard(row: AdminRow): string {
  const totalAllocated = row.consultations.reduce((n, c) => n + (c.allocated ?? 0), 0);
  const totalCompleted = row.consultations.reduce((n, c) => n + (c.completed ?? 0), 0);
  const avatarBg = row.colour ?? '#64748b';

  return `<div style="margin:0 0 20px;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
    <table style="width:100%;border-collapse:collapse;background:${NAVY}">
      <tr>
        <td style="padding:12px 16px;width:36px">
          <div style="width:32px;height:32px;border-radius:999px;background:${avatarBg};color:#ffffff;font-size:13px;font-weight:700;text-align:center;line-height:32px">${esc(initials(row.name))}</div>
        </td>
        <td style="padding:12px 16px 12px 0">
          <span style="color:#ffffff;font-size:15px;font-weight:600">${esc(row.name)}</span>
        </td>
      </tr>
    </table>
    <div style="padding:16px">
      ${card(`Consultations — ${row.consultations.length} logged, ${totalAllocated} allocated / ${totalCompleted} completed`, consultationList(row.consultations))}
      ${card('Calling', callingTiles(row.calling))}
      ${card('Working on', taskTable(row.tasks))}
    </div>
  </div>`;
}

function adminDigestHtml(day: string, rows: AdminRow[]): string {
  return wrap('Team roundup', day, rows.map(memberCard).join(''));
}

// ---- Orchestration -----------------------------------------------------------

export interface DigestOutcome {
  sent: number;
  failed: number;
  skippedNoEmail: number;
  skipped?: string;
}

export async function sendDailyDigests(params: {
  day: string;
  people: User[];
  tasksByUser: Map<string, Task[]>;
  changesToday: ChangeRecord[];
  callingToday: CallingStatus[];
  consultationsToday: Consultation[];
}): Promise<DigestOutcome> {
  const outcome: DigestOutcome = { sent: 0, failed: 0, skippedNoEmail: 0 };

  const cfg: MailConfig | null = mailConfig();
  if (!cfg) return { ...outcome, skipped: 'not configured' };
  if (await alreadySentToday(params.day)) return { ...outcome, skipped: 'already sent today' };

  const touchedNames = new Set(params.changesToday.map((c) => c.actorName).filter(Boolean));
  const calledByUser = new Map(params.callingToday.map((c) => [c.userId, c]));
  const consultationsByUser = new Map<string, Consultation[]>();
  for (const c of params.consultationsToday) {
    const list = consultationsByUser.get(c.userId) ?? [];
    list.push(c);
    consultationsByUser.set(c.userId, list);
  }

  const adminRows: AdminRow[] = [];

  for (const person of params.people) {
    // Admins don't do calling/consultation work the same way the team does,
    // and don't get a personal recap — they get the roundup below instead,
    // built from everyone else's day, not their own.
    if (person.role === 'ADMIN') continue;

    const tasks = params.tasksByUser.get(person.id) ?? [];
    const calling = calledByUser.get(person.id) ?? null;
    const consultations = consultationsByUser.get(person.id) ?? [];
    adminRows.push({ name: person.name, colour: person.colour, tasks, consultations, calling });

    if (!person.email) {
      outcome.skippedNoEmail++;
      continue;
    }
    const touchedTask = touchedNames.has(person.name);
    const loggedCalling = Boolean(
      calling &&
        (calling.callsAllocated !== null ||
          calling.callsPicked !== null ||
          calling.consultationScheduled !== null ||
          calling.notPicked !== null),
    );
    try {
      await sendMail(
        cfg,
        person.email,
        `Your day — ${params.day}`,
        personalDigestHtml(person.name, params.day, tasks, touchedTask, loggedCalling),
      );
      outcome.sent++;
    } catch {
      outcome.failed++;
    }
  }

  const admins = params.people.filter((p) => p.role === 'ADMIN');
  const adminHtml = adminDigestHtml(params.day, adminRows);
  for (const admin of admins) {
    if (!admin.email) {
      outcome.skippedNoEmail++;
      continue;
    }
    try {
      await sendMail(cfg, admin.email, `Team roundup — ${params.day}`, adminHtml);
      outcome.sent++;
    } catch {
      outcome.failed++;
    }
  }

  await markSent(params.day);
  return outcome;
}
