// Per-sheet import/export definitions.
//
// The files people actually have are not shaped like the database: they write
// "Company Name", not `companyName`, and they name the company rather than
// quoting its uuid. This module owns that translation in both directions so
// the pages and the API stay unchanged.
//
// Three things make an arbitrary spreadsheet importable:
//   1. Header matching is fuzzy      — "Company Name" / "companyName" / "COMPANY  NAME" all hit.
//   2. Vocabularies snap             — "active" becomes the configured "Active".
//   3. References resolve by name    — "Acme Traders" becomes that company's uuid.

import type { SheetName } from '@/types';

// Settings keys holding a flat list of allowed values, as exposed by
// useSettings(). The toned vocabularies are read through their *Values views.
export type VocabKey =
  | 'teamMembers'
  | 'leadSources'
  | 'businessScales'
  | 'membershipStatuses'
  | 'resourceCategories'
  | 'creativePlatforms'
  | 'projectStageValues'
  | 'companyStatusValues'
  | 'sessionStatusValues'
  | 'creativeStatusValues';

export type RefSheet = 'Company';

export interface TransferColumn {
  /** Field name on the record. */
  key: string;
  /** Header written on export, and the primary name matched on import. */
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean';
  /** Constrain to a configurable vocabulary, snapping close matches. */
  vocab?: VocabKey;
  /** Store an id, but read and write the referenced record's name. */
  ref?: RefSheet;
  /** Extra header spellings accepted on import. */
  aliases?: string[];
  /** Value used in the downloadable template. */
  example?: string;
}

export interface TransferSpec {
  sheet: SheetName;
  /** Plural noun used in UI copy: "Import Companies". */
  label: string;
  /** Base name for downloaded files. */
  filename: string;
  columns: TransferColumn[];
}

// ---- Column definitions ---------------------------------------------------
// Mirror the zod schemas in @/schemas — the server validates against those, so
// a column that is required there must be marked required here or the preview
// would promise a row that the API then rejects.

const assignedTo: TransferColumn = {
  key: 'assignedTo',
  label: 'Assigned To',
  vocab: 'teamMembers',
  aliases: ['owner', 'assignee', 'assigned'],
  example: 'Sujal',
};

const companyRef: TransferColumn = {
  key: 'companyId',
  label: 'Company',
  required: true,
  ref: 'Company',
  aliases: ['companyName', 'company name', 'client'],
  example: 'Acme Traders',
};

