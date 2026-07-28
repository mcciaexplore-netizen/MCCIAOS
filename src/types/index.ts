// Single source of truth for data shapes. Mirrors BACKEND_SCHEMA.md.

export type SheetName =
  | 'Company'
  | 'Session'
  | 'Followup'
  | 'Project'
  | 'Creative'
  | 'Resource'
  | 'Settings';

// These vocabularies are configurable on the Settings page, so they are open
// strings rather than literal unions. The allowed values at any moment come
// from AppSettings; DEFAULT_SETTINGS in @/constants seeds them.
export type LeadSource = string;
export type BusinessScale = string;
export type CompanyStatus = string;
export type ProjectStage = string;
export type SessionStatus = string;
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
  leadSources: string[];
  businessScales: string[];
  membershipStatuses: string[];
  resourceCategories: string[];
  creativePlatforms: string[];
  projectStages: TonedOption[];
  companyStatuses: TonedOption[];
  sessionStatuses: TonedOption[];
  creativeStatuses: TonedOption[];
}

export interface Company {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRole?: string;
  udyamNumber?: string;
  district?: string;
  industry?: string;
  membershipStatus?: string;
  rampScheme?: boolean;
  leadSource?: LeadSource;
  businessScale?: BusinessScale;
  status: CompanyStatus;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Session {
  id: string;
  companyId: string;
  query: string;
  solution?: string;
  consultant?: string;
  mode?: string;
  payment?: string;
  domain?: string;
  outcome?: string;
  status: SessionStatus;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Followup {
  id: string;
  sessionId: string;
  dueDate: string;
  note?: string;
  done: boolean;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Project {
  id: string;
  companyId: string;
  title?: string;
  stage: ProjectStage;
  progressPct: number;
  repoUrl?: string;
  liveUrl?: string;
  nextAction?: string;
  blocker?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Creative {
  id: string;
  companyId: string;
  platform: CreativePlatform;
  status: CreativeStatus;
  imageUrl?: string;
  caption?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
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
