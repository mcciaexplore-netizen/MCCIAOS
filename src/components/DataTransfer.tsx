// Import / Export controls, shared by every list page.
//
// Import is deliberately a two-step flow: the file is parsed and validated
// entirely in the browser, the result is shown, and nothing is written until
// the user confirms. Validation runs the same zod schema the server uses
// (@/schemas), so the preview cannot promise rows the API would then reject.

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { Badge, Button, Modal, Select } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useCompanies } from '@/hooks';
import { api } from '@/lib/api';
import { importSchemaForSheet } from '@/schemas';
import { useSettings } from '@/settings/SettingsContext';
import {
  TRANSFER_SPECS,
  buildExportRow,
  buildImportRow,
  matchHeaders,
  templateRows,
  type ImportRow,
  type TransferContext,
  type TransferSpec,
} from '@/lib/transfer';
import {
  IMPORT_ACCEPT,
  readSpreadsheet,
  writeSpreadsheet,
  type SpreadsheetFormat,
} from '@/lib/spreadsheet';
import type { SheetName } from '@/types';

// Rows per POST. The API inserts sequentially over the Neon HTTP driver, so a
// single large request would run past a serverless function's time limit;
// chunking also gives the progress counter something to report.
const CHUNK_SIZE = 40;

/**
 * POST one chunk, retrying a couple of times before giving up.
 *
 * Neon suspends an idle database and the first request after that can time out
 * connecting. Without a retry a single blip half way through a long import
 * leaves the sheet partly loaded, which is far more annoying to clean up than
 * waiting a second.
 */