export const TRANSFER_SPECS: Record<string, TransferSpec> = {
  Company: {
    sheet: 'Company',
    label: 'Companies',
    filename: 'companies',
    columns: [
      { key: 'companyName', label: 'Company Name', required: true, aliases: ['company', 'firm', 'business'], example: 'Acme Traders' },
      { key: 'contactName', label: 'Contact Name', required: true, aliases: ['name', 'person', 'person name', 'contact person', 'proprietor'], example: 'Priya Sharma' },
      { key: 'contactEmail', label: 'Email', required: true, aliases: ['contactEmail', 'e-mail', 'mail', 'email id', 'email address', 'mail id'], example: 'priya@acme.in' },
      // "Contact" on its own means the phone number in every MSME sheet seen so
      // far; the person is spelled out as "Person Name" / "Contact Person".
      { key: 'contactPhone', label: 'Phone', required: true, aliases: ['contactPhone', 'mobile', 'contact number', 'contact', 'contact no', 'phone no', 'mobile no'], example: '9876543210' },
      { key: 'contactRole', label: 'Role', aliases: ['designation', 'title'], example: 'Owner' },
      { key: 'udyamNumber', label: 'UDYAM Number', aliases: ['udyam', 'udyam no', 'udyam reg no', 'udyam registration'], example: 'UDYAM-MH-26-0001234' },
      { key: 'district', label: 'District', example: 'Pune' },
      { key: 'industry', label: 'Industry', aliases: ['sector'], example: 'Manufacturing' },
      { key: 'membershipStatus', label: 'Membership', vocab: 'membershipStatuses', example: 'Member' },
      { key: 'rampScheme', label: 'RAMP Scheme', type: 'boolean', aliases: ['ramp'], example: 'No' },
      { key: 'leadSource', label: 'Lead Source', vocab: 'leadSources', aliases: ['source'], example: 'Workshop' },
      { key: 'businessScale', label: 'Business Scale', vocab: 'businessScales', aliases: ['scale', 'size'], example: 'Micro' },
      { key: 'status', label: 'Status', vocab: 'companyStatusValues', example: 'New Lead' },
      assignedTo,
    ],
  },

  Session: {
    sheet: 'Session',
    label: 'Sessions',
    filename: 'consulting-sessions',
    columns: [
      companyRef,
      { key: 'query', label: 'Query', required: true, aliases: ['question', 'issue', 'problem'], example: 'Needs GST filing guidance' },
      { key: 'solution', label: 'Solution', aliases: ['advice'], example: 'Referred to empanelled CA' },
      { key: 'consultant', label: 'Consultant', example: 'Ziya' },
      { key: 'mode', label: 'Mode', aliases: ['channel'], example: 'Call' },
      { key: 'payment', label: 'Payment', example: 'Free' },
      { key: 'domain', label: 'Domain', aliases: ['area'], example: 'Finance' },
      { key: 'outcome', label: 'Outcome', aliases: ['result'], example: 'Resolved' },
      { key: 'status', label: 'Status', vocab: 'sessionStatusValues', example: 'Pending' },
      assignedTo,
    ],
  },

  Project: {
    sheet: 'Project',
    label: 'Projects',
    filename: 'projects',
    columns: [
      companyRef,
      { key: 'title', label: 'Title', aliases: ['project', 'project name'], example: 'Inventory dashboard' },
      { key: 'stage', label: 'Stage', vocab: 'projectStageValues', aliases: ['status'], example: 'Pre Dev' },
      { key: 'progressPct', label: 'Progress %', type: 'number', aliases: ['progress', 'percent'], example: '0' },
      { key: 'repoUrl', label: 'Repo URL', aliases: ['repo', 'github'], example: 'https://github.com/org/repo' },
      { key: 'liveUrl', label: 'Live URL', aliases: ['live', 'url'], example: 'https://acme.example.com' },
      { key: 'nextAction', label: 'Next Action', aliases: ['next'], example: 'Share wireframes' },
      { key: 'blocker', label: 'Blocker', aliases: ['blocked by'], example: '' },
      assignedTo,
    ],
  },

  Creative: {
    sheet: 'Creative',
    label: 'Creatives',
    filename: 'creatives',
    columns: [
      companyRef,
      { key: 'platform', label: 'Platform', required: true, vocab: 'creativePlatforms', aliases: ['channel'], example: 'Instagram' },
      { key: 'status', label: 'Status', vocab: 'creativeStatusValues', example: 'draft' },
      { key: 'imageUrl', label: 'Image URL', aliases: ['image', 'asset'], example: 'https://example.com/post.png' },
      { key: 'caption', label: 'Caption', aliases: ['copy', 'text'], example: 'Launching our new store!' },
      assignedTo,
    ],
  },

  Resource: {
    sheet: 'Resource',
    label: 'Resources',
    filename: 'resources',
    columns: [
      { key: 'name', label: 'Name', required: true, aliases: ['title'], example: 'MSME scheme tracker' },
      { key: 'url', label: 'URL', required: true, aliases: ['link'], example: 'https://docs.google.com/spreadsheets/d/xxx' },
      { key: 'description', label: 'Description', required: true, aliases: ['notes', 'about'], example: 'Live status of applications' },
      { key: 'category', label: 'Category', required: true, vocab: 'resourceCategories', aliases: ['type'], example: 'Sheet' },
      { key: 'addedBy', label: 'Added By', vocab: 'teamMembers', example: 'Sujal' },
    ],
  },
};

// ---- Header matching ------------------------------------------------------

/**
 * Collapse a header to a comparison key. Dropping case and every non
 * alphanumeric character is what lets "Company Name", "company_name" and the
 * raw field name `companyName` all resolve to the same column without the
 * spec listing each spelling.
 */
export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map each column to the header in `headers` that supplies it, if any. */
export function matchHeaders(
  headers: string[],
  columns: TransferColumn[],
): Record<string, string | undefined> {
  const byNormalized = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n && !byNormalized.has(n)) byNormalized.set(n, h);
  }

  const mapping: Record<string, string | undefined> = {};
  for (const col of columns) {
    const candidates = [col.label, col.key, ...(col.aliases ?? [])];
    mapping[col.key] = candidates
      .map((c) => byNormalized.get(normalizeHeader(c)))
      .find(Boolean);
  }
  return mapping;
}

