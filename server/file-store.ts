// Zero-setup local store backed by a JSON file, so the app runs with no
// external dependencies.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  InsertInput,
  RecordStore,
  SheetName,
  StoredRecord,
} from './store-types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const DATA_FILE = resolve(DATA_DIR, 'records.json');

let cache: StoredRecord[] | null = null;

function load(): StoredRecord[] {
  if (cache) return cache;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    cache = [];
    persist();
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as StoredRecord[];
  } catch {
    cache = [];
    persist();
  }
  return cache!;
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(cache ?? [], null, 2), 'utf-8');
}

function find(id: string): StoredRecord | undefined {
  return load().find((r) => r.id === id);
}

export const fileStore: RecordStore = {
  async listBySheet(sheet: SheetName) {
    return load()
      .filter((r) => r.sheet === sheet)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async getById(id: string) {
    return find(id);
  },

  async insert(input: InsertInput) {
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
  },

  async patch(id: string, data: Record<string, unknown>) {
    const row = find(id);
    if (!row) return undefined;
    row.data = { ...row.data, ...data };
    if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) {
      row.assignedTo = (data.assignedTo as string | null) ?? null;
    }
    row.updatedAt = new Date().toISOString();
    persist();
    return row;
  },

  async remove(id: string) {
    const list = load();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    persist();
    return true;
  },
};
