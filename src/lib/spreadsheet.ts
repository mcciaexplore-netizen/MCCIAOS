// Format layer for import/export: turns a user's file into header-keyed rows,
// and turns rows back into a downloadable CSV or Excel file.
//
// CSV parsing/serialising lives in ./csv — this module adds Excel (.xlsx) and
// tab-separated input (what you get pasting straight out of Google Sheets),
// then normalises every backend to the same `Record<string, string>` shape so
// the rest of the import pipeline never branches on file type.
//
// Both Excel libraries are loaded with dynamic import(). They are by far the
// heaviest thing this app depends on, and a user who never touches Import or
// Export should never pay for them, so they stay out of the initial bundle.

import { parseDelimited, rowsToObjects, toCsv } from './csv';

export type SpreadsheetFormat = 'csv' | 'xlsx';

export const EXCEL_RE = /\.xlsx$/i;
const TSV_RE = /\.tsv$/i;
// Excel's own legacy .xls is a completely different (binary) format that
// read-excel-file cannot open. Naming it here lets us reject it with an
// instruction instead of a parser stack trace.
const LEGACY_XLS_RE = /\.xls$/i;

export const IMPORT_ACCEPT = '.csv,.tsv,.txt,.xlsx';

/** Cell values arrive typed from Excel; the import pipeline wants strings. */
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    // Date-typed cells must survive as the ISO day the app stores, not as a
    // locale string — dates are compared and sorted as text elsewhere.
    //
    // Excel stores a date as a timezone-less serial number, and the parser
    // hands it back as UTC midnight for that day. Reading UTC parts is
    // therefore the only correct extraction: local parts agree in IST only
    // because it is ahead of UTC, and would report the previous day for
    // anyone running west of it.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}

/**
 * Read any supported file into header-keyed rows. Blank rows are dropped and
 * every value is trimmed, matching parseCsv's existing contract.
 */
export async function readSpreadsheet(
  file: File,
): Promise<Record<string, string>[]> {
  if (LEGACY_XLS_RE.test(file.name)) {
    throw new Error(
      'Old .xls files are not supported. Open the file in Excel and use ' +
        'File → Save As → Excel Workbook (.xlsx), or save it as CSV.',
    );
  }

  if (EXCEL_RE.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = (await readSheet(file)) as unknown[][];
    return rowsToObjects(rows.map((r) => r.map(cellToString)));
  }

  const text = await file.text();
  // Google Sheets copy-paste and .tsv exports are tab-separated. Sniff the
  // header line rather than trusting the extension, because a "CSV" exported
  // from some tools is really tab-delimited.
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || undefined);
  const delimiter =
    TSV_RE.test(file.name) ||
    (firstLine.includes('\t') && !firstLine.includes(','))
      ? '\t'
      : ',';
  return parseDelimited(text, delimiter);
}

export interface WriteOptions {
  filename: string;
  /** Column headers, in order. */
  headers: string[];
  /** One array of cell strings per row, aligned to `headers`. */
  rows: string[][];
  format: SpreadsheetFormat;
  /** Sheet tab name for Excel output. */
  sheetName?: string;
}

export async function writeSpreadsheet({
  filename,
  headers,
  rows,
  format,
  sheetName = 'Data',
}: WriteOptions): Promise<void> {
  if (format === 'csv') {
    const objects = rows.map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])),
    );
    download(`${filename}.csv`, toCsv(objects, headers));
    return;
  }

  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  // Everything is written as text on purpose. Excel would otherwise coerce a
  // phone number or a UDYAM number to a number and silently drop leading
  // zeroes — the exported file has to survive a round trip back through
  // Import without mutating the data.
  const data = [
    headers.map((h) => ({ value: h, type: String, fontWeight: 'bold' as const })),
    ...rows.map((r) => headers.map((_, i) => ({ value: r[i] ?? '', type: String }))),
  ];

  const blob = await writeXlsxFile(data, {
    sheet: sheetName,
    stickyRowsCount: 1,
    columns: headers.map((h) => ({ width: Math.min(Math.max(h.length + 6, 14), 42) })),
  }).toBlob();

  downloadBlob(`${filename}.xlsx`, blob);
}

/**
 * Trigger a browser download of text content. Lives here rather than in ./csv
 * because that module is also compiled for the server, where `document` does
 * not exist.
 */
export function download(filename: string, content: string, type = 'text/csv') {
  // Excel on Windows assumes the system codepage for a plain CSV, which
  // mangles any non-ASCII company name. A BOM makes it read UTF-8.
  downloadBlob(
    filename,
    new Blob([type.startsWith('text/csv') ? '﻿' : '', content], { type }),
  );
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
