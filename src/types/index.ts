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

// ---- Work Tracker ---------------------------------------------------------
// Backed by its own tables (db/work-tracker.sql). Replaces the Daily Work Log,
// whose data lives on in daily_logs_archive.

/** A team member. Managed on the Settings page; the roster lives in `users`. */
export interface User {
  id: string;
  name: string;
  /**
   * Nullable because the rows that already existed have none, and inventing
   * addresses for real people would be fabricating data. Required by the
   * Settings form for anyone added or edited from now on.
   */
  email: string | null;
  role: 'ADMIN' | 'MEMBER';
  designation: string | null;
  department: string | null;
  /** Line manager. A default suggestion for a task's reportTo, not a rule. */
  reportsTo: string | null;
  reportsToName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
}

/** The pipeline. Approval is a separate action, not a status. */
export type TaskStatus = 'upcoming' | 'ongoing' | 'hold' | 'stopped' | 'completed';

export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  /** The person doing the work. One person per task. */
  userId: string;
  userName: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;

  /** YYYY-MM-DD. When the work was given out. */
  allocationDate: string | null;
  /** YYYY-MM-DD. Working target. */
  dueDate: string | null;
  /** YYYY-MM-DD. Hard limit; never earlier than dueDate. */
  deadlineDate: string | null;

  reportTo: string | null;
  reportToName: string | null;
  approverId: string | null;
  approverName: string | null;

  completedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- Derived, computed per request; never stored -------------------------
  /**
   * Late: the deadline has passed (or the due date, when no deadline is set)
   * and the work is still live. Stopped and completed work is never late.
   */
  isOverdue: boolean;
  /** Past the working target but still inside the deadline. */
  hasSlipped: boolean;
  /** The hard limit has passed and the work is not finished. */
  pastDeadline: boolean;
  /** Whole days until dueDate; negative when past. Null with no due date. */
  daysLeft: number | null;
}

/** One change to one field, for the activity trail. */
export interface TaskActivity {
  id: string;
  taskId: string;
  actorId: string | null;
  actorName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
}

/** Counts for every tab badge, returned in one call. */
export interface TaskTabCounts {
  all: number;
  assigned_to_me: number;
  overdue: number;
}

/** Date-scoped counts for the header's Today block. */
export interface TodayCounts {
  date: string;
  dueToday: number;
  overdue: number;
}

/** Deadline within three days and still live — the At risk block. */
export interface AtRiskTask {
  id: string;
  title: string;
  userName: string;
  deadlineDate: string;
}