async function sendChunk(
  sheet: SheetName,
  chunk: unknown[],
  attempts = 3,
): Promise<{ created: number; errors: unknown[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await api.bulk(sheet, chunk);
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

interface PreparedRow extends ImportRow {
  /** 1-based row number in the user's file, for error messages. */
  line: number;
}

/** The file as read, before any column has been assigned a meaning. */
interface Source {
  rows: Record<string, string>[];
  headers: string[];
  fileName: string;
}

export function DataTransfer({ sheet }: { sheet: SheetName }) {
  const spec = TRANSFER_SPECS[sheet];
  const ctx = useTransferContext();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  // Manual column choices, overriding the automatic match. Keyed by field name;
  // '' means "ignore this field" even if a header would have matched.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // Export reads straight from the API rather than a page's filtered view, so
  // "Export" always means the whole sheet regardless of active filters.
  async function handleExport(format: SpreadsheetFormat) {
    setExportOpen(false);
    setBusy(true);
    try {
      const { records: all } = await api.list<Record<string, unknown>>(sheet);
      await writeSpreadsheet({
        filename: `${spec.filename}-${new Date().toISOString().slice(0, 10)}`,
        headers: spec.columns.map((c) => c.label),
        rows: all.map((r) => buildExportRow(r, spec, ctx)),
        format,
        sheetName: spec.label,
      });
      toast(`Exported ${all.length} ${spec.label.toLowerCase()}`);
    } catch (err) {
      toast((err as Error).message || 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleTemplate(format: SpreadsheetFormat) {
    setExportOpen(false);
    const { headers, rows } = templateRows(spec);
    await writeSpreadsheet({
      filename: `${spec.filename}-template`,
      headers,
      rows,
      format,
      sheetName: spec.label,
    });
    toast('Template downloaded — required columns are marked *');
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    setBusy(true);
    try {
      const rows = await readSpreadsheet(file);
      if (rows.length === 0) {
        toast('No data rows found in that file', 'error');
        return;
      }
      // Headers come from the union of all rows, not just the first: a sheet
      // whose first row leaves trailing columns blank would otherwise hide them
      // from the mapping dropdowns.
      const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(Boolean);
      setOverrides({});
      setSource({ rows, headers, fileName: file.name });
    } catch (err) {
      toast((err as Error).message || 'Could not read that file', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Automatic match, then the user's manual choices on top. Recomputed as the
  // mapping changes so the preview and the error list stay live.
  const mapping = useMemo(() => {
    if (!source) return {};
    const m = matchHeaders(source.headers, spec.columns);
    for (const [key, header] of Object.entries(overrides)) {
      m[key] = header || undefined;
    }
    return m;
  }, [source, overrides, spec]);

  const prepared = useMemo<PreparedRow[] | null>(() => {
    if (!source) return null;
    return source.rows
      .map((r, i) => ({ built: buildImportRow(r, spec, mapping, ctx), line: i + 2 }))
      // A row whose mapped columns are all blank would insert a record holding
      // nothing but schema defaults, so drop it rather than report it — the
      // user did not ask to import an empty line.
      .filter(({ built }) => built.error || Object.keys(built.data).length > 0)
      .map(({ built, line }) => {
        if (built.error) return { ...built, line };
        // Lenient schema: blanks are kept as blanks rather than failing the
        // row. Same schema /api/bulk runs, so anything shown as ready inserts.
        const parsed = importSchemaForSheet[sheet].safeParse(built.data);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = String(first.path[0] ?? '');
          const label = spec.columns.find((c) => c.key === field)?.label ?? field;
          return {
            ...built,
            line,
            error: label ? `${label}: ${first.message}` : first.message,
          };
        }
        return { ...built, data: parsed.data as Record<string, unknown>, line };
      });
  }, [source, mapping, spec, ctx, sheet]);

  const unmatched = useMemo(() => {
    if (!source) return [];
    const used = new Set(Object.values(mapping).filter(Boolean));
    return source.headers.filter((h) => !used.has(h));
  }, [source, mapping]);

  const valid = useMemo(
    () => (prepared ?? []).filter((r) => !r.error),
    [prepared],
  );

  async function commit() {
    if (valid.length === 0) return;
    setBusy(true);
    setProgress(0);
    let created = 0;
    try {
      for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
        const chunk = valid.slice(i, i + CHUNK_SIZE).map((r) => r.data);
        const res = await sendChunk(sheet, chunk);
        created += res.created;
        setProgress(Math.min(i + CHUNK_SIZE, valid.length));
      }
      toast(
        `Imported ${created} of ${prepared?.length ?? 0} rows`,
        created ? 'success' : 'error',
      );
      close();
    } catch (err) {
      toast(
        `Import stopped after ${created} rows: ${(err as Error).message}`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setSource(null);
    setOverrides({});
    setProgress(0);
  }

  const skipped = (prepared?.length ?? 0) - valid.length;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-4 w-4" /> Import
      </Button>

      <div className="relative">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setExportOpen((o) => !o)}
        >
          <Download className="h-4 w-4" /> Export
        </Button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <MenuItem onClick={() => handleExport('xlsx')}>
                <FileSpreadsheet className="h-4 w-4" /> Excel (.xlsx)
              </MenuItem>
              <MenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="h-4 w-4" /> CSV
              </MenuItem>
              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
              <MenuItem onClick={() => handleTemplate('xlsx')}>
                <Download className="h-4 w-4" /> Blank template
              </MenuItem>
            </div>
          </>
        )}
      </div>

      <Modal
        open={source !== null}
        onClose={close}
        size="xl"
        title={`Import ${spec.label}`}
        description={source?.fileName}
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {busy && progress > 0
                ? `Importing ${progress} of ${valid.length}...`
                : `${valid.length} ready${skipped > 0 ? `, ${skipped} skipped` : ''}`}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={commit} disabled={busy || valid.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {valid.length} row{valid.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        }
      >
        <ImportPreview
          spec={spec}
          rows={prepared ?? []}
          rowCount={source?.rows.length ?? 0}
          headers={source?.headers ?? []}
          mapping={mapping}
          unmatched={unmatched}
          onMap={(key, header) =>
            setOverrides((o) => ({ ...o, [key]: header }))
          }
        />
      </Modal>
    </>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {children}
    </button>
  );
}

const PREVIEW_LIMIT = 6;

function ImportPreview({
  spec,
  rows,
  rowCount,
  headers,
  mapping,
  unmatched,
  onMap,
}: {
  spec: TransferSpec;
  rows: PreparedRow[];
  rowCount: number;
  headers: string[];
  mapping: Record<string, string | undefined>;
  unmatched: string[];
  onMap: (key: string, header: string) => void;
}) {
  const problems = rows.filter((r) => r.error);
  const warned = rows.filter((r) => !r.error && r.warnings.length > 0);
  const ok = rows.length - problems.length;

  const missingRequired = spec.columns.filter((c) => c.required && !mapping[c.key]);
  // Opened automatically when a required field has nowhere to read from —
  // that is the one case the user cannot import their way out of.
  const [mapOpen, setMapOpen] = useState(missingRequired.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="green">
          <Check className="h-3 w-3" /> {ok} ready
        </Badge>
        {problems.length > 0 && (
          <Badge tone="rose">
            <AlertTriangle className="h-3 w-3" /> {problems.length} cannot import
          </Badge>
        )}
        {warned.length > 0 && (
          <Badge tone="amber">{warned.length} adjusted</Badge>
        )}
        <span className="text-xs text-slate-400">
          {rowCount} row{rowCount === 1 ? '' : 's'} read
        </span>
        <button
          onClick={() => setMapOpen((o) => !o)}
          className="ml-auto text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {mapOpen ? 'Hide' : 'Change'} column mapping
        </button>
      </div>

      {missingRequired.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          No column matched{' '}
          <span className="font-medium">
            {missingRequired.map((c) => c.label).join(', ')}
          </span>
          . Those will be imported blank — pick a column below if that is wrong.
        </p>
      )}

      {mapOpen && (
        <ColumnMapper
          spec={spec}
          headers={headers}
          mapping={mapping}
          onMap={onMap}
        />
      )}

      {!mapOpen && unmatched.length > 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60">
          Ignored column{unmatched.length === 1 ? '' : 's'}:{' '}
          <span className="font-medium">{unmatched.join(', ')}</span>. Use
          &ldquo;Change column mapping&rdquo; to bring one in.
        </p>
      )}

      {ok > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60">
              <tr>
                {spec.columns.slice(0, 6).map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows
                .filter((r) => !r.error)
                .slice(0, PREVIEW_LIMIT)
                .map((r) => (
                  <tr key={r.line}>
                    {spec.columns.slice(0, 6).map((c) => (
                      <td
                        key={c.key}
                        className="max-w-[12rem] truncate px-3 py-2 text-slate-600 dark:text-slate-300"
                      >
                        {formatCell(r.data[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {ok > PREVIEW_LIMIT && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">
              + {ok - PREVIEW_LIMIT} more
            </p>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <IssueList
          tone="rose"
          title="These rows will be skipped"
          items={problems.map((r) => `Row ${r.line} — ${r.error}`)}
        />
      )}

      {warned.length > 0 && (
        <IssueList
          tone="amber"
          title="Adjusted to fit your configured options"
          items={warned.flatMap((r) =>
            r.warnings.map((w) => `Row ${r.line} — ${w}`),
          )}
        />
      )}
    </div>
  );
}

/**
 * Lets the user point any field at any column in their file. This is the
 * escape hatch that makes an unseen sheet layout importable without waiting
 * for a new alias to be added to the spec.
 */
function ColumnMapper({
  spec,
  headers,
  mapping,
  onMap,
}: {
  spec: TransferSpec;
  headers: string[];
  mapping: Record<string, string | undefined>;
  onMap: (key: string, header: string) => void;
}) {
  // A header feeding two fields at once is almost always a mistake, so flag it
  // rather than silently importing the same value into both.
  const used = Object.values(mapping).filter(Boolean) as string[];
  const duplicated = new Set(used.filter((h, i) => used.indexOf(h) !== i));

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="mb-2 text-xs text-slate-500">
        Match each field to a column from your file.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {spec.columns.map((c) => {
          const value = mapping[c.key] ?? '';
          return (
            <label key={c.key} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">
                {c.label}
                {c.required && <span className="text-rose-500">*</span>}
              </span>
              <Select
                value={value}
                onChange={(e) => onMap(c.key, e.target.value)}
                className={
                  'py-1 text-xs ' +
                  (c.required && !value
                    ? 'border-rose-300 dark:border-rose-800'
                    : duplicated.has(value)
                      ? 'border-amber-300 dark:border-amber-800'
                      : '')
                }
              >
                <option value="">— not imported —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </label>
          );
        })}
      </div>
      {duplicated.size > 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {[...duplicated].join(', ')} feeds more than one field.
        </p>
      )}
    </div>
  );
}

const ISSUE_LIMIT = 8;

function IssueList({
  tone,
  title,
  items,
}: {
  tone: 'rose' | 'amber';
  title: string;
  items: string[];
}) {
  return (
    <div
      className={
        tone === 'rose'
          ? 'rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900 dark:bg-rose-950/20'
          : 'rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20'
      }
    >
      <p
        className={
          tone === 'rose'
            ? 'text-xs font-medium text-rose-700 dark:text-rose-300'
            : 'text-xs font-medium text-amber-700 dark:text-amber-300'
        }
      >
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.slice(0, ISSUE_LIMIT).map((t, i) => (
          <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
            {t}
          </li>
        ))}
        {items.length > ISSUE_LIMIT && (
          <li className="text-xs text-slate-400">
            + {items.length - ISSUE_LIMIT} more
          </li>
        )}
      </ul>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Vocabularies and reference lookups the coercion step needs. Companies are
 * indexed by normalised name so "acme traders" resolves to "Acme Traders".
 */
function useTransferContext(): TransferContext {
  const settings = useSettings();
  const { items: companies } = useCompanies();

  return useMemo(() => {
    const byId = new Map(companies.map((c) => [c.id, c.companyName]));
    const byName = new Map(
      companies.map((c) => [c.companyName.trim().toLowerCase(), c.id]),
    );

    return {
      vocab: {
        teamMembers: settings.teamMembers,
        leadSources: settings.leadSources,
        businessScales: settings.businessScales,
        membershipStatuses: settings.membershipStatuses,
        resourceCategories: settings.resourceCategories,
        creativePlatforms: settings.creativePlatforms,
        projectStageValues: settings.projectStageValues,
        companyStatusValues: settings.companyStatusValues,
        sessionStatusValues: settings.sessionStatusValues,
        creativeStatusValues: settings.creativeStatusValues,
      },
      refs: {
        Company: {
          label: (id) => byId.get(id),
          // An exported file round-trips ids, so accept those before names.
          resolve: (text) =>
            byId.has(text) ? text : byName.get(text.trim().toLowerCase()),
        },
      },
    };
  }, [settings, companies]);
}
