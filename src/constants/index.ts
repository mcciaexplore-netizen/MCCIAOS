import type {
  AppSettings,
  CollaboratorRole,
  EventMode,
  EventStatus,
  EventType,
  TaskPriority,
  TaskStatus,
  TonedOption,
} from '../types/index.js';

// Every tone the Badge component knows how to render. The Settings page
// offers exactly these when picking a color for a stage or status.
export const BADGE_TONES = [
  'gray',
  'blue',
  'green',
  'amber',
  'violet',
  'rose',
  'brand',
] as const;

// Seed values for a fresh install. Once saved on the Settings page these are
// superseded by the stored AppSettings record — read them via useSettings(),
// not by importing from here.
export const DEFAULT_SETTINGS: AppSettings = {
  teamMembers: ['Ismail', 'Ziya', 'Sujal', 'Pratik', 'Taniya', 'Rutuja'],
  resourceCategories: ['Sheet', 'Dashboard', 'Automation', 'Docs', 'Other'],
  creativePlatforms: [
    'WhatsApp',
    'Social Media',
    'Email',
    'Daily Email',
    'Weekly Email',
    'Monthly Email',
  ],
  creativeStatuses: [
    { label: 'draft', tone: 'gray' },
    { label: 'scheduled', tone: 'blue' },
    { label: 'posted', tone: 'green' },
  ],
};

// Helpers for turning a TonedOption[] into the shapes the pages want.
export const labelsOf = (options: TonedOption[]): string[] =>
  options.map((o) => o.label);

export const toneMapOf = (options: TonedOption[]): Record<string, string> =>
  Object.fromEntries(options.map((o) => [o.label, o.tone]));

// ---- Workshops & Events ---------------------------------------------------
// Unlike the vocabularies above, these three are CHECK constraints in Postgres
// (db/events.sql) rather than Settings entries, so they are fixed here. The
// stored values are upper-case; these maps supply the sentence-case labels the
// UI shows and the Badge tone for each.
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WORKSHOP: 'Workshop',
  EVENT: 'Event',
};

export const EVENT_TYPE_TONES: Record<EventType, string> = {
  WORKSHOP: 'brand',
  EVENT: 'violet',
};

export const EVENT_MODE_LABELS: Record<EventMode, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  HYBRID: 'Hybrid',
};

export const EVENT_MODE_TONES: Record<EventMode, string> = {
  ONLINE: 'blue',
  OFFLINE: 'gray',
  HYBRID: 'violet',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  UPCOMING: 'Upcoming',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const EVENT_STATUS_TONES: Record<EventStatus, string> = {
  UPCOMING: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'rose',
};

// Suggestions only — `topic` is free text, so the form offers these through a
// datalist and the list page's filter is built from the topics actually used.
export const EVENT_TOPIC_SUGGESTIONS = [
  'HR/Admin',
  'Finance',
  'CX',
  'Sales/CRM',
  'Operations',
  'Marketing',
  'AI Basics',
];

// ---- Work Tracker ---------------------------------------------------------
// CHECK constraints in Postgres (db/work-tracker.sql), stored lower_snake.
//
// Colours map onto the app's existing Badge tones rather than introducing a
// second palette — see the note in src/pages/WorkTracker.tsx.
export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'submitted',
  'approved',
  'completed',
] as const;

export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  submitted: 'Submitted',
  approved: 'Approved',
  completed: 'Completed',
};

/**
 * Dot colour per status. A dot plus text rather than a filled chip: a chip on
 * every row of a dense table is noise.
 */
export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  not_started: 'bg-slate-400',
  in_progress: 'bg-sky-500',
  blocked: 'bg-rose-500',
  submitted: 'bg-amber-500',
  approved: 'bg-emerald-500',
  completed: 'bg-emerald-500/60',
};

export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  not_started: 'text-slate-500',
  in_progress: 'text-sky-700 dark:text-sky-300',
  blocked: 'text-rose-700 dark:text-rose-300',
  submitted: 'text-amber-700 dark:text-amber-300',
  approved: 'text-emerald-700 dark:text-emerald-300',
  completed: 'text-emerald-700/70 dark:text-emerald-300/70',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Priority is a left border on the row, not another chip. Low gets nothing. */
export const TASK_PRIORITY_BORDER: Record<TaskPriority, string> = {
  critical: 'border-l-rose-500',
  high: 'border-l-amber-500',
  medium: 'border-l-slate-200 dark:border-l-slate-700',
  low: 'border-l-transparent',
};

export const COLLABORATOR_ROLES = ['contributor', 'reviewer'] as const;

export const COLLABORATOR_ROLE_LABELS: Record<CollaboratorRole, string> = {
  contributor: 'Contributor',
  reviewer: 'Reviewer',
};
