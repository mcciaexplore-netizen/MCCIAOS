// Validation for the Daily Work Log module, shared by the API
// (server/handlers.ts) and the forms, as ./index.ts and ./events.ts are.
//
// Relative `.js` specifiers rather than the `@/` alias: this file is pulled into
// the Vercel function bundle, which resolves it outside Vite.

import { z } from 'zod';

export const LOG_CATEGORIES = [
  'CONSULTATION',
  'APPLICATION',
  'WORKSHOP',
  'MARKETING',
  'OPERATIONS',
  'RESEARCH',
  'ADMIN',
  'OTHER',
] as const;

export const LOG_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'DONE',
  'BLOCKED',
  'CARRIED_FORWARD',
] as const;

export const LOG_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** Statuses that carry forward — everything not finished and not already rolled. */
export const UNFINISHED_STATUSES = ['PLANNED', 'IN_PROGRESS', 'BLOCKED'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

const uuid = z.string().uuid('Not a valid id');
const text = z.string().optional();

/** Non-empty after trimming — a field of spaces is not an output. */
const filled = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';

const logFields = z.object({
  logDate: isoDate.optional(),
  userId: uuid,
  title: z.string().min(1, 'Give the task a title'),
  category: z.enum(LOG_CATEGORIES),
  description: text,
  output: text,
  outputLink: text,
  status: z.enum(LOG_STATUSES).default('PLANNED'),
  priority: z.enum(LOG_PRIORITIES).default('MEDIUM'),
  timeSpentMins: z.coerce.number().int().min(0, 'Minutes cannot be negative').optional(),
  blockerNote: text,
});

type LogFields = Partial<z.infer<typeof logFields>>;

/**
 * The two rules that give the module its point, checked here so the message is
 * a field-level one the form can show. The API re-checks against the stored row
 * for partial updates, and Postgres enforces both as CHECK constraints — a
 * status and its evidence must never drift apart.
 */
function checkLog(v: LogFields, ctx: z.RefinementCtx) {
  if (v.status === 'DONE' && !filled(v.output)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['output'],
      message: 'Record what was produced before marking this done',
    });
  }
  if (v.status === 'BLOCKED' && !filled(v.blockerNote)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blockerNote'],
      message: 'Say what is blocking this',
    });
  }
}

export const dailyLogSchema = logFields.superRefine(checkLog);

/**
 * PATCH body. Every field optional; `userId` too, so an edit does not have to
 * restate whose entry it is. The DONE/BLOCKED rules cannot be fully judged from
 * a partial body — a patch of `{status:'DONE'}` may be satisfied by an output
 * already stored — so they are re-checked server-side against the merged row.
 */
export const dailyLogUpdateSchema = logFields.partial();

/** POST /api/daily-logs/[id]/complete */
export const completeLogSchema = z.object({
  output: z.string().min(1, 'Record what was produced'),
  outputLink: text,
  timeSpentMins: z.coerce.number().int().min(0).optional(),
});

/** POST /api/daily-logs/carry-forward */
export const carryForwardSchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    // Required here, unlike the brief's optional form: with no session there is
    // no "me" to fall back to, and defaulting to the whole team would make a
    // one-click button rewrite everyone's day.
    userId: uuid,
  })
  .refine((v) => v.toDate > v.fromDate, {
    path: ['toDate'],
    message: 'Carry forward to a later date than the one you are carrying from',
  });

/** POST /api/daily-checkins — upsert on (user_id, log_date). */
export const checkinSchema = z.object({
  userId: uuid,
  logDate: isoDate.optional(),
  daySummary: text,
});

export type DailyLogInput = z.infer<typeof dailyLogSchema>;
export type DailyLogUpdateInput = z.infer<typeof dailyLogUpdateSchema>;
export type CompleteLogInput = z.infer<typeof completeLogSchema>;
export type CarryForwardInput = z.infer<typeof carryForwardSchema>;
export type CheckinInput = z.infer<typeof checkinSchema>;
