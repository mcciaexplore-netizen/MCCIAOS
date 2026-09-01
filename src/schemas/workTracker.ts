// Validation for the Work Tracker, shared by the API and the inline editors.
//
// Relative `.js` specifiers rather than the `@/` alias: this file is pulled
// into the Vercel function bundle, which resolves it outside Vite.

import { z } from 'zod';

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'submitted',
  'approved',
  'completed',
] as const;

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const COLLABORATOR_ROLES = ['contributor', 'reviewer'] as const;

/** Statuses that count as finished, for the Completed tab and overdue logic. */
export const CLOSED_STATUSES = ['approved', 'completed'] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

const uuid = z.string().uuid('Not a valid id');

/** A date field that can be cleared: a date string, or null. */
const nullableDate = isoDate.nullable().optional();

const taskFields = z.object({
  title: z.string().trim().min(1, 'Give the task a title'),
  description: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).default('not_started'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  assigneeId: uuid,
  allocatedBy: uuid.nullable().optional(),
  reportTo: uuid.nullable().optional(),
  approverId: uuid.nullable().optional(),
  allocatedAt: z.string().nullable().optional(),
  dueDate: nullableDate,
  deadline: nullableDate,
});

type TaskFields = Partial<z.infer<typeof taskFields>>;

/**
 * "deadline cannot be earlier than due_date". Only judgeable when both are
 * present in the same payload; a partial PATCH is re-checked server-side
 * against the merged row, and Postgres enforces it as a CHECK regardless.
 */
function checkDates(v: TaskFields, ctx: z.RefinementCtx) {
  if (v.dueDate && v.deadline && v.deadline < v.dueDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deadline'],
      message: 'Deadline cannot be earlier than the due date',
    });
  }
}

export const taskSchema = taskFields.superRefine(checkDates);

/**
 * PATCH body. Every field optional — inline editing sends one cell at a time,
 * often a single key like `{ "status": "in_progress" }`.
 */
export const taskUpdateSchema = taskFields.partial().superRefine(checkDates);

export const collaboratorSchema = z.object({
  userId: uuid,
  role: z.enum(COLLABORATOR_ROLES).default('contributor'),
  memberDueDate: nullableDate,
});

export const collaboratorUpdateSchema = z
  .object({
    role: z.enum(COLLABORATOR_ROLES).optional(),
    memberDueDate: nullableDate,
  })
  .refine((v) => v.role !== undefined || v.memberDueDate !== undefined, {
    message: 'Nothing to update',
  });

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type CollaboratorInput = z.infer<typeof collaboratorSchema>;
export type CollaboratorUpdateInput = z.infer<typeof collaboratorUpdateSchema>;
