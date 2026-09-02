import { z } from 'zod';

/**
 * The organisation profile: things that were hardcoded and should not have been.
 *
 * Every field is optional with a safe default, so a fresh install and a
 * half-saved record both yield a complete, usable config rather than blank
 * chrome. Validation is shared by the form and the API — one definition, so the
 * two can never disagree about what is acceptable.
 */

const trimmed = z.string().trim();

/**
 * Blank is allowed; a wrong-looking value is not.
 *
 * `refine` rather than a union of "empty" and "valid": a union reports the
 * first branch's failure, so a bad email came back as "String must contain at
 * most 0 character(s)" — technically true of the empty branch and useless to
 * the person reading it.
 */
const blankOr = (check: (v: string) => boolean, message: string) =>
  trimmed.refine((v) => v === '' || check(v), { message });

const isEmail = (v: string) => z.string().email().safeParse(v).success;
const isUrl = (v: string) => z.string().url().safeParse(v).success;

const optionalEmail = blankOr(isEmail, 'That does not look like an email address');
const optionalUrl = blankOr(
  isUrl,
  'Include the full address, starting http:// or https://',
);

/** Loose on purpose: phone formats vary and rejecting a real number is worse. */
const optionalPhone = blankOr(
  (v) => /^[0-9+()\-.\s]{6,32}$/.test(v),
  'Use 6-32 characters: digits, spaces and + ( ) - .',
);

const hexColour = trimmed.regex(
  /^#[0-9a-fA-F]{6}$/,
  'Use a six-digit hex colour, like #0B1F3A',
);

const hhmm = trimmed.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:MM time');

export const orgSettingsSchema = z.object({
  // ---- Organisation -------------------------------------------------------
  appName: trimmed.min(1, 'The application needs a name').max(40, 'Keep it under 40 characters'),
  appTagline: trimmed.max(60, 'Keep it under 60 characters'),
  organisationName: trimmed.max(120, 'Keep it under 120 characters'),

  // ---- Contact ------------------------------------------------------------
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  websiteUrl: optionalUrl,
  addressLine: trimmed.max(200, 'Keep it under 200 characters'),

  // ---- Branding -----------------------------------------------------------
  /** Data URI or path. Empty falls back to a lettermark drawn from appName. */
  logoDataUri: z.string().max(2_000_000, 'That image is too large — keep it under 1.5MB'),
  brandColour: hexColour,

  // ---- Work Tracker preferences ------------------------------------------
  /**
   * How many days ahead of a deadline counts as "at risk". Was hardcoded as 3
   * in the SQL, where changing it meant a deploy.
   */
  atRiskDays: z.coerce
    .number()
    .int('Whole days only')
    .min(1, 'At least one day')
    .max(30, 'At most 30 days'),
  /** The daily export time, IST. The cron is separate; this documents intent. */
  dailyExportTime: hhmm,
  /** Whether the daily Google Sheets export runs at all. */
  dailyExportEnabled: z.boolean(),

  // ---- Notifications ------------------------------------------------------
  notifyOnOverdue: z.boolean(),
  notifyOnApproval: z.boolean(),
  /** Where digests would go. Blank means nowhere, which is the default. */
  notificationEmail: optionalEmail,
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

/**
 * Safe defaults. Used when nothing is stored, and merged under whatever is —
 * so a record saved before a field existed still produces a complete object.
 */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  appName: 'MCCIA OS',
  appTagline: 'Applied AI Studio',
  organisationName: 'MCCIA Applied AI Studio',
  contactEmail: '',
  contactPhone: '',
  websiteUrl: '',
  addressLine: '',
  logoDataUri: '',
  brandColour: '#0B1F3A',
  atRiskDays: 3,
  dailyExportTime: '18:00',
  dailyExportEnabled: true,
  notifyOnOverdue: false,
  notifyOnApproval: false,
  notificationEmail: '',
};

/** Fills gaps rather than rejecting, so a partial record is still usable. */
export function withDefaults(stored: unknown): OrgSettings {
  const merged = { ...DEFAULT_ORG_SETTINGS, ...(stored as Partial<OrgSettings> | null) };
  const parsed = orgSettingsSchema.safeParse(merged);
  // A stored value that no longer validates (a field's rules tightened since)
  // must not take the page down. Fall back field by field.
  if (parsed.success) return parsed.data;
  const out = { ...DEFAULT_ORG_SETTINGS };
  for (const key of Object.keys(DEFAULT_ORG_SETTINGS) as (keyof OrgSettings)[]) {
    const one = orgSettingsSchema.shape[key].safeParse(merged[key]);
    if (one.success) (out as Record<string, unknown>)[key] = one.data;
  }
  return out;
}

/** Fields the form marks as required. */
export const REQUIRED_FIELDS: (keyof OrgSettings)[] = [
  'appName',
  'brandColour',
  'atRiskDays',
  'dailyExportTime',
];
