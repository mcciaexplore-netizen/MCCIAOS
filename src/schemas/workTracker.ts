// Validation for the Work Tracker, shared by the API and the inline editors.
//
// Relative `.js` specifiers rather than the `@/` alias: this file is pulled
// into the Vercel function bundle, which resolves it outside Vite.

import { z } from 'zod';

export const TASK_STATUSES = [
  'upcoming',
  'ongoing',
  'hold',
  'stopped',
  'completed',
] as const;

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;

/** Work that is still live, so still capable of being late. */
export const OPEN_STATUSES = ['upcoming', 'ongoing', 'hold'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const uuid = z.string().uuid('Not a valid id');
const nullableDate = isoDate.nullable().optional();

/**
 * The metric fields. Nullable rather than defaulted to 0: a task that has
 * nothing to do with consultations should say nothing about them, and "none
 * yet" is a different statement from "not applicable".
 *
 * Accepts a number or a numeric string, because an <input type="number"> hands
 * back "" for empty and "3" for three, and an empty cell means null.
 */
const count = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').nullable(),
).optional();

const percent = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce
    .number()
    .int('Whole numbers only')
    .min(0, 'Cannot be below 0')
    .max(100, 'Cannot be above 100')
    .nullable(),
).optional();

const taskFields = z.object({
  userId: uuid,
  title: z.string().trim().min(1, 'Give the work a title'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  status: z.enum(TASK_STATUSES).default('upcoming'),
  allocationDate: nullableDate,
  dueDate: nullableDate,
  deadlineDate: nullableDate,
  reportTo: uuid.nullable().optional(),
  approverId: uuid.nullable().optional(),
  percentage: percent,
  consultationsAllocated: count,
  consultationsDone: count,
  callingsDone: count,
});

type TaskFields = Partial<z.infer<typeof taskFields>>;

/**
 * "deadline_date cannot be earlier than due_date". Only judgeable when both are
 * present in the same payload; a partial PATCH is re-checked server-side
 * against the merged row, and Postgres enforces it as a CHECK regardless.
 */
function checkDates(v: TaskFields, ctx: z.RefinementCtx) {
  if (v.dueDate && v.deadlineDate && v.deadlineDate < v.dueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deadlineDate'],
      message: 'The deadline cannot be earlier than the due date',
    });
  }
}

export const taskSchema = taskFields.superRefine(checkDates);

/**
 * PATCH body. Every field optional — inline editing sends one cell at a time,
 * often a single key like `{ "status": "ongoing" }`.
 */
export const taskUpdateSchema = taskFields.partial().superRefine(checkDates);

// ---- Team members ---------------------------------------------------------

const userFields = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  // Required by the form for anyone added or edited from now on, but the column
  // stays nullable: the rows that already existed have no address and
  // inventing one for a real person would be fabricating data.
  email: z.string().trim().email('Enter a valid email').nullable().optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  reportsTo: uuid.nullable().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  isActive: z.boolean().default(true),
});

export const userSchema = userFields;
export const userUpdateSchema = userFields.partial();

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type UserInput = z.infer<typeof userSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
