// Validation for the Work Tracker, shared by the API and the inline editors.
//
// Relative `.js` specifiers rather than the `@/` alias: this file is pulled
// into the server bundle, which resolves it outside Vite.

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
  deadlineDate: nullableDate,
  reportTo: uuid.nullable().optional(),
  approverId: uuid.nullable().optional(),
  percentage: percent,
});

type TaskFields = Partial<z.infer<typeof taskFields>>;

export const taskSchema = taskFields;

/**
 * PATCH body. Every field optional — inline editing sends one cell at a time,
 * often a single key like `{ "status": "ongoing" }`.
 */
export const taskUpdateSchema = taskFields.partial();

// ---- Team members ---------------------------------------------------------

const userFields = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  // Required by the form for anyone added or edited from now on, but the column
  // stays nullable: the rows that already existed have no address and
  // inventing one for a real person would be fabricating data.
  // An empty string means "no email" and becomes null, matching the nullable
  // column. Without this the form could show a blank field it could not save:
  // clearing the input sends '', which .email() rejects, so the request came
  // back 422 while the UI insisted the value was fine.
  email: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().email('Enter a valid email').nullable(),
    )
    .optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  reportsTo: uuid.nullable().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  isActive: z.boolean().default(true),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour')
    .nullable()
    .optional(),
  canBeReportedTo: z.boolean().optional(),
  canApprove: z.boolean().optional(),
});

export const userSchema = userFields;
export const userUpdateSchema = userFields.partial();

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type UserInput = z.infer<typeof userSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

// ---- Consultations ---------------------------------------------------------
// Their own records, not three columns on every task. Deliberately not gated by
// the admin passcode — see db/consultations.sql.

const consultationFields = z.object({
  title: z.string().trim().min(1, 'Give the consultation a name'),
  userId: uuid,
  heldOn: nullableDate,
  heldAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:MM time')
    .nullable()
    .optional(),
  allocated: count,
  completed: count,
});

export const consultationSchema = consultationFields;
export const consultationUpdateSchema = consultationFields.partial();
export type ConsultationInput = z.infer<typeof consultationSchema>;
export type ConsultationUpdateInput = z.infer<typeof consultationUpdateSchema>;

// ---- Calling status ---------------------------------------------------------
// One tally per person, edited a cell at a time. Deliberately not gated by the
// admin passcode — see db/calling-status.sql.

export const CALLING_FIELDS = [
  'callsAllocated',
  'callsPicked',
  'consultationScheduled',
  'notPicked',
] as const;

/**
 * A single cell edit: whose tally, which figure, what it is now.
 *
 * One field per request rather than the whole row, so two people editing
 * different columns at the same moment cannot overwrite each other — which a
 * whole-row write from a stale table would do without saying so.
 */
export const callingUpdateSchema = z.object({
  userId: uuid,
  field: z.enum(CALLING_FIELDS),
  value: count,
  /** Which day's figures. Omitted means today, in IST. */
  day: nullableDate,
});

export type CallingUpdateInput = z.infer<typeof callingUpdateSchema>;
