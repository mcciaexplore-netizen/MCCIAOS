# BACKEND_SCHEMA.md — MCCIA OS

Defines the database schema, TypeScript types, Zod schemas, and API contracts. This is the single source of truth for data shape across the app.

## 1. Database Table

```sql
create table records (
  id          uuid primary key default gen_random_uuid(),
  sheet       text not null,          -- entity type discriminator
  assigned_to text,                   -- was owner_id; label only, not an access boundary
  created_by  text,                   -- team member name, or 'intake-form'
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_records_sheet on records (sheet);
create index idx_records_sheet_assigned on records (sheet, assigned_to);
create index idx_records_data_gin on records using gin (data);
```

`sheet` allowlist (enforced in `server/store.ts`):
```
'Company' | 'Session' | 'Followup' | 'Project' | 'Creative' | 'Resource'
```

## 2. TypeScript Types (`src/types/index.ts`)

```typescript
type RequestSource = 'manual' | 'intake-form';

interface Company {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactRole: string;                 // NEW
  udyamNumber?: string;
  district?: string;
  industry: string;
  membershipStatus: string;
  rampScheme?: boolean;
  leadSource: LeadSource;               // NEW
  businessScale: BusinessScale;         // NEW
  status: 'New Lead' | 'Contacted' | 'Active';  // NEW
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
}

type LeadSource = 'Workshop' | 'WhatsApp' | 'Referral' | 'Social' | 'Website' | 'Other';
type BusinessScale = 'Micro' | 'Small' | 'Medium';

interface Session {
  id: string;
  companyId: string;
  query: string;
  solution?: string;
  consultant?: string;
  mode?: string;
  payment?: string;
  domain?: string;
  outcome?: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  source: RequestSource;                // NEW
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
}

interface Followup {
  id: string;
  sessionId: string;
  dueDate: string;
  note?: string;
  done: boolean;
}

type ProjectStage = 'Pre Dev' | 'Started' | 'Completed' | 'Deployed' | 'Using';  // RENAMED

interface Project {
  id: string;
  companyId: string;
  stage: ProjectStage;
  progressPct: number;
  repoUrl?: string;
  liveUrl?: string;
  nextAction?: string;
  blocker?: string;
  source: RequestSource;                // NEW
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
}

interface Creative {
  id: string;
  companyId?: string;
  platform: 'WhatsApp' | 'Social Media' | 'Email' | 'Daily Email' | 'Weekly Email' | 'Monthly Email';
  status: 'draft' | 'scheduled' | 'posted';
  imageUrl?: string;
  caption?: string;
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
}

// NEW entity
interface Resource {
  id: string;
  name: string;
  url: string;
  description: string;
  category: 'Sheet' | 'Dashboard' | 'Automation' | 'Docs' | 'Other';
  addedBy: string;
  createdAt: string;
}

// Public intake payload (subset, no internal-only fields)
interface IntakeSubmission {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitleRole: string;
  membershipStatus: string;
  udyamId?: string;
  hearAboutSource: LeadSource;
  industry: string;
  businessScale: BusinessScale;
  requestType: 'Consultation' | 'App Development' | 'Both';
}
```

## 3. Zod Schemas (`src/schemas/`)

