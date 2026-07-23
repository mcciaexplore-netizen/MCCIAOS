import { z } from 'zod';
import { BADGE_TONES, DEFAULT_SETTINGS } from '@/constants';
import type { SheetName } from '@/types';

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
  companyId: z.string().min(1, 'Link a company'),
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
export type FollowupInput = z.infer<typeof followupSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type CreativeInput = z.infer<typeof creativeSchema>;
export type ResourceInput = z.infer<typeof resourceSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

// Server-side validation lookup by sheet name.
export const schemaForSheet: Record<SheetName, z.ZodTypeAny> = {
  Company: companySchema,
  Session: sessionSchema,
  Followup: followupSchema,
  Project: projectSchema,
  Creative: creativeSchema,
  Resource: resourceSchema,
  Settings: settingsSchema,
};
