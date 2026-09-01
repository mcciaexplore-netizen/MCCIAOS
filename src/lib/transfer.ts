// Per-sheet import/export definitions.
//
// The files people actually have are not shaped like the database: they write
// "Image URL", not `imageUrl`. This module owns that translation in both
// directions so the pages and the API stay unchanged.
//
// Two things make an arbitrary spreadsheet importable:
//   1. Header matching is fuzzy      — "Image URL" / "imageUrl" / "IMAGE  URL" all hit.
//   2. Vocabularies snap             — "draft" becomes the configured "draft".
//
// A third rule, resolving cross-sheet references by name, went with the
// Companies module — no surviving column points at another record.

import type { SheetName } from '@/types';

// Settings keys holding a flat list of allowed values, as exposed by
// useSettings(). The toned vocabularies are read through their *Values views.
export type VocabKey =
  | 'teamMembers'
  | 'resourceCategories'
  | 'creativePlatforms'
  | 'creativeStatusValues';

export interface TransferColumn {
  /** Field name on the record. */
  key: string;
  /** Header written on export, and the primary name matched on import. */
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean';
  /** Constrain to a configurable vocabulary, snapping close matches. */
  vocab?: VocabKey;
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

export const TRANSFER_SPECS: Record<string, TransferSpec> = {
  Creative: {
    sheet: 'Creative',
    label: 'Creatives',
    filename: 'creatives',
    columns: [
      { key: 'platform', label: 'Channel', required: true, vocab: 'creativePlatforms', aliases: ['platform'], example: 'WhatsApp' },
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

// Cross-sheet id references (a Session pointing at a Company) went with the
// Companies module; every surviving column is a plain value or a vocabulary.
export interface TransferContext {
  vocab: Record<VocabKey, string[]>;
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
