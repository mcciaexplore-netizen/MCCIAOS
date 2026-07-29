// Minimal delimited-text read/write. Handles quoted fields, embedded
// delimiters, quotes, and newlines.
//
// Excel (.xlsx) support and file-type sniffing live in ./spreadsheet, which
// builds on the pieces here.

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (val: unknown) => {
    const s = val == null ? '' : String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => escape(r[c])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

/** Split delimited text into a raw grid of cells, honouring quoted fields. */
export function splitDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  // A leading BOM survives Excel's "CSV UTF-8" export and would otherwise
  // become part of the first header name, breaking that column's mapping.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Map a raw grid onto its header row. Blank rows are dropped, cells are
 * trimmed, and unnamed columns are ignored.
 */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}

export function parseDelimited(
  text: string,
  delimiter = ',',
): Record<string, string>[] {
  return rowsToObjects(splitDelimited(text, delimiter));
}

export const parseCsv = (text: string) => parseDelimited(text, ',');

// NOTE: the browser download helper used to live here, but this module is now
// also compiled for the server (server/reports.ts reuses toCsv), where there is
// no `document`. Everything above is pure string work; the DOM half moved to
// ./spreadsheet, which is browser-only by design.
