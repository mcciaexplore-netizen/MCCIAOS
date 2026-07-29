// Server-side report generation: CSV, Excel and a branded PDF.
//
// Everything is produced in the function and returned as bytes, so the route
// can stream it straight out with a Content-Disposition filename. Nothing is
// rendered on the client.
//
// CSV reuses src/lib/csv.ts rather than growing a second serialiser, and Excel
// uses write-excel-file, which the import/export feature already depends on.
// PDF needed a new dependency (pdfkit) — the project had nothing equivalent.

import PDFDocument from 'pdfkit';
import writeXlsxFile from 'write-excel-file/node';
import { toCsv } from '../src/lib/csv.js';
import {
  getBreakdown,
  getLineItems,
  getSummary,
  getTimeseries,
  type ActivityRow,
  type BreakdownRow,
  type MetricSummary,
  type PeriodInput,
  type SummaryResult,
} from './analytics.js';

export type ReportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ReportFile {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

// ---- Brand ----------------------------------------------------------------
const NAVY = '#0B1F3A';
const FOREST = '#2E8B57';
const AMBER = '#E8A33D';
const INK = '#1F2937';
const MUTED = '#6B7280';
const RULE = '#D8DEE7';

const CONTACT = 'aistudio@mcciapune.com  |  +91 88558 85290';

// FONTS. The brief asks for DM Serif Display and Outfit. Neither is bundled
// with the app and pdfkit can only embed a font file it can read from disk, so
// rather than commit binaries this falls back — as the brief permits — to the
// standard PDF families: a serif for headings, which is what DM Serif Display
// is, and a clean sans for body text in place of Outfit. If the .ttf files are
// ever added under server/fonts, register them here and the layout is unchanged.
const FONT_HEAD = 'Times-Bold';
const FONT_HEAD_REG = 'Times-Roman';
const FONT_BODY = 'Helvetica';
const FONT_BODY_BOLD = 'Helvetica-Bold';

/** IST timestamp for the report header — never the server's local time. */
function istStamp(d = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function istDateOnly(d = new Date()): string {
  // en-CA gives YYYY-MM-DD, which is what the filename wants.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

const periodLabel = (s: SummaryResult) =>
  s.from === s.to ? s.from : `${s.from} to ${s.to}`;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const changeText = (m: { delta: number; percentChange: number | null }) =>
  m.percentChange === null
    ? `${signed(m.delta)} (no prior activity)`
    : `${signed(m.delta)} (${signed(m.percentChange)}%)`;

// ---------------------------------------------------------------------------
export async function buildReport(
  format: ReportFormat,
  period: PeriodInput,
): Promise<ReportFile> {
  const stamp = istDateOnly();
  const base = `MCCIA-Analytics-${stamp}`;

  if (format === 'csv') {
    const rows = await getLineItems(period);
    return {
      bytes: new TextEncoder().encode(lineItemCsv(rows)),
      filename: `${base}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  if (format === 'xlsx') {
    return {
      bytes: await buildXlsx(period),
      filename: `${base}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  return {
    bytes: await buildPdf(period),
    filename: `${base}.pdf`,
    contentType: 'application/pdf',
  };
}

// ---- CSV ------------------------------------------------------------------
const CSV_COLUMNS = ['Type', 'Company', 'Date (IST)', 'Consultant', 'Status', 'Detail'];

function lineItemCsv(rows: ActivityRow[]): string {
  const shaped = rows.map((r) => ({
    Type: r.kind === 'consultation' ? 'Consultation' : 'Application Setup',
    Company: r.company ?? '',
    'Date (IST)': r.date,
    Consultant: r.consultant ?? '',
    Status: r.status ?? '',
    Detail: r.title ?? '',
  }));
  // A BOM keeps Excel on Windows from mangling non-ASCII company names.
  return '﻿' + toCsv(shaped, CSV_COLUMNS);
}

// ---- Everything the report needs, gathered once ---------------------------
async function gather(period: PeriodInput) {
  const [summary, cSeries, sSeries, items, sector, consultant, cStatus, appType] =
    await Promise.all([
      getSummary(period),
      getTimeseries('consultations', 'day', 30),
      getTimeseries('setups', 'day', 30),
      getLineItems(period),
      getBreakdown('consultations', 'sector', period),
      getBreakdown('consultations', 'consultant', period),
      getBreakdown('consultations', 'status', period),
      getBreakdown('setups', 'type', period),
    ]);
  return { summary, cSeries, sSeries, items, sector, consultant, cStatus, appType };
}

// ---- Excel ----------------------------------------------------------------
type Cell = { value?: string | number | Date; type?: unknown; fontWeight?: 'bold' };

const head = (t: string): Cell => ({ value: t, type: String, fontWeight: 'bold' });
const txt = (v?: string | null): Cell => ({ value: v ?? '', type: String });
const num = (v: number): Cell => ({ value: v, type: Number });

/** Column widths sized to the longest cell, which is the practical auto-fit. */
function widths(rows: Cell[][]): { width: number }[] {
  const out: number[] = [];
  for (const row of rows) {
    row.forEach((c, i) => {
      const len = String(c?.value ?? '').length;
      out[i] = Math.max(out[i] ?? 10, Math.min(len + 4, 55));
    });
  }
  return out.map((w) => ({ width: w }));
}

function breakdownSheet(title: string, rows: BreakdownRow[]): Cell[][] {
  return [
    [head(title), head('Count'), head('% of total')],
    ...rows.map((r) => [txt(r.label), num(r.count), num(r.percent)]),
  ];
}

function metricRows(label: string, m: MetricSummary): Cell[][] {
  return [
    [txt(label), txt(''), txt('')],
    [txt('  Total'), num(m.total), txt('')],
    [txt('  Previous period'), num(m.previous), txt('')],
    [txt('  Change'), num(m.delta), txt(m.percentChange === null ? 'n/a' : `${m.percentChange}%`)],
    [txt('  Unique companies'), num(m.uniqueCompanies), txt('')],
    [txt('  New companies'), num(m.newCompanies), txt('')],
    [txt('  Repeat companies'), num(m.repeatCompanies), txt('')],
  ];
}

async function buildXlsx(period: PeriodInput): Promise<Uint8Array> {
  const d = await gather(period);
  const s = d.summary;

  const summarySheet: Cell[][] = [
    [head('MCCIA Applied AI Studio — Analytics')],
    [txt('Period'), txt(periodLabel(s))],
    [txt('Timezone'), txt(s.timezone)],
    [txt('Generated'), txt(istStamp())],
    [],
    [head('Metric'), head('Value'), head('Note')],
    ...metricRows('Consultations', s.consultations),
    ...metricRows('Application setups', s.setups),
    [txt('  Delivered'), num(s.setups.delivered), txt('')],
    [txt('  In progress'), num(s.setups.inProgress), txt('')],
    [
      txt('  Avg days consultation → setup'),
      s.setups.avgDaysConsultationToSetup === null
        ? txt('n/a')
        : num(s.setups.avgDaysConsultationToSetup),
      txt(`${s.setups.linkableSetups} linkable`),
    ],
  ];

  // Dates go in as real Date values so Excel sorts and formats them as dates
  // rather than as text that merely looks like one.
  const itemRows = (kind: ActivityRow['kind']): Cell[][] => [
    [head('Company'), head('Date (IST)'), head('Consultant'), head('Status'), head('Detail')],
    ...d.items
      .filter((r) => r.kind === kind)
      .map((r) => [
        txt(r.company),
        { value: new Date(`${r.date.replace(' ', 'T')}:00+05:30`), type: Date, format: 'yyyy-mm-dd hh:mm' } as Cell,
        txt(r.consultant),
        txt(r.status),
        txt(r.title),
      ]),
  ];

  const consultations = itemRows('consultation');
  const setups = itemRows('setup');
  const breakdowns: Cell[][] = [
    ...breakdownSheet('Sector', d.sector),
    [],
    ...breakdownSheet('Consultant', d.consultant),
    [],
    ...breakdownSheet('Consultation status', d.cStatus),
    [],
    ...breakdownSheet('Application type', d.appType),
  ];

  // Multi-sheet takes one object per sheet, each carrying its own tab name,
  // column widths and frozen-row count.
  const sheets = [
    { sheet: 'Summary', data: summarySheet },
    { sheet: 'Consultations', data: consultations },
    { sheet: 'Setups', data: setups },
    { sheet: 'Breakdowns', data: breakdowns },
  ].map((x) => ({
    ...x,
    columns: widths(x.data),
    stickyRowsCount: 1,
  }));

  const buffer = await writeXlsxFile(sheets as never).toBuffer();
  return new Uint8Array(buffer);
}

// ---- PDF ------------------------------------------------------------------
const PAGE_MARGIN = 48;

async function buildPdf(period: PeriodInput): Promise<Uint8Array> {
  const d = await gather(period);
  const s = d.summary;

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    // Required so page numbers can be stamped after the total is known.
    bufferPages: true,
    info: {
      Title: `MCCIA Analytics ${periodLabel(s)}`,
      Author: 'MCCIA Applied AI Studio',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  const W = doc.page.width - PAGE_MARGIN * 2;

  // --- Cover header
  doc.rect(0, 0, doc.page.width, 104).fill(NAVY);
  doc
    .font(FONT_HEAD)
    .fontSize(22)
    .fillColor('#FFFFFF')
    .text('MCCIA Applied AI Studio', PAGE_MARGIN, 30);
  doc
    .font(FONT_BODY)
    .fontSize(11)
    .fillColor('#C7D2E0')
    .text('Analytics & Reporting', PAGE_MARGIN, 60);
  doc.fontSize(9).fillColor('#9FB3C8')
    .text(`Period ${periodLabel(s)}  ·  generated ${istStamp()} IST`, PAGE_MARGIN, 78);
  doc.y = 132;

  // --- Executive summary
  sectionTitle(doc, 'Executive summary');
  const cards: [string, MetricSummary][] = [
    ['Consultations', s.consultations],
    ['Application setups', s.setups],
  ];
  const cardW = (W - 16) / 2;
  const cardY = doc.y;
  cards.forEach(([label, m], i) => {
    const x = PAGE_MARGIN + i * (cardW + 16);
    doc.roundedRect(x, cardY, cardW, 76, 6).fill('#F4F6F9');
    doc.font(FONT_BODY).fontSize(9).fillColor(MUTED).text(label.toUpperCase(), x + 14, cardY + 12);
    doc.font(FONT_HEAD).fontSize(26).fillColor(NAVY).text(String(m.total), x + 14, cardY + 26);
    doc
      .font(FONT_BODY)
      .fontSize(9)
      .fillColor(m.delta >= 0 ? FOREST : '#B3261E')
      .text(`${changeText(m)} vs previous period`, x + 14, cardY + 58);
  });
  doc.y = cardY + 92;

  para(
    doc,
    `${s.consultations.uniqueCompanies} companies took part in consultations ` +
      `(${s.consultations.newCompanies} new, ${s.consultations.repeatCompanies} returning). ` +
      `${s.setups.delivered} of ${s.setups.total} application setups reached a delivered stage` +
      (s.setups.avgDaysConsultationToSetup === null
        ? '.'
        : `, averaging ${s.setups.avgDaysConsultationToSetup} days from first consultation to setup ` +
          `across ${s.setups.linkableSetups} linkable records.`),
  );

  // --- Consultations
  sectionTitle(doc, 'Consultations');
  statLine(doc, [
    ['Total', String(s.consultations.total)],
    ['vs previous', changeText(s.consultations)],
    ['Companies', String(s.consultations.uniqueCompanies)],
    ['New / repeat', `${s.consultations.newCompanies} / ${s.consultations.repeatCompanies}`],
  ]);
  barChart(doc, d.cSeries, 'Daily consultations, last 30 days', FOREST);
  statusTable(doc, 'Status split', s.consultations.statuses);
  breakdownTable(doc, 'By sector', d.sector);
  breakdownTable(doc, 'By consultant', d.consultant);

  // --- Setups
  doc.addPage();
  sectionTitle(doc, 'Application setups');
  statLine(doc, [
    ['Total', String(s.setups.total)],
    ['vs previous', changeText(s.setups)],
    ['Delivered', String(s.setups.delivered)],
    ['In progress', String(s.setups.inProgress)],
  ]);
  barChart(doc, d.sSeries, 'Daily application setups, last 30 days', AMBER);
  statusTable(doc, 'Stage split', s.setups.statuses);
  breakdownTable(doc, 'By application type', d.appType);

  // --- Appendix
  doc.addPage();
  sectionTitle(doc, 'Appendix — all records in period');
  lineItemTable(doc, d.items);

  stampPages(doc);
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

type Doc = InstanceType<typeof PDFDocument>;

/** Start a new page when less than `needed` vertical space remains. */
function ensureRoom(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - 28) doc.addPage();
}

function sectionTitle(doc: Doc, text: string) {
  ensureRoom(doc, 60);
  doc.moveDown(0.4);
  doc.font(FONT_HEAD).fontSize(15).fillColor(NAVY).text(text, PAGE_MARGIN, doc.y);
  const y = doc.y + 4;
  doc.moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).lineWidth(1).stroke(AMBER);
  doc.y = y + 10;
}

function para(doc: Doc, text: string) {
  ensureRoom(doc, 50);
  doc
    .font(FONT_BODY)
    .fontSize(10)
    .fillColor(INK)
    .text(text, PAGE_MARGIN, doc.y, {
      width: doc.page.width - PAGE_MARGIN * 2,
      align: 'left',
      lineGap: 2,
    });
  doc.moveDown(0.6);
}

function statLine(doc: Doc, pairs: [string, string][]) {
  ensureRoom(doc, 44);
  const W = doc.page.width - PAGE_MARGIN * 2;
  const colW = W / pairs.length;
  const y = doc.y;
  pairs.forEach(([k, v], i) => {
    const x = PAGE_MARGIN + i * colW;
    doc.font(FONT_BODY).fontSize(8).fillColor(MUTED).text(k.toUpperCase(), x, y);
    doc.font(FONT_BODY_BOLD).fontSize(12).fillColor(INK).text(v, x, y + 12);
  });
  doc.y = y + 38;
}

/**
 * Bars are drawn as plain vectors rather than an embedded image, so the chart
 * stays sharp at any zoom and adds no raster weight to the file.
 */
function barChart(
  doc: Doc,
  points: { bucket: string; count: number }[],
  caption: string,
  color: string,
) {
  const H = 96;
  ensureRoom(doc, H + 46);
  const W = doc.page.width - PAGE_MARGIN * 2;
  const top = doc.y;

  doc.font(FONT_BODY).fontSize(9).fillColor(MUTED).text(caption, PAGE_MARGIN, top);
  const chartTop = top + 14;
  const max = Math.max(1, ...points.map((p) => p.count));

  if (points.every((p) => p.count === 0)) {
    doc.font(FONT_BODY).fontSize(9).fillColor(MUTED)
      .text('No activity in this window.', PAGE_MARGIN, chartTop + H / 2 - 6);
    doc.y = chartTop + H + 14;
    return;
  }

  const gap = 2;
  const barW = Math.max(1, (W - gap * (points.length - 1)) / points.length);
  points.forEach((p, i) => {
    const h = (p.count / max) * H;
    const x = PAGE_MARGIN + i * (barW + gap);
    doc.rect(x, chartTop + H - h, barW, Math.max(h, p.count > 0 ? 1.2 : 0)).fill(color);
  });

  // Baseline plus first/last date and the peak, which is all the axis a chart
  // this small can carry legibly.
  doc.moveTo(PAGE_MARGIN, chartTop + H).lineTo(PAGE_MARGIN + W, chartTop + H).lineWidth(0.6).stroke(RULE);
  doc.font(FONT_BODY).fontSize(7).fillColor(MUTED);
  doc.text(points[0]?.bucket ?? '', PAGE_MARGIN, chartTop + H + 4);
  doc.text(points[points.length - 1]?.bucket ?? '', PAGE_MARGIN, chartTop + H + 4, {
    width: W,
    align: 'right',
  });
  doc.text(`peak ${max}`, PAGE_MARGIN, chartTop - 10, { width: W, align: 'right' });
  doc.y = chartTop + H + 20;
}

function tableHeader(doc: Doc, cols: { label: string; w: number; align?: 'right' }[]) {
  const y = doc.y;
  doc.rect(PAGE_MARGIN, y - 3, doc.page.width - PAGE_MARGIN * 2, 17).fill('#F4F6F9');
  let x = PAGE_MARGIN + 6;
  doc.font(FONT_BODY_BOLD).fontSize(8).fillColor(NAVY);
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x, y + 1, { width: c.w - 8, align: c.align ?? 'left' });
    x += c.w;
  }
  doc.y = y + 18;
}

function tableRow(doc: Doc, cols: { w: number; align?: 'right' }[], cells: string[]) {
  const y = doc.y;
  let x = PAGE_MARGIN + 6;
  doc.font(FONT_BODY).fontSize(9).fillColor(INK);
  cells.forEach((c, i) => {
    doc.text(c, x, y, {
      width: cols[i].w - 8,
      align: cols[i].align ?? 'left',
      ellipsis: true,
      lineBreak: false,
    });
    x += cols[i].w;
  });
  doc.y = y + 14;
  doc.moveTo(PAGE_MARGIN, doc.y - 3).lineTo(doc.page.width - PAGE_MARGIN, doc.y - 3)
    .lineWidth(0.4).stroke('#EEF1F5');
}

function emptyNote(doc: Doc, what: string) {
  doc.font(FONT_BODY).fontSize(9).fillColor(MUTED).text(what, PAGE_MARGIN, doc.y);
  doc.y += 18;
}

function subTitle(doc: Doc, text: string) {
  ensureRoom(doc, 56);
  doc.font(FONT_BODY_BOLD).fontSize(10).fillColor(INK).text(text, PAGE_MARGIN, doc.y);
  doc.y += 6;
}

function statusTable(doc: Doc, title: string, rows: BreakdownRow[]) {
  subTitle(doc, title);
  if (rows.length === 0) return emptyNote(doc, 'No records in this period.');
  breakdownBody(doc, rows);
}

function breakdownTable(doc: Doc, title: string, rows: BreakdownRow[]) {
  subTitle(doc, title);
  if (rows.length === 0) return emptyNote(doc, 'No records in this period.');
  breakdownBody(doc, rows);
}

function breakdownBody(doc: Doc, rows: BreakdownRow[]) {
  const W = doc.page.width - PAGE_MARGIN * 2;
  const cols = [
    { label: 'Label', w: W - 150 },
    { label: 'Count', w: 70, align: 'right' as const },
    { label: '% of total', w: 80, align: 'right' as const },
  ];
  ensureRoom(doc, 40);
  tableHeader(doc, cols);
  for (const r of rows) {
    ensureRoom(doc, 20);
    tableRow(doc, cols, [r.label, String(r.count), `${r.percent}%`]);
  }
  doc.y += 8;
}

function lineItemTable(doc: Doc, items: ActivityRow[]) {
  if (items.length === 0) return emptyNote(doc, 'No records in this period.');
  const W = doc.page.width - PAGE_MARGIN * 2;
  const cols = [
    { label: 'Type', w: 70 },
    { label: 'Company', w: W - 330 },
    { label: 'Date (IST)', w: 100 },
    { label: 'Consultant', w: 80 },
    { label: 'Status', w: 80 },
  ];
  tableHeader(doc, cols);
  for (const r of items) {
    if (doc.y + 20 > doc.page.height - PAGE_MARGIN - 28) {
      doc.addPage();
      tableHeader(doc, cols);
    }
    tableRow(doc, cols, [
      r.kind === 'consultation' ? 'Consult' : 'Setup',
      r.company ?? '—',
      r.date,
      r.consultant ?? '—',
      r.status ?? '—',
    ]);
  }
}

/** Footer and "Page n of m" on every page, once the total is known. */
function stampPages(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - PAGE_MARGIN + 6;
    // The footer sits below the bottom margin, and pdfkit auto-appends a page
    // whenever text crosses that margin — which silently doubled the document
    // and left half of it unstamped. Drop the margin for the write, restore
    // it after, so the footer lands on the page it belongs to.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(PAGE_MARGIN, y - 8).lineTo(doc.page.width - PAGE_MARGIN, y - 8)
      .lineWidth(0.5).stroke(RULE);
    doc.font(FONT_BODY).fontSize(8).fillColor(MUTED)
      .text(CONTACT, PAGE_MARGIN, y, { lineBreak: false });
    doc.font(FONT_HEAD_REG).fontSize(8).fillColor(MUTED)
      .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, y, {
        width: doc.page.width - PAGE_MARGIN * 2,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}
