// Single source of truth for data shapes. Mirrors BACKEND_SCHEMA.md.

export type SheetName =
  | 'Creative'
  | 'Resource'
  | 'Message'
  | 'Template'
  | 'Settings';

// These vocabularies are configurable on the Settings page, so they are open
// strings rather than literal unions. The allowed values at any moment come
// from AppSettings; DEFAULT_SETTINGS in @/constants seeds them.
export type CreativePlatform = string;
export type CreativeStatus = string;
export type ResourceCategory = string;

// A vocabulary entry that renders as a colored Badge.
export interface TonedOption {
  label: string;
  tone: string;
}

export interface AppSettings {
  teamMembers: string[];
  resourceCategories: string[];
  creativePlatforms: string[];
  creativeStatuses: TonedOption[];
}

export interface Creative {
  id: string;
  platform: CreativePlatform;
  status: CreativeStatus;
  imageUrl?: string;
  caption?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

// Outbound messages: the daily WhatsApp/email sends and the workshop notices.
//
// Nothing here sends anything yet — the app records what went out and lets you
// compose and preview it. The delivery fields (scheduledFor, sentAt, provider,
// providerMessageId, failureReason) exist so a real sender can be dropped in
// later and fill them without reshaping stored records.
export type MessageChannel = 'whatsapp' | 'email';
export type MessageKind = 'daily' | 'workshop';
export type MessageStatus = 'draft' | 'scheduled' | 'sent' | 'failed';

export interface Message {
  id: string;
  channel: MessageChannel;
  kind: MessageKind;
  title: string;
  /** Plain text for WhatsApp; for email this is the fallback when no template. */
  body?: string;
  /** Template record id, email only. */
  templateId?: string | null;
  subject?: string;
  audience?: string;
  recipientCount?: number;
  scheduledFor?: string;
  sentAt?: string;
  status: MessageStatus;
  notes?: string;
  /** Reserved for the future sender — which provider handled it, and its id. */
  provider?: string;
  providerMessageId?: string;
  failureReason?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

/** A reusable HTML email template, edited and previewed in the app. */
export interface Template {
  id: string;
  name: string;
  subject?: string;
  description?: string;
  category?: string;
  /** Raw HTML. Rendered only inside a sandboxed iframe. */
  html: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Resource {
  id: string;
  name: string;
  url: string;
  description: string;
  category: ResourceCategory;
  addedBy: string;
  createdAt: string;
}

// ---- Workshops & Events ---------------------------------------------------
// The only module backed by its own tables (db/events.sql) rather than the
// generic `records` store, so these fields map to real columns. Unlike the
// vocabularies above these three are fixed CHECK constraints in Postgres, not
// Settings-configurable, so they are literal unions.
export type EventType = 'WORKSHOP' | 'EVENT';
export type EventMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';
export type EventStatus = 'UPCOMING' | 'COMPLETED' | 'CANCELLED';

/**
 * Named EventRecord rather than Event: `Event` is a DOM global, and shadowing
 * it makes every unrelated `addEventListener` signature in the file wrong.
 */
export interface EventRecord {
  id: string;
  /** "W-01", "EV-07". Unique; derived from type + serialNo. */
  code: string;
  type: EventType;
  serialNo: number;
  title: string;
  description: string | null;
  topic: string | null;
  mode: EventMode;
  /** Kept only for OFFLINE/HYBRID; cleared by the server otherwise. */
  venue: string | null;
  /** Kept only for ONLINE/HYBRID; cleared by the server otherwise. */
  meetingLink: string | null;
  /** YYYY-MM-DD. */
  eventDate: string;
  /** HH:MM, 24-hour. */
  startTime: string | null;
  endTime: string | null;
  speaker: string | null;
  status: EventStatus;
  /**
   * The stored manual-override columns. These are the bulk figures used for
   * back-filled events; prefer the derived `registered`/`attended` below for
   * anything shown on screen.
   */
  registeredCount: number;
  attendedCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- Derived, computed per request; never stored -------------------------
  /** True when this event has participant rows, i.e. counts are not fallbacks. */
  hasParticipants: boolean;
  /** Participant rows when any exist, else registeredCount. */
  registered: number;
  /** Attended participant rows when any exist, else attendedCount. */
  attended: number;
  /** attended/registered as a 0-100 percentage; null when registered is 0. */
  attendanceRate: number | null;
}

export interface EventParticipant {
  id: string;
  eventId: string;
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  /** Whether the attendee is an MCCIA member. */
  isMember: boolean;
  registeredAt: string;
  attended: boolean;
  createdAt: string;
}

/** Totals for the list page's stat cards, computed over the filtered set. */
export interface EventSummary {
  workshops: number;
  events: number;
  registered: number;
  attended: number;
  attendanceRate: number | null;
}

// ---- Daily Work Log -------------------------------------------------------
// Backed by its own tables (db/daily-logs.sql). These vocabularies are CHECK
// constraints in Postgres, not Settings entries, so they are literal unions.

/**
 * A team member. The first real identity row in the app — every other module
 * still refers to a person by name (`records.assigned_to`), and this table is
 * seeded from the same Settings roster. See the README.
 */
export interface User {
  id: string;
  name: string;
  email: string | null;
  role: 'ADMIN' | 'MEMBER';
  active: boolean;
}

export type LogCategory =
  | 'CONSULTATION'
  | 'APPLICATION'
  | 'WORKSHOP'
  | 'MARKETING'
  | 'OPERATIONS'
  | 'RESEARCH'
  | 'ADMIN'
  | 'OTHER';

export type LogStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'BLOCKED'
  | 'CARRIED_FORWARD';

export type LogPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DailyLog {
  id: string;
  /** YYYY-MM-DD, an Asia/Kolkata calendar day. */
  logDate: string;
  userId: string;
  /** Denormalised for display; the join is done server-side. */
  userName: string;
  title: string;
  category: LogCategory;
  description: string | null;
  /** What was actually produced. Required before status can be DONE. */
  output: string | null;
  outputLink: string | null;
  status: LogStatus;
  priority: LogPriority | null;
  timeSpentMins: number | null;
  /** Required while status is BLOCKED. */
  blockerNote: string | null;
  /** The row this was rolled over from, if any. */
  carriedFromId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Whether a person reported at all on a given day. */
export interface DailyCheckin {
  id: string;
  userId: string;
  logDate: string;
  daySummary: string | null;
  submittedAt: string | null;
}

/** Per-person aggregates over a date range. */
export interface DailySummaryRow {
  userId: string;
  userName: string;
  tasks: number;
  done: number;
  inProgress: number;
  blocked: number;
  planned: number;
  carriedForward: number;
  /** done / tasks as a 0-100 percentage; null when nothing was logged. */
  completionRate: number | null;
  totalMins: number;
}

export interface CategoryCount {
  category: LogCategory;
  count: number;
  totalMins: number;
}

/** The top strip on the Team Day view. */
export interface DayStats {
  totalTasks: number;
  done: number;
  inProgress: number;
  blocked: number;
  planned: number;
  carriedForward: number;
  /** Members with at least one entry, over active members. */
  reported: number;
  teamSize: number;
  reportedPct: number | null;
}
