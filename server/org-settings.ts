/**
 * The organisation profile — one row, read by the whole app.
 *
 * Reads are open: the app needs its own name and colour to render, and none of
 * this is secret. Writes require an admin session; the route enforces that, not
 * this module.
 *
 * Missing or unreadable settings must never take a page down, so `get` falls
 * back to defaults rather than throwing. An app that cannot reach its settings
 * should still start, wearing its default name.
 */
import { hasSql, requireSql } from './sql.js';
import {
  DEFAULT_ORG_SETTINGS,
  withDefaults,
  type OrgSettings,
} from '../src/schemas/orgSettings.js';

/** DB column <-> API field. Written out so neither side has to guess. */
const FIELDS: Record<keyof OrgSettings, string> = {
  appName: 'app_name',
  appTagline: 'app_tagline',
  organisationName: 'organisation_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  websiteUrl: 'website_url',
  addressLine: 'address_line',
  logoDataUri: 'logo_data_uri',
  brandColour: 'brand_colour',
  atRiskDays: 'at_risk_days',
  dailyExportTime: 'daily_export_time',
  dailyExportEnabled: 'daily_export_enabled',
  notifyOnOverdue: 'notify_on_overdue',
  notifyOnApproval: 'notify_on_approval',
  notificationEmail: 'notification_email',
};

const SELECT = (Object.entries(FIELDS) as [keyof OrgSettings, string][])
  .map(([field, column]) => `${column} as "${field}"`)
  .join(', ');

export async function getOrgSettings(): Promise<OrgSettings> {
  return (await readOrgSettings()).settings;
}

/**
 * The settings, and whether they are the real ones.
 *
 * Falling back to defaults keeps the app usable when the database is
 * unreachable — the sidebar renders on every page and must not throw. But
 * returning them silently made an outage invisible: the app wore its default
 * name and answered 200, so nothing on screen said the database was down.
 *
 * `degraded` says which happened. Callers that do not care ignore it and
 * behave exactly as before.
 */
export async function readOrgSettings(): Promise<{
  settings: OrgSettings;
  degraded: boolean;
  reason?: string;
}> {
  if (!hasSql) {
    return { settings: { ...DEFAULT_ORG_SETTINGS }, degraded: true, reason: 'No database is configured.' };
  }
  try {
    const db = requireSql();
    const rows = (await db.query(
      `select ${SELECT} from org_settings where id limit 1`,
    )) as Record<string, unknown>[];
    return { settings: withDefaults(rows[0] ?? null), degraded: false };
  } catch (err) {
    // Unreachable database, or org_settings not migrated yet.
    return {
      settings: { ...DEFAULT_ORG_SETTINGS },
      degraded: true,
      reason: (err as Error).message,
    };
  }
}

/**
 * Writes the fields present in `patch` and returns the whole row.
 *
 * Partial on purpose: the Settings page saves one section at a time, and a full
 * replace would let a stale tab overwrite a field it never showed.
 */
export async function saveOrgSettings(patch: Partial<OrgSettings>): Promise<OrgSettings> {
  const db = requireSql();
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [field, column] of Object.entries(FIELDS) as [keyof OrgSettings, string][]) {
    const value = patch[field];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getOrgSettings();

  sets.push('updated_at = now()');
  // The row is created by the migration, but an upsert means a database
  // restored from an older dump still works rather than silently saving
  // nothing.
  await db.query(
    `insert into org_settings (id) values (true) on conflict (id) do nothing`,
  );
  await db.query(`update org_settings set ${sets.join(', ')} where id`, params);
  return getOrgSettings();
}
