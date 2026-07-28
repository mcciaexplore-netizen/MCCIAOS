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
import { Badge, Button, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useCompanies } from '@/hooks';
import { api } from '@/lib/api';
import { schemaForSheet } from '@/schemas';
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

interface PreparedRow extends ImportRow {
  /** 1-based row number in the user's file, for error messages. */
  line: number;
}

export function DataTransfer({ sheet }: { sheet: SheetName }) {
  const spec = TRANSFER_SPECS[sheet];
  const ctx = useTransferContext();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
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
      const raw = await readSpreadsheet(file);
      if (raw.length === 0) {
        toast('No data rows found in that file', 'error');
        return;
      }

      const headers = Object.keys(raw[0]);
      const mapping = matchHeaders(headers, spec.columns);
      const matched = new Set(Object.values(mapping).filter(Boolean));

      const rows: PreparedRow[] = raw.map((r, i) => {
        const built = buildImportRow(r, spec, mapping, ctx);
        if (built.error) return { ...built, line: i + 2 };
        // Same schema the server runs, so a row that passes here will insert.
        const parsed = schemaForSheet[sheet].safeParse(built.data);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = String(first.path[0] ?? '');
          const label = spec.columns.find((c) => c.key === field)?.label ?? field;
          return {
            ...built,
            line: i + 2,
            error: label ? `${label}: ${first.message}` : first.message,
          };
        }
        return { ...built, data: parsed.data as Record<string, unknown>, line: i + 2 };
      });

      setRecords(raw as Record<string, unknown>[]);
      setFileName(file.name);
      setUnmatched(headers.filter((h) => h && !matched.has(h)));
      setPrepared(rows);
    } catch (err) {
      toast((err as Error).message || 'Could not read that file', 'error');
    } finally {
      setBusy(false);
    }
  }

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
        const res = await api.bulk(sheet, chunk);
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
    setPrepared(null);
    setRecords([]);
    setUnmatched([]);
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
        open={prepared !== null}
        onClose={close}
        size="xl"
        title={`Import ${spec.label}`}
        description={fileName}
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
          raw={records}
          unmatched={unmatched}
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
  raw,
  unmatched,
}: {
  spec: TransferSpec;
  rows: PreparedRow[];
  raw: Record<string, unknown>[];
  unmatched: string[];
}) {
  const problems = rows.filter((r) => r.error);
  const warned = rows.filter((r) => !r.error && r.warnings.length > 0);
  const ok = rows.length - problems.length;

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
          {raw.length} row{raw.length === 1 ? '' : 's'} read
        </span>
      </div>

      {unmatched.length > 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60">
          Ignored column{unmatched.length === 1 ? '' : 's'}:{' '}
          <span className="font-medium">{unmatched.join(', ')}</span>. Rename to
          match a field, or leave as is.
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