```typescript
export const leadSourceValues = ['Workshop', 'WhatsApp', 'Referral', 'Social', 'Website', 'Other'] as const;
export const businessScaleValues = ['Micro', 'Small', 'Medium'] as const;
export const companyStatusValues = ['New Lead', 'Contacted', 'Active'] as const;
export const projectStageValues = ['Pre Dev', 'Started', 'Completed', 'Deployed', 'Using'] as const;
export const requestSourceValues = ['manual', 'intake-form'] as const;
export const requestTypeValues = ['Consultation', 'App Development', 'Both'] as const;
export const resourceCategoryValues = ['Sheet', 'Dashboard', 'Automation', 'Docs', 'Other'] as const;

export const companySchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6),
  contactRole: z.string().min(1),
  udyamNumber: z.string().optional(),
  district: z.string().optional(),
  industry: z.string().min(1),
  membershipStatus: z.string().min(1),
  rampScheme: z.boolean().optional(),
  leadSource: z.enum(leadSourceValues),
  businessScale: z.enum(businessScaleValues),
  status: z.enum(companyStatusValues).default('New Lead'),
  assignedTo: z.string().nullable().optional(),
});

export const projectSchema = z.object({
  companyId: z.string().uuid(),
  stage: z.enum(projectStageValues).default('Pre Dev'),
  progressPct: z.number().min(0).max(100).default(0),
  repoUrl: z.string().url().optional(),
  liveUrl: z.string().url().optional(),
  nextAction: z.string().optional(),
  blocker: z.string().optional(),
  source: z.enum(requestSourceValues).default('manual'),
  assignedTo: z.string().nullable().optional(),
});

export const resourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().min(1),
  category: z.enum(resourceCategoryValues),
});

export const intakeSubmissionSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(6),
  companyName: z.string().min(1),
  jobTitleRole: z.string().min(1),
  membershipStatus: z.string().min(1),
  udyamId: z.string().optional(),
  hearAboutSource: z.enum(leadSourceValues),
  industry: z.string().min(1),
  businessScale: z.enum(businessScaleValues),
  requestType: z.enum(requestTypeValues),
  // honeypot field, must stay empty — see TRD.md section 9
  website: z.string().max(0).optional(),
});
```

(Session, Followup, Creative schemas retain current shape plus the `source`/`assignedTo` additions shown in the types above — not restated in full here since they are structurally unchanged from the existing app.)

## 4. API Contracts

### `GET /api/records?sheet=Company`
Response: `{ records: Company[] }` — all rows for the sheet, no filtering by requester.

### `POST /api/records`
Body: `{ sheet: string, data: object }`
Behavior: validates `data` against the matching Zod schema for `sheet`, sets `created_by` from `x-user-name` header, sets `assigned_to` to `data.assignedTo` or `x-user-name` if unset.

### `PATCH /api/records/:id`
Body: `{ data: Partial<object> }` — merge-patches the JSONB `data` column.

### `DELETE /api/records/:id`

### `POST /api/public-intake`
Body: `IntakeSubmission` (validated against `intakeSubmissionSchema`).
Server logic:
1. Query `records` where `sheet='Company'` and (`data->>'contactEmail' = email` OR `data->>'udyamNumber' = udyamId`).
2. If found → use existing `id` as `companyId`. If not found → insert new `Company` row with `status='New Lead'`, `leadSource=hearAboutSource`, `createdBy='intake-form'`.
3. Branch on `requestType`:
   - `Consultation` → insert `Session` row: `status='Pending'`, `source='intake-form'`, `assignedTo=null`, `companyId`.
   - `App Development` → insert `Project` row: `stage='Pre Dev'`, `source='intake-form'`, `assignedTo=null`, `companyId`.
   - `Both` → insert both.
4. Response: `{ success: true, companyId }` — no internal record details returned to the public client.

### `GET /api/me`
Response: `{ name: string }` — echoes the `x-user-name` header verbatim, no validation.

## 5. Migration Script (one-time)

```sql
-- Remap old Kanban stage values to new labels
update records set data = jsonb_set(data, '{stage}', '"Pre Dev"')   where sheet='Project' and data->>'stage'='Discovery';
update records set data = jsonb_set(data, '{stage}', '"Started"')   where sheet='Project' and data->>'stage'='Design';
update records set data = jsonb_set(data, '{stage}', '"Started"')   where sheet='Project' and data->>'stage'='Build';
update records set data = jsonb_set(data, '{stage}', '"Completed"') where sheet='Project' and data->>'stage'='Testing';
update records set data = jsonb_set(data, '{stage}', '"Deployed"')  where sheet='Project' and data->>'stage'='Delivered';

-- Rename owner_id semantics (if column rename is chosen over pure app-layer remap)
alter table records rename column owner_id to assigned_to;
```

The exact old→new stage mapping above (`Design`/`Build` both → `Started`) should be confirmed against actual current project statuses before running, since it's a many-to-one collapse in places.
