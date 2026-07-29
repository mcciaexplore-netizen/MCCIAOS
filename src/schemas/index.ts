import { z } from 'zod';
import { BADGE_TONES, DEFAULT_SETTINGS } from '../constants/index.js';
import type { SheetName } from '../types/index.js';

// Vocabulary fields (status, stage, lead source, ...) are configurable on the
// Settings page, so the server can only check that a non-empty string was
// sent. The UI constrains the choices to the current settings.
const vocab = (message: string) => z.string().min(1, message);

// Only the four contact fields are required — everything else can be filled
// in later, so a company can be captured from the Kanban quick-add.
export const companySchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  contactName: z.string().min(1, 'Name is required'),
  contactEmail: z.string().email('Enter a valid email'),
  contactPhone: z.string().min(6, 'Enter a valid phone number'),
  contactRole: z.string().optional(),
  udyamNumber: z.string().optional(),
  district: z.string().optional(),
  industry: z.string().optional(),
  membershipStatus: z.string().optional(),
  rampScheme: z.boolean().optional(),
  leadSource: z.string().optional(),
  businessScale: z.string().optional(),
  status: vocab('Status is required').default(DEFAULT_SETTINGS.companyStatuses[0].label),
  assignedTo: z.string().nullable().optional(),
});

// Kanban quick-add: the minimum needed to create a company record.
export const companyQuickSchema = companySchema.pick({
  companyName: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
});

export const sessionSchema = z.object({
  companyId: z.string().min(1, 'Link a company'),
  query: z.string().min(1, 'Describe the query'),
  solution: z.string().optional(),
  consultant: z.string().optional(),
  mode: z.string().optional(),
  payment: z.string().optional(),
  domain: z.string().optional(),
  outcome: z.string().optional(),
  status: vocab('Status is required').default(DEFAULT_SETTINGS.sessionStatuses[0].label),
  assignedTo: z.string().nullable().optional(),
});

export const followupSchema = z.object({
  sessionId: z.string().min(1),
  dueDate: z.string().min(1, 'Pick a due date'),
  note: z.string().optional(),
  done: z.boolean().default(false),
  assignedTo: z.string().nullable().optional(),
});

export const projectSchema = z.object({
  companyId: z.string().min(1, 'Link a company'),
  title: z.string().optional(),
  stage: vocab('Stage is required').default(DEFAULT_SETTINGS.projectStages[0].label),
  progressPct: z.coerce.number().min(0).max(100).default(0),
  repoUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  liveUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  nextAction: z.string().optional(),
  blocker: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
});

export const creativeSchema = z.object({
  companyId: z.string().optional().or(z.literal('')),
  platform: vocab('Platform is required'),
  status: vocab('Status is required').default(DEFAULT_SETTINGS.creativeStatuses[0].label),
  imageUrl: z.string().url().optional().or(z.literal('')),
  caption: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
});

export const resourceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Enter a valid URL'),
  description: z.string().min(1, 'Description is required'),
  category: vocab('Category is required'),
  addedBy: z.string().optional(),
});

export const MESSAGE_CHANNELS = ['whatsapp', 'email'] as const;
export const MESSAGE_KINDS = ['daily', 'workshop'] as const;
export const MESSAGE_STATUSES = ['draft', 'scheduled', 'sent', 'failed'] as const;

export const messageSchema = z
  .object({
    channel: z.enum(MESSAGE_CHANNELS),
    kind: z.enum(MESSAGE_KINDS).default('daily'),
    title: z.string().min(1, 'Give the message a title'),
    body: z.string().optional(),
    templateId: z.string().nullable().optional(),
    subject: z.string().optional(),
    audience: z.string().optional(),
    recipientCount: z.coerce.number().min(0).optional(),
    scheduledFor: z.string().optional(),
    sentAt: z.string().optional(),
    status: z.enum(MESSAGE_STATUSES).default('draft'),
    notes: z.string().optional(),
    // Written by a future sender, never by the compose form.
    provider: z.string().optional(),
    providerMessageId: z.string().optional(),
    failureReason: z.string().optional(),
    assignedTo: z.string().nullable().optional(),
  })
  // A WhatsApp message is just text, so it needs a body. An email can carry
  // its content either inline or by pointing at a template, but not neither —
  // otherwise there would be nothing to send.
  .refine((m) => m.channel !== 'whatsapp' || !!m.body?.trim(), {
    message: 'WhatsApp messages need body text',
    path: ['body'],
  })
  .refine((m) => m.channel !== 'email' || !!m.templateId || !!m.body?.trim(), {
    message: 'Pick a template or write the email body',
    path: ['body'],
  })
  .refine((m) => m.status !== 'scheduled' || !!m.scheduledFor, {
    message: 'A scheduled message needs a date',
    path: ['scheduledFor'],
  });

export const templateSchema = z.object({
  name: z.string().min(1, 'Name the template'),
  subject: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  html: z.string().min(1, 'Paste the template HTML'),
  assignedTo: z.string().nullable().optional(),
});

// ---- Settings -------------------------------------------------------------
const nameList = (label: string) =>
  z
    .array(z.string().min(1, `${label} entries cannot be blank`))
    .min(1, `Keep at least one ${label} entry`);

const tonedList = (label: string) =>
  z
    .array(
      z.object({
        label: z.string().min(1, `${label} entries cannot be blank`),
        tone: z.enum(BADGE_TONES).catch('gray'),
      }),
    )
    .min(1, `Keep at least one ${label} entry`);