// ---- Value coercion -------------------------------------------------------

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x', '✓', 'enrolled']);
const FALSY = new Set(['false', 'no', 'n', '0', '', '-']);

export interface RefResolver {
  /** id → display name, for export. */
  label(id: string): string | undefined;
  /** User-entered text → id, for import. Accepts a name or an existing id. */
  resolve(text: string): string | undefined;
}

export interface TransferContext {
  vocab: Record<VocabKey, string[]>;
  refs: Partial<Record<RefSheet, RefResolver>>;
}

export interface ImportRow {
  /** Payload to send, with blanks omitted so zod defaults apply. */
  data: Record<string, unknown>;
  /** Non-fatal adjustments worth showing before the user commits. */
  warnings: string[];
  /** Set when the row cannot be imported at all. */
  error?: string;
}

/**
 * Turn one raw spreadsheet row into an API payload.
 *
 * Blank optional values are omitted rather than sent as '', because several
 * schema fields carry a `.default()` that only fires on `undefined`.
 */
export function buildImportRow(
  raw: Record<string, string>,
  spec: TransferSpec,
  mapping: Record<string, string | undefined>,
  ctx: TransferContext,
): ImportRow {
  const data: Record<string, unknown> = {};
  const warnings: string[] = [];
  let error: string | undefined;

  for (const col of spec.columns) {
    const header = mapping[col.key];
    const rawValue = (header ? raw[header] : '')?.trim() ?? '';

    if (col.ref) {
      if (!rawValue) continue; // required-ness is reported by zod downstream
      const resolved = ctx.refs[col.ref]?.resolve(rawValue);
      if (!resolved) {
        error ??= `No ${col.ref.toLowerCase()} named "${rawValue}". Import ${col.ref} records first, or correct the spelling.`;
        continue;
      }
      data[col.key] = resolved;
      continue;
    }

    if (col.type === 'boolean') {
      const v = rawValue.toLowerCase();
      if (!v) continue;
      if (TRUTHY.has(v)) data[col.key] = true;
      else if (FALSY.has(v)) data[col.key] = false;
      else {
        data[col.key] = false;
        warnings.push(`${col.label}: could not read "${rawValue}" as yes/no — treated as No`);
      }
      continue;
    }

    if (col.type === 'number') {
      if (!rawValue) continue;
      const n = Number(rawValue.replace(/[%\s,]/g, ''));
      if (Number.isNaN(n)) {
        warnings.push(`${col.label}: "${rawValue}" is not a number — left blank`);
        continue;
      }
      data[col.key] = n;
      continue;
    }

    if (col.vocab) {
      if (!rawValue) continue;
      const allowed = ctx.vocab[col.vocab] ?? [];
      const exact = allowed.find((a) => a === rawValue);
      if (exact) {
        data[col.key] = exact;
        continue;
      }
      const loose = allowed.find(
        (a) => normalizeHeader(a) === normalizeHeader(rawValue),
      );
      if (loose) {
        data[col.key] = loose;
        warnings.push(`${col.label}: "${rawValue}" matched "${loose}"`);
        continue;
      }
      // An unconfigured value is kept out of the payload so the schema default
      // applies, rather than writing a value no filter or badge can render.
      const fallback = allowed[0];
      if (fallback) {
        data[col.key] = fallback;
        warnings.push(
          `${col.label}: "${rawValue}" is not configured — used "${fallback}"`,
        );
      }
      continue;
    }

    if (rawValue) data[col.key] = rawValue;
  }

  return { data, warnings, error };
}

/** Render one record as the cell strings for its export row. */
export function buildExportRow(
  record: Record<string, unknown>,
  spec: TransferSpec,
  ctx: TransferContext,
): string[] {
  return spec.columns.map((col) => {
    const value = record[col.key];
    if (col.ref) {
      // Fall back to the raw id so a company deleted after the fact still
      // exports something traceable rather than an empty cell.
      return ctx.refs[col.ref]?.label(String(value ?? '')) ?? String(value ?? '');
    }
    if (col.type === 'boolean') return value ? 'Yes' : 'No';
    if (value == null) return '';
    return String(value);
  });
}

/** Header row plus a single example row, for the downloadable template. */
export function templateRows(spec: TransferSpec): { headers: string[]; rows: string[][] } {
  return {
    headers: spec.columns.map((c) => (c.required ? `${c.label}*` : c.label)),
    rows: [spec.columns.map((c) => c.example ?? '')],
  };
}
