// Validation for the Workshops & Events module, shared by the API
// (server/handlers.ts) and the forms, exactly as ./index.ts is.
//
// Imports here use relative `.js` specifiers rather than the `@/` alias for the
// same reason the sibling module does: this file is pulled into the Vercel
// function bundle, which resolves it outside Vite.

import { z } from 'zod';
import type { EventType } from '../types/index.js';

export const EVENT_TYPES = ['WORKSHOP', 'EVENT'] as const;
export const EVENT_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'] as const;
export const EVENT_STATUSES = ['UPCOMING', 'COMPLETED', 'CANCELLED'] as const;

/** Code prefix per type. Workshops are W-, standalone events EV-. */
export const CODE_PREFIX: Record<EventType, string> = {
  WORKSHOP: 'W-',
  EVENT: 'EV-',
};

// Zero-padded to two digits, but wider once the serial outgrows them, so the
// sequence reads W-01 … W-99, W-100. Anchored, so "W-1" and "W-01x" are both
// rejected.
const CODE_RE = /^(W|EV)-(\d{2,})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Formats a serial as its display code. The inverse of `serialFromCode`. */
export function codeFor(type: EventType, serial: number): string {
  return `${CODE_PREFIX[type]}${String(serial).padStart(2, '0')}`;
}

/**
 * The serial encoded in a code, or null when it is not a well-formed code.
 *
 * Codes and serials are never accepted independently — an override supplies the
 * code and the serial is read back out of it, so `events.code` and
 * `events.serial_no` can never disagree.
 */
export function serialFromCode(code: string): number | null {
  const m = CODE_RE.exec(code.trim().toUpperCase());
  if (!m) return null;
  const serial = Number(m[2]);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : null;
}

/** The type a code belongs to, or null when the prefix is not recognised. */
export function typeFromCode(code: string): EventType | null {
  const m = CODE_RE.exec(code.trim().toUpperCase());
  if (!m) return null;
  return m[1] === 'W' ? 'WORKSHOP' : 'EVENT';
}

// Optional free text. Blank is allowed and normalised to null by the server, so
// clearing a field in the form actually clears the column.
const text = z.string().optional();
const time = z
  .string()
  .regex(TIME_RE, 'Use 24-hour HH:MM')
  .optional()
  .or(z.literal(''));

const eventFields = z.object({
  // Blank means "auto-assign the next serial for this type".
  code: z.string().optional().or(z.literal('')),
  type: z.enum(EVENT_TYPES),
  title: z.string().min(1, 'Title is required'),
  description: text,
  topic: text,
  mode: z.enum(EVENT_MODES),
  venue: text,
  meetingLink: text,
  eventDate: z.string().regex(DATE_RE, 'Pick a date'),
  startTime: time,
  endTime: time,
  speaker: text,
  status: z.enum(EVENT_STATUSES).default('UPCOMING'),
  // Manual bulk figures, used only while an event has no participant rows.
  registeredCount: z.coerce.number().int().min(0).default(0),
  attendedCount: z.coerce.number().int().min(0).default(0),
  notes: text,
});

type EventFields = Partial<z.infer<typeof eventFields>>;

function checkEvent(v: EventFields, ctx: z.RefinementCtx) {
  // An override is validated for shape here and for uniqueness in the database,
  // which is the only place that can answer it without a race.
  if (v.code) {
    const serial = serialFromCode(v.code);
    if (serial === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Use W-01 for workshops or EV-01 for events',
      });
    } else if (v.type && typeFromCode(v.code) !== v.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: `A ${v.type.toLowerCase()} code must start with ${CODE_PREFIX[v.type]}`,
      });
    }
  }

  if (v.startTime && v.endTime && v.endTime <= v.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'End time must be after the start time',
    });
  }

  // Guards the attendance rate: more attendees than registrations would render
  // as a percentage above 100.
  if (
    typeof v.registeredCount === 'number' &&
    typeof v.attendedCount === 'number' &&
    v.attendedCount > v.registeredCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attendedCount'],
      message: 'Attended cannot exceed registered',
    });
  }
}

export const eventSchema = eventFields.superRefine(checkEvent);

/**
 * PATCH body. Every field optional, so a partial update never has to resend the
 * whole record. `type` may be absent here, in which case the code prefix is
 * re-checked server-side against the type already stored.
 */
export const eventUpdateSchema = eventFields.partial().superRefine(checkEvent);

const participantFields = z.object({
  name: z.string().min(1, 'Name is required'),
  company: text,
  designation: text,
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: text,
  isMember: z.boolean().default(false),
  attended: z.boolean().default(false),
});

export const participantSchema = participantFields;
export const participantUpdateSchema = participantFields.partial();

/**
 * CSV import. Deliberately lenient, matching importSchemaForSheet in ./index.ts:
 * a delegate list is somebody's real data, and dropping the whole row because an
 * email is malformed or a cell is blank helps nobody. Only `name` is required,
 * because it is NOT NULL in the table.
 */
export const participantImportSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  company: text,
  designation: text,
  email: text,
  phone: text,
  isMember: z.boolean().default(false),
  attended: z.boolean().default(false),
});

export type EventInput = z.infer<typeof eventSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type ParticipantInput = z.infer<typeof participantSchema>;
export type ParticipantUpdateInput = z.infer<typeof participantUpdateSchema>;
export type ParticipantImportInput = z.infer<typeof participantImportSchema>;