export const settingsSchema = z.object({
  teamMembers: nameList('team member').default(DEFAULT_SETTINGS.teamMembers),
  leadSources: nameList('lead source').default(DEFAULT_SETTINGS.leadSources),
  businessScales: nameList('business scale').default(DEFAULT_SETTINGS.businessScales),
  membershipStatuses: nameList('membership status').default(
    DEFAULT_SETTINGS.membershipStatuses,
  ),
  resourceCategories: nameList('resource category').default(
    DEFAULT_SETTINGS.resourceCategories,
  ),
  creativePlatforms: nameList('platform').default(DEFAULT_SETTINGS.creativePlatforms),
  projectStages: tonedList('Kanban stage').default(DEFAULT_SETTINGS.projectStages),
  companyStatuses: tonedList('company status').default(
    DEFAULT_SETTINGS.companyStatuses,
  ),
  sessionStatuses: tonedList('session status').default(
    DEFAULT_SETTINGS.sessionStatuses,
  ),
  creativeStatuses: tonedList('creative status').default(
    DEFAULT_SETTINGS.creativeStatuses,
  ),
});

export type CompanyInput = z.infer<typeof companySchema>;
export type CompanyQuickInput = z.infer<typeof companyQuickSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type CreativeInput = z.infer<typeof creativeSchema>;
export type ResourceInput = z.infer<typeof resourceSchema>;
export type MessageInput = z.infer<typeof messageSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;

// ---- Import schemas -------------------------------------------------------
// Bulk import must never drop a row because a cell was blank: a half-filled
// MSME record is still worth having, and the missing pieces get filled in
// later from the UI. So every field is optional here and the email/url format
// checks are relaxed to plain text — an imported address that looks wrong is
// still the customer's real data, and hiding the whole row helps nobody.
//
// The strict schemas above are unchanged and still guard the manual forms;
// these apply only to /api/bulk and the import preview. Keep the two in sync
// when adding a field.
const anyText = z.string().optional();
// Vocabulary fields keep their default so a blank cell still lands on a value
// the filters and badges can render.
const anyVocab = (fallback: string) => z.string().default(fallback);

export const companyImportSchema = z.object({
  companyName: anyText,
  contactName: anyText,
  contactEmail: anyText,
  contactPhone: anyText,
  contactRole: anyText,
  udyamNumber: anyText,
  district: anyText,
  industry: anyText,
  membershipStatus: anyText,
  rampScheme: z.boolean().optional(),
  leadSource: anyText,
  businessScale: anyText,
  status: anyVocab(DEFAULT_SETTINGS.companyStatuses[0].label),
  assignedTo: z.string().nullable().optional(),
});

export const sessionImportSchema = z.object({
  companyId: anyText,
  query: anyText,
  solution: anyText,
  consultant: anyText,
  mode: anyText,
  payment: anyText,
  domain: anyText,
  outcome: anyText,
  status: anyVocab(DEFAULT_SETTINGS.sessionStatuses[0].label),
  assignedTo: z.string().nullable().optional(),
});

export const followupImportSchema = z.object({
  sessionId: anyText,
  dueDate: anyText,
  note: anyText,
  done: z.boolean().default(false),
  assignedTo: z.string().nullable().optional(),
});

export const projectImportSchema = z.object({
  companyId: anyText,
  title: anyText,
  stage: anyVocab(DEFAULT_SETTINGS.projectStages[0].label),
  progressPct: z.coerce.number().min(0).max(100).catch(0).default(0),
  repoUrl: anyText,
  liveUrl: anyText,
  nextAction: anyText,
  blocker: anyText,
  assignedTo: z.string().nullable().optional(),
});

export const creativeImportSchema = z.object({
  companyId: anyText,
  platform: anyText,
  status: anyVocab(DEFAULT_SETTINGS.creativeStatuses[0].label),
  imageUrl: anyText,
  caption: anyText,
  assignedTo: z.string().nullable().optional(),
});

export const messageImportSchema = z.object({
  channel: z.string().default('whatsapp'),
  kind: z.string().default('daily'),
  title: anyText,
  body: anyText,
  templateId: z.string().nullable().optional(),
  subject: anyText,
  audience: anyText,
  recipientCount: z.coerce.number().min(0).catch(0).optional(),
  scheduledFor: anyText,
  sentAt: anyText,
  status: z.string().default('draft'),
  notes: anyText,
  provider: anyText,
  providerMessageId: anyText,
  failureReason: anyText,
  assignedTo: z.string().nullable().optional(),
});

export const templateImportSchema = z.object({
  name: anyText,
  subject: anyText,
  description: anyText,
  category: anyText,
  html: anyText,
  assignedTo: z.string().nullable().optional(),
});

export const resourceImportSchema = z.object({
  name: anyText,
  url: anyText,
  description: anyText,
  category: anyText,
  addedBy: anyText,
});

/** Lenient lookup used by /api/bulk and the import preview. */
export const importSchemaForSheet: Record<SheetName, z.ZodTypeAny> = {
  Company: companyImportSchema,
  Session: sessionImportSchema,
  Followup: followupImportSchema,
  Project: projectImportSchema,
  Creative: creativeImportSchema,
  Resource: resourceImportSchema,
  Message: messageImportSchema,
  Template: templateImportSchema,
  // Settings is never bulk-imported; keep it strict.
  Settings: settingsSchema,
};

// Server-side validation lookup by sheet name.
export const schemaForSheet: Record<SheetName, z.ZodTypeAny> = {
  Company: companySchema,
  Session: sessionSchema,
  Followup: followupSchema,
  Project: projectSchema,
  Creative: creativeSchema,
  Resource: resourceSchema,
  Message: messageSchema,
  Template: templateSchema,
  Settings: settingsSchema,
};
