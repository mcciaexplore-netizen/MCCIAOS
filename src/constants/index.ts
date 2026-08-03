import type {
  AppSettings,
  EventMode,
  EventStatus,
  EventType,
  LogCategory,
  LogPriority,
  LogStatus,
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
  leadSources: [
    'Workshop',
    'WhatsApp',
    'Referral',
    'Social',
    'Website',
    'Other',
  ],
  businessScales: ['Micro', 'Small', 'Medium'],
  membershipStatuses: ['Member', 'Non-Member', 'Pending'],
  resourceCategories: ['Sheet', 'Dashboard', 'Automation', 'Docs', 'Other'],
  creativePlatforms: [
    'WhatsApp',
    'Social Media',
    'Email',
    'Daily Email',
    'Weekly Email',
    'Monthly Email',
  ],
  projectStages: [
    { label: 'Pre Dev', tone: 'gray' },
    { label: 'Started', tone: 'blue' },
    { label: 'Completed', tone: 'violet' },
    { label: 'Deployed', tone: 'amber' },
    { label: 'Using', tone: 'green' },
  ],
  companyStatuses: [
    { label: 'New Lead', tone: 'amber' },
    { label: 'Contacted', tone: 'blue' },
    { label: 'Active', tone: 'green' },
  ],
  sessionStatuses: [
    { label: 'Pending', tone: 'amber' },
    { label: 'In Progress', tone: 'blue' },
    { label: 'Completed', tone: 'green' },
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

// ---- Daily Work Log -------------------------------------------------------
// CHECK constraints in Postgres (db/daily-logs.sql), stored upper-case. These
// maps supply the sentence-case labels and the Badge tone for each.
export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  CONSULTATION: 'Consultation',
  APPLICATION: 'Application',
  WORKSHOP: 'Workshop',
  MARKETING: 'Marketing',
  OPERATIONS: 'Operations',
  RESEARCH: 'Research',
  ADMIN: 'Admin',
  OTHER: 'Other',
};

export const LOG_STATUS_LABELS: Record<LogStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
  CARRIED_FORWARD: 'Carried forward',
};

export const LOG_STATUS_TONES: Record<LogStatus, string> = {
  PLANNED: 'gray',
  IN_PROGRESS: 'amber',
  DONE: 'green',
  BLOCKED: 'rose',
  // Deliberately the same neutral as PLANNED; the chip component dims it, so a
  // rolled-over task reads as history rather than as today's work.
  CARRIED_FORWARD: 'gray',
};

export const LOG_PRIORITY_LABELS: Record<LogPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
