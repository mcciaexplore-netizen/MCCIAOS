/**
 * A minimal Google Sheets client.
 *
 * Deliberately not `googleapis`: that package is tens of megabytes and pulls in
 * the whole discovery layer to reach three REST endpoints. All this needs is a
 * signed JWT exchanged for an access token, and three calls — read the tab
 * list, add a tab, append rows.
 *
 * CREDENTIALS. A Google Cloud service account with the Sheets API enabled, and
 * the target spreadsheet shared with that account's address as an Editor. The
 * key arrives in two environment variables rather than a file, because a host
 * has no filesystem to put a file on:
 *
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  ...@...iam.gserviceaccount.com
 *   GOOGLE_PRIVATE_KEY            the PEM, newlines escaped as \n
 *   SHEETS_SPREADSHEET_ID         the id from the sheet's URL
 */
import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = 'SheetsError';
  }
}

export interface SheetsConfig {
  email: string;
  privateKey: string;
  spreadsheetId: string;
}

/**
 * Reads the configuration, or explains precisely what is missing.
 *
 * Returns null rather than throwing when nothing is configured at all, so the
 * app runs perfectly well without Sheets — the export is an addition, not a
 * dependency.
 */
export function sheetsConfig(): SheetsConfig | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID?.trim();

  if (!email && !rawKey && !spreadsheetId) return null;

  const missing = [
    !email && 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    !rawKey && 'GOOGLE_PRIVATE_KEY',
    !spreadsheetId && 'SHEETS_SPREADSHEET_ID',
  ].filter(Boolean);
  if (missing.length) {
    throw new SheetsError(`Sheets export is half-configured. Missing: ${missing.join(', ')}`, 500);
  }

  // Environment variables cannot hold real newlines on most hosts, so the PEM
  // is stored with them escaped. Accept both forms rather than making the
  // person deploying guess which one this wants.
  const privateKey = rawKey!.includes('\\n') ? rawKey!.replace(/\\n/g, '\n') : rawKey!;
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new SheetsError(
      'GOOGLE_PRIVATE_KEY does not look like a PEM key. Copy the whole private_key value from the service account JSON, including the BEGIN/END lines.',
      500,
    );
  }
  return { email: email!, privateKey, spreadsheetId: spreadsheetId! };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Signed JWT -> access token. Tokens last an hour; nothing here runs that long. */
async function accessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: cfg.email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(cfg.privateKey));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  } | null;

  if (!res.ok || !body?.access_token) {
    throw new SheetsError(
      `Google refused the service account: ${body?.error_description || body?.error || res.status}`,
      502,
    );
  }
  return body.access_token;
}

async function call<T>(
  cfg: SheetsConfig,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${SHEETS}/${cfg.spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403) {
      throw new SheetsError(
        `Google denied access: ${message}. Share the spreadsheet with ${cfg.email} as an Editor.`,
        403,
      );
    }
    if (res.status === 404) {
      throw new SheetsError(
        `Spreadsheet ${cfg.spreadsheetId} not found. Check SHEETS_SPREADSHEET_ID.`,
        404,
      );
    }
    throw new SheetsError(`Sheets API: ${message}`, 502);
  }
  return body as T;
}

export interface Sheet {
  title: string;
  sheetId: number;
}

export async function openSheet(cfg: SheetsConfig) {
  const token = await accessToken(cfg);

  const meta = await call<{ sheets: { properties: Sheet }[] }>(
    cfg,
    token,
    '?fields=sheets.properties.title,sheets.properties.sheetId',
  );
  const tabs = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  return {
    /** Tab titles as they exist right now. */
    tabs: () => [...tabs.keys()],

    /**
     * Finds a tab by name, case-insensitively and ignoring surrounding spaces.
     * A sheet maintained by hand will have "Aarushi " or "aarushi" in it sooner
     * or later, and creating a second tab for the same person because of a
     * capital letter would split their history in two.
     */
    find(name: string): string | null {
      const want = name.trim().toLowerCase();
      for (const title of tabs.keys()) {
        if (title.trim().toLowerCase() === want) return title;
      }
      return null;
    },

    async createTab(title: string): Promise<string> {
      const res = await call<{
        replies?: { addSheet?: { properties?: { sheetId?: number } } }[];
      }>(cfg, token, ':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title } } }],
        }),
      });
      // The real id, not a placeholder: anything addressing the tab by id —
      // setting a column format, say — silently does nothing with -1.
      tabs.set(title, res.replies?.[0]?.addSheet?.properties?.sheetId ?? -1);
      return title;
    },

    /** Appends rows to the bottom of a tab, letting Sheets find the first free row. */
    async append(title: string, rows: (string | number | null)[][]): Promise<number> {
      if (rows.length === 0) return 0;
      const range = encodeURIComponent(`${title}!A1`);
      const r = await call<{ updates?: { updatedRows?: number } }>(
        cfg,
        token,
        `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: 'POST', body: JSON.stringify({ values: rows }) },
      );
      return r.updates?.updatedRows ?? rows.length;
    },

    /**
     * The last date written to a tab, from column A. Used to tell whether today
     * has already been exported, so a second run does not double the record.
     */
    async lastDate(title: string): Promise<string | null> {
      const range = encodeURIComponent(`${title}!A:A`);
      const r = await call<{ values?: string[][] }>(cfg, token, `/values/${range}`);
      const rows = r.values ?? [];
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = (rows[i]?.[0] ?? '').trim();
        if (v && v !== 'Date') return v;
      }
      return null;
    },

    /** First row of a tab, to decide whether a header still needs writing. */
    async firstRow(title: string): Promise<string[]> {
      const range = encodeURIComponent(`${title}!A1:Z1`);
      const r = await call<{ values?: string[][] }>(cfg, token, `/values/${range}`);
      return r.values?.[0] ?? [];
    },

    /**
     * Pins one column to a 12-hour clock.
     *
     * Sheets parses "23:01:13" into a time value and picks the display format
     * from the spreadsheet's locale, so the clock the team sees would otherwise
     * depend on a setting nobody in this app controls — 24-hour under en_GB,
     * 12-hour under en_US. Stating the pattern makes it the same for everyone.
     *
     * The am/pm token is what selects a 12-hour clock; Sheets renders hours
     * 0-23 without one. The value stored underneath is unaffected either way.
     */
    async setTimeFormat(title: string, columnIndex: number): Promise<void> {
      const sheetId = tabs.get(title);
      if (sheetId === undefined || sheetId < 0) return;
      await call(cfg, token, ':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: { sheetId, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 },
                cell: { userEnteredFormat: { numberFormat: { type: 'TIME', pattern: 'h:mm:ss am/pm' } } },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
          ],
        }),
      });
    },

    /** Values already present in one column, used as stable sync markers. */
    async columnValues(title: string, column: string): Promise<string[]> {
      if (!/^[A-Z]+$/.test(column)) {
        throw new SheetsError(`Invalid sheet column: ${column}`, 500);
      }
      const range = encodeURIComponent(`${title}!${column}:${column}`);
      const r = await call<{ values?: (string | number | null)[][] }>(
        cfg,
        token,
        `/values/${range}`,
      );
      return (r.values ?? [])
        .map((row) => row[0])
        .filter((value): value is string | number => value !== null && value !== undefined)
        .map(String);
    },
  };
}
