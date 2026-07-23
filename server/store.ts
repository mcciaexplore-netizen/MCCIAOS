// Records store. Uses a local JSON file for zero-setup local dev. When
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present, swap this module's
// internals for a Supabase client hitting the single `records` table
// described in BACKEND_SCHEMA.md — the exported interface stays identical.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SheetName =
  | 'Company'
  | 'Session'
  | 'Followup'
  | 'Project'
  | 'Creative'
  | 'Resource'
  | 'Settings';

export const SHEET_ALLOWLIST: SheetName[] = [
  'Company',
  'Session',
  'Followup',
  'Project',
  'Creative',
  'Resource',
  'Settings',
];

export interface StoredRecord {
  id: string;
  sheet: SheetName;
  assignedTo: string | null;
  createdBy: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const DATA_FILE = resolve(DATA_DIR, 'records.json');

let cache: StoredRecord[] | null = null;

function load(): StoredRecord[] {
  if (cache) return cache;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    cache = seed();
    persist();
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as StoredRecord[];
  } catch {
    cache = seed();
    persist();
  }
  return cache!;
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(cache ?? [], null, 2), 'utf-8');
}

export function isValidSheet(sheet: string): sheet is SheetName {
  return (SHEET_ALLOWLIST as string[]).includes(sheet);
}

export function listBySheet(sheet: SheetName): StoredRecord[] {
  return load()
    .filter((r) => r.sheet === sheet)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getById(id: string): StoredRecord | undefined {
  return load().find((r) => r.id === id);
}

export function insert(input: {
  sheet: SheetName;
  data: Record<string, unknown>;
  createdBy: string | null;
  assignedTo: string | null;
}): StoredRecord {
  const now = new Date().toISOString();
  const row: StoredRecord = {
    id: randomUUID(),
    sheet: input.sheet,
    assignedTo: input.assignedTo,
    createdBy: input.createdBy,
    data: input.data,
    createdAt: now,
    updatedAt: now,
  };
  load().unshift(row);
  persist();
  return row;
}

export function patch(
  id: string,
  data: Record<string, unknown>,
): StoredRecord | undefined {
  const row = getById(id);
  if (!row) return undefined;
  row.data = { ...row.data, ...data };
  if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) {
    row.assignedTo = (data.assignedTo as string | null) ?? null;
  }
  row.updatedAt = new Date().toISOString();
  persist();
  return row;
}

export function remove(id: string): boolean {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

// No seed data: the store starts empty. Records are created through the
// app's module add flows.
function seed(): StoredRecord[] {
  return [];
}
