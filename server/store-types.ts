// Shared store contract. Any backend implementing RecordStore can be slotted
// in from server/store.ts, so server/handlers.ts never knows which is active.

export type SheetName =
  | 'Creative'
  | 'Resource'
  | 'Message'
  | 'Template'
  | 'Settings';

export const SHEET_ALLOWLIST: SheetName[] = [
  'Creative',
  'Resource',
  'Message',
  'Template',
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

export interface InsertInput {
  sheet: SheetName;
  data: Record<string, unknown>;
  createdBy: string | null;
  assignedTo: string | null;
}

export interface RecordStore {
  listBySheet(sheet: SheetName): Promise<StoredRecord[]>;
  getById(id: string): Promise<StoredRecord | undefined>;
  insert(input: InsertInput): Promise<StoredRecord>;
  patch(id: string, data: Record<string, unknown>): Promise<StoredRecord | undefined>;
  remove(id: string): Promise<boolean>;
  /** Deletes every record in the sheet, returning how many were removed. */
  removeBySheet(sheet: SheetName): Promise<number>;
}

export function isValidSheet(sheet: string): sheet is SheetName {
  return (SHEET_ALLOWLIST as string[]).includes(sheet);
}
