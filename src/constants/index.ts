import type {
  AppSettings,
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
// CHECK constraints in Postgres (db/work-tracker.sql), stored lower case.
// Colours are Atlassian's, resolved through the .jira-table token block in
// src/index.css so light and dark share one definition.
export const TASK_STATUSES = [
  'upcoming',
  'ongoing',
  'hold',
  'stopped',
  'completed',
] as const;

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  hold: 'Hold',
  stopped: 'Stopped',
  completed: 'Completed',
};

/** Filled rectangles, not dots and not pills. */
export const TASK_STATUS_LOZENGE: Record<TaskStatus, { bg: string; fg: string }> = {
  upcoming: { bg: 'var(--n30)', fg: 'var(--n500)' },
  ongoing: { bg: 'var(--b50)', fg: 'var(--b400)' },
  hold: { bg: 'var(--y75)', fg: 'var(--y400)' },
  stopped: { bg: 'var(--r50)', fg: 'var(--r400)' },
  completed: { bg: 'var(--g50)', fg: 'var(--g400)' },
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Icon plus label, unlike Jira's icon-only priority: the spec asks for both. */
export const TASK_PRIORITY_COLOR: Record<TaskPriority, string> = {
  high: '#E9494A',
  medium: '#E9730C',
  low: '#2E7CD6',
};

/**
 * Which task fields the edit lock protects.
 *
 * A commitment is something the team agreed: what the work is, whose it is,
 * when it was handed over, and the hard limit. Changing one of those rewrites
 * the agreement, so the lock stands in front of it.
 *
 * Everything else is a status. Status, progress, priority and the working
 * target are *meant* to move — that is the daily update the tracker exists to
 * capture. Freezing them was why nothing had been updated since the day it was
 * entered: zero percentage changes and one status change had ever been logged.
 *
 * Both kinds are logged identically. The lock decides what needs deliberate
 * intent to change; the activity trail records every change either way.
 */
export const COMMITMENT_FIELDS = [
  'title',
  'userId',
  'allocationDate',
  'deadlineDate',
  'reportTo',
  'approverId',
] as const;

/** True when the lock should stand in front of this field. */
export const isCommitmentField = (field: string): boolean =>
  (COMMITMENT_FIELDS as readonly string[]).includes(field);
