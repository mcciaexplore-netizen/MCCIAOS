# Combined documentation — review draft

Original files are unchanged. Review before adopting this draft. Relative links, images, anchors, front matter, and reference-link names retain their original context and may need adjustment. Use the source links below to open the originals.


## Contents

- [APP_FLOW.md](#document-1)

- [BACKEND_SCHEMA.md](#document-2)

- [IMPLEMENTATION_PLAN.md](#document-3)

- [PRD.md](#document-4)

- [README.md](#document-5)

- [TRD.md](#document-6)

- [UI_UX_BRIEF.md](#document-7)


---


<a id="document-1"></a>

## APP_FLOW.md

[Open original](../../APP_FLOW.md)


### APP_FLOW.md — MCCIA OS

Describes user journeys end-to-end, across both the internal app and the public intake form. Pairs with PRD.md (why) and TRD.md (how it's built).

#### 1. Team Member — First Visit / Identity Selection

1. User opens the app URL.
2. No login screen with email/OTP — instead, a simple picker: "Who are you?" with a dropdown/list of known team members (Sujal, Pratik, Aditya, Sarthak, Ismail, Gauri, etc.).
3. User selects their name → stored locally → app proceeds directly to Dashboard.
4. On every subsequent visit from the same browser, the app remembers the selection and skips the picker (with an easy way to switch identity from the nav, e.g. clicking their name).

#### 2. Team Member — Daily Dashboard Check

1. Land on `/` (Dashboard).
2. See stat cards: overdue, due-this-week, active projects, pending creatives.
3. See "attention required" list — now includes **unassigned/new-intake items** flowing in from the public form.
4. Toggle "assigned to me" to filter the whole dashboard down to just their own workload.
5. Click into any item → navigates to the relevant module/detail page.

#### 3. Team Member — Logging a Consultation

1. Navigate to `/consulting`.
2. Click "Add session" (existing SlideOver drawer pattern).
3. Fill query/solution, consultant, mode, payment, domain, outcome, and link to a Company (existing or newly created inline).
4. Optionally set a follow-up with a due date.
5. Save → session appears in the list, `assignedTo` defaults to current identity unless changed.

#### 4. Team Member — Managing App Development Pipeline

1. Navigate to `/app-development`.
2. See Kanban board with columns: **Pre Dev → Started → Completed → Deployed → Using**.
3. Drag a project card between columns as work progresses (dnd-kit, unchanged interaction).
4. Click a card to open detail drawer: progress %, repo/live URL, next action, blocker, assignedTo.
5. Toggle to list view for a non-Kanban view of the same data, same as today.

#### 5. Team Member — Resources Module

1. Navigate to `/resources` (new nav item, same nav pattern as other modules).
2. See a grid/list (matching existing Companies/Social visual pattern) of shared links: name, description, category, URL.
3. Click "Add resource" → SlideOver drawer, same pattern as other add flows.
4. Any team member can add/edit — no ownership restriction; this module is always fully shared regardless of `assignedTo`.

#### 6. MSME Owner — Public Intake Submission

1. MSME owner receives the `/intake` link (e.g. via WhatsApp broadcast, workshop QR code, or the AI Experience Center booking flow).
2. Opens `/intake` — no sidebar, no nav, standalone form (same visual form components as internal app, but no shell chrome).
3. Fills: Full Name, Email, Phone, Company/Org Name, Job Title/Role, Membership Status, UDYAM ID, "How did you hear about this," Industry, Scale.
4. Selects **Request Type**: Consultation / App Development / Both.
5. Submits.

##### Backend branch on submit:

```
POST /api/public-intake
        │
        ▼
 Find-or-create Company
 (match by email OR udyamNumber)
        │
        ├── Request Type = Consultation ──► create Session
        │                                    (status='Pending', source='intake-form',
        │                                     assignedTo=null, companyId=<found/new>)
        │
        ├── Request Type = App Development ──► create Project
        │                                    (stage='Pre Dev', source='intake-form',
        │                                     assignedTo=null, companyId=<found/new>)
        │
        └── Request Type = Both ──► create both Session and Project
```

6. Owner sees a simple confirmation message. No further access to internal data.

#### 7. Team Member — Claiming a New Intake Item

1. Team member opens Consulting or App Development module, filters by "Unassigned / New Intake."
2. Sees the new Session/Project created from the intake form, tagged with a visual `source: intake-form` indicator (existing badge/tag component, not a new UI element).
3. Opens the item, reviews details, sets `assignedTo` to themselves or a colleague.
4. Item moves out of the "unassigned" filter and into the assignee's normal workload view.

#### 8. Team Member — Companies Module (with new fields)

1. Navigate to `/companies`.
2. Existing grid + detail page, now showing new fields where relevant: `contactRole`, `leadSource`, `businessScale`, `status`.
3. Companies created via intake form appear with `status='New Lead'` until a team member updates it (e.g. to `Contacted` or `Active`).
4. Bulk import/export continues to work as today, extended to include the new fields as optional columns.

#### 9. Edge Cases to Handle

- **Duplicate intake submission**: same email or UDYAM ID submitted twice → attach new Session/Project to the existing Company, don't create a duplicate Company.
- **Partial match**: email matches one company but UDYAM ID matches a different one → default to email match, flag for manual review (exact tie-breaking rule to be finalized during build).
- **No team member selected yet**: any write action from the internal app without an identity selected should prompt the picker before allowing submission, rather than silently writing null.
- **Kanban stage migration**: existing projects with old stage names must be visible correctly under new column names immediately after deploy — no orphaned cards in a stage that no longer exists.


---


<a id="document-2"></a>

## BACKEND_SCHEMA.md

[Open original](../../BACKEND_SCHEMA.md)


### BACKEND_SCHEMA.md — MCCIA OS

Defines the database schema, TypeScript types, Zod schemas, and API contracts. This is the single source of truth for data shape across the app.

#### 1. Database Table

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

#### 2. TypeScript Types (`src/types/index.ts`)

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

#### 3. Zod Schemas (`src/schemas/`)

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

#### 4. API Contracts

##### `GET /api/records?sheet=Company`
Response: `{ records: Company[] }` — all rows for the sheet, no filtering by requester.

##### `POST /api/records`
Body: `{ sheet: string, data: object }`
Behavior: validates `data` against the matching Zod schema for `sheet`, sets `created_by` from `x-user-name` header, sets `assigned_to` to `data.assignedTo` or `x-user-name` if unset.

##### `PATCH /api/records/:id`
Body: `{ data: Partial<object> }` — merge-patches the JSONB `data` column.

##### `DELETE /api/records/:id`

##### `POST /api/public-intake`
Body: `IntakeSubmission` (validated against `intakeSubmissionSchema`).
Server logic:
1. Query `records` where `sheet='Company'` and (`data->>'contactEmail' = email` OR `data->>'udyamNumber' = udyamId`).
2. If found → use existing `id` as `companyId`. If not found → insert new `Company` row with `status='New Lead'`, `leadSource=hearAboutSource`, `createdBy='intake-form'`.
3. Branch on `requestType`:
   - `Consultation` → insert `Session` row: `status='Pending'`, `source='intake-form'`, `assignedTo=null`, `companyId`.
   - `App Development` → insert `Project` row: `stage='Pre Dev'`, `source='intake-form'`, `assignedTo=null`, `companyId`.
   - `Both` → insert both.
4. Response: `{ success: true, companyId }` — no internal record details returned to the public client.

##### `GET /api/me`
Response: `{ name: string }` — echoes the `x-user-name` header verbatim, no validation.

#### 5. Migration Script (one-time)

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


---


<a id="document-3"></a>

## IMPLEMENTATION_PLAN.md

[Open original](../../IMPLEMENTATION_PLAN.md)


### IMPLEMENTATION_PLAN.md — MCCIA OS

Build sequence, ordered so each phase is independently testable and nothing later depends on something not yet built. Pairs with all preceding docs (PRD, TRD, APP_FLOW, UI_UX_BRIEF, BACKEND_SCHEMA).

#### Guiding Rules for the Build

- No visual/UI changes at any phase — every new screen reuses existing components (per UI_UX_BRIEF.md).
- Ship in the order below; do not start a phase until the prior one is verified working.
- Every phase should be deployable/testable in isolation — avoid big-bang merges.

---

#### Phase 0 — Prep

- [ ] Snapshot/backup the current `records` table before any migration.
- [ ] Confirm actual current `Project.stage` values in production data (to finalize the old→new stage mapping before running the migration script).
- [ ] Confirm whether `owner_id` is a real column or purely an application-level convention — determines whether a `rename column` migration is needed.

**Exit check:** you have a full data backup and a confirmed stage-mapping table.

---

#### Phase 1 — Strip Auth, Add Identity Picker

1. Remove JWT/session logic (`server/session.ts`), real `/api/login` and `/api/logout` handlers.
2. Build identity picker UI reusing the existing login screen's layout/component shell (per UI_UX_BRIEF.md 3.3) — dropdown of team member names instead of email input.
3. Store selected identity in `localStorage`; send as `x-user-name` header on all `/api/records`, `/api/bulk` requests.
4. Update `/api/me` to simply echo the header.
5. Remove owner-based filtering from `/api/records` GET handler — return all rows for the requested `sheet`.
6. Add a "switch identity" affordance to the nav (reusing existing profile/menu component).

**Exit check:** any team member can open the app, pick a name, and see all existing data with no login wall. No visual difference from before beyond the picker replacing the login form.

---

#### Phase 2 — Kanban Stage Rename + Data Migration

1. Run the stage-remap SQL (BACKEND_SCHEMA.md section 5) against the confirmed mapping from Phase 0.
2. Update `projectStageValues` tuple and label maps in constants.
3. Update the Zod schema enum for `Project.stage`.
4. Verify Kanban board renders the 5 new columns with correct card placement, drag-drop still functional.

**Exit check:** every existing project card appears in a valid new-named column, none orphaned or failing validation.

---

#### Phase 3 — Companies: New Fields

1. Add `contactRole`, `leadSource`, `businessScale`, `status` to `Company` type + Zod schema + constants (`_VALUES` tuples, label maps).
2. Add corresponding fields to the existing Company add/edit drawer, using existing field components.
3. Add these columns as optional fields to bulk import/export.
4. Backfill `status='Active'` (or an agreed default) on existing Company rows that predate this field, so nothing displays as blank/broken.

**Exit check:** Companies module shows new fields in detail view and forms, existing rows still display correctly, bulk import/export handles the new optional columns without breaking on old-format files.

---

#### Phase 4 — assignedTo Surfacing

1. Ensure `assignedTo` (renamed from `owner_id` conceptually) is an explicit, editable field on Company, Session, Project (already present as a column — this phase is about UI + filtering, not schema).
2. Add "assigned to me" toggle to Dashboard and each module list view, reusing existing toggle/filter-pill pattern.
3. Update Dashboard aggregation queries to group/filter by `assignedTo` rather than any remaining requester-based filtering.

**Exit check:** filtering by "assigned to me" correctly narrows each module and the Dashboard to only that person's records; toggling off shows everyone's.

---

#### Phase 5 — Resources Module

1. Add `Resource` to sheet allowlist (`server/store.ts`) and `SHEET_NAMES`.
2. Add `resourceCategoryValues` + label map to constants.
3. Add `resourceSchema` in `src/schemas/`.
4. Build `useResources.ts` hook (copy `useCompanies.ts` pattern, using shared `mutationUtils.ts`).
5. Build `/resources` page reusing the Companies/Social grid pattern (per UI_UX_BRIEF.md 3.1), and its add/edit SlideOver drawer.
6. Add route in `src/App.tsx` and nav item in `src/components/navigation.ts`.
7. Confirm Resources are always globally visible (no `assignedTo` filtering applied to this sheet, by design).

**Exit check:** any team member can add a resource link and every other team member sees it immediately, with no assignment/ownership filtering applied.

---

#### Phase 6 — Public Intake Form + API

1. Build `intakeSubmissionSchema` in `src/schemas/`.
2. Build `/api/public-intake` handler:
   - Find-or-create Company (match on email or UDYAM ID).
   - Branch on `requestType` to create Session and/or Project.
   - Basic spam protection: honeypot field (per TRD.md section 9) rejected silently if filled.
3. Build `/intake` route: standalone page, no AppLayout shell, reusing existing form field components (per UI_UX_BRIEF.md 3.2).
4. Add confirmation state after successful submit (reuse existing toast/success pattern).
5. Test duplicate-submission handling: same email/UDYAM ID twice should attach to the same Company, not duplicate it.

**Exit check:** a test submission with a new email creates a new Company + correct Session/Project; a second submission with the same email attaches to the same Company without duplicating it; the public route shows none of the internal nav/shell.

---

#### Phase 7 — Unassigned / New Intake Queues

1. Add "Unassigned / New Intake" filter to Consulting and App Development modules, reusing existing filter/tab pattern.
2. Add a visual source indicator (existing badge/pill component) to Session/Project cards created via `intake-form`.
3. Surface unassigned/new-intake counts on the Dashboard's attention-required section.
4. Verify the "claim" flow: opening an unassigned item and setting `assignedTo` removes it from the unassigned filter and places it under that person's "assigned to me" view.

**Exit check:** a fresh intake submission is visible to the team within the unassigned filter immediately, and claiming it correctly reassigns and removes it from that queue.

---

#### Phase 8 — Full Regression Pass

- [ ] Confirm zero visual differences from the pre-build UI in all untouched modules (Dashboard core layout, Companies grid, Consulting, Social).
- [ ] Confirm no remaining code path filters `/api/records` by requester identity.
- [ ] Confirm old JWT/session code is fully removed, not just bypassed.
- [ ] Confirm bulk import/export still works end-to-end with new optional fields.
- [ ] Confirm intake form is reachable and functional without any internal identity selected.

---

#### Suggested Sequencing Rationale

Auth removal comes first because every later phase's testing assumes open access without a login wall. Kanban rename comes early since it's small and isolated. Companies fields and assignedTo surfacing build the foundation the intake form's find-or-create and unassigned queues (Phases 6-7) depend on. Resources is independent and can technically be built in parallel with Phases 3-4 if working with more than one person, since it touches no shared logic with the other phases.


---


<a id="document-4"></a>

## PRD.md

[Open original](../../PRD.md)


### PRD.md — MCCIA OS

#### 1. Product Summary

MCCIA OS is an internal, open-access workspace used by the Applied AI Studio team (interns + staff) at MCCIA, Pune, to manage MSME clients, consulting sessions, custom app-development projects, social content, and shared resource links — with a public front door for MSME owners to submit consultation or app-development requests directly.

This document covers **what** the product does and **why**. It does not cover technical implementation (see TRD.md), data structures (see BACKEND_SCHEMA.md), or UI details (see UI_UX_BRIEF.md).

**Non-negotiable constraint carried through every doc in this set: the existing UI/visual design is not to be changed.** All new work must use existing components, layout patterns, and styling. This PRD only concerns behavior and data — not appearance.

---

#### 2. Problem Statement

The team currently manages MSME client relationships, consulting logs, app-dev pipeline status, and social content requests in a scattered way (spreadsheets, WhatsApp, memory). This causes:

- No single source of truth on which company is being worked on by whom
- No visibility into what stage an app-dev project is at, or who owns it
- No structured intake path for new MSME leads coming from workshops, the AI Experience Center, or word of mouth
- No shared place for important reference links (dashboards, sheets, automations) used across the team
- Manual, repeated compilation of status for weekly reporting

#### 3. Goals

1. Give every team member a single place to see all companies, sessions, projects, and creatives — with no login friction.
2. Make it obvious who is responsible for what, without enforcing access restrictions (trusted small team, shared visibility by design).
3. Provide a public-facing intake form so MSME owners can request a consultation or app-development help directly, which flows straight into the same data the team already works from.
4. Provide a shared library of important links (databases, sheets, dashboards) visible to the whole team.
5. Keep the existing UI completely intact — this is a backend/data/workflow upgrade, not a redesign.

#### 4. Non-Goals

- Not building real authentication, roles, or permissions. This is a trusted-team internal tool.
- Not changing any existing visual design, layout, component styling, or navigation structure.
- Not building a public-facing marketing site — the intake form is a single utility page, not a broader website.
- Not building notification infrastructure (email/SMS) in this phase — reminders stay in-app only.

#### 5. Users

| User type | Description | Access |
|---|---|---|
| Team member (intern/staff) | Sujal, Pratik, Aditya, Sarthak, Ismail, Gauri, etc. | Full read/write to everything, no login wall, identifies via name-picker |
| MSME owner / prospect | External person requesting help | Access only to `/intake`, no visibility into internal app |

There is no "admin" role distinct from other team members in this phase — everyone has equal access. `assignedTo` is a label for coordination, not a permission boundary.

#### 6. Core Use Cases

1. **A team member logs a consultation** they just had with an MSME owner, and sets a follow-up reminder.
2. **A team member drags an app-dev project** across its pipeline stage (Pre Dev → Started → Completed → Deployed → Using) as work progresses.
3. **An MSME owner fills out the public intake form** requesting either a consultation, app-development help, or both — this creates (or attaches to) a Company record and creates the relevant Session/Project automatically, unassigned.
4. **A team member checks the Dashboard** each morning to see what's overdue, what's unassigned/new from intake, and what needs attention.
5. **Anyone on the team adds a resource link** (e.g. a shared Google Sheet or automation dashboard) so the rest of the team can find it without asking around.
6. **A team member filters any module by "assigned to me"** to see just their own workload.

#### 7. Functional Requirements

##### 7.1 Identity (not authentication)
- On first visit, user picks their name from a list of known team members.
- This choice persists locally and is sent with requests to pre-fill `assignedTo`/`createdBy`.
- No password, OTP, or session validation. Anyone can switch identity at any time.

##### 7.2 Companies module
- Existing MSME CRM fields remain (UDYAM, district, RAMP, membership, industry, contacts).
- New fields: `contactRole`, `leadSource`, `businessScale`, `status` (New Lead / Contacted / Active).
- Bulk import/export retained as-is.

##### 7.3 Consulting module
- Existing session + follow-up logging retained.
- New: `source` field (`manual` vs `intake-form`) and unassigned/new-intake filter.

##### 7.4 App Development module
- Kanban stages renamed: **Pre Dev → Started → Completed → Deployed → Using**.
- Existing fields (progress %, repo/live URL, next action, blocker) retained.
- New: `source` field and unassigned/new-intake filter.

##### 7.5 Social module
- Unchanged from current functionality.

##### 7.6 Resources module (new)
- Shared library of links: name, URL, description, category, addedBy.
- Visible to all team members regardless of who added it — this is the one place where "shared" overrides "assigned to."

##### 7.7 Public Intake Form (new)
- Standalone, unauthenticated route.
- Fields: Full Name, Email, Phone, Company/Org Name, Job Title/Role, Membership Status, UDYAM ID, How did you hear about this, Industry, Scale, and **Request Type** (Consultation / App Development / Both).
- On submit: find-or-create the Company (matched by email or UDYAM ID) and create the corresponding Session and/or Project record(s), unassigned, tagged with `source='intake-form'`.

##### 7.8 Dashboard
- Existing aggregation (stat cards, attention-required, follow-ups, stage bars, activity feed) retained.
- New: "assigned to me" toggle, and visibility into new-intake/unassigned items across modules.

#### 8. Success Criteria

- Every team member can find any company, session, project, or resource without asking a colleague.
- New MSME leads from the intake form appear in the team's queue within the same session, with zero manual re-entry.
- Nobody needs a password to use the tool day-to-day.
- The weekly report can eventually be generated from this data instead of manually compiled (future phase, not in this build).

#### 9. Out of Scope for This Phase

- Automated email/WhatsApp notifications on new intake or follow-up due dates
- Role-based permissions
- Analytics/reporting beyond what Dashboard already aggregates
- Any visual redesign


---


<a id="document-5"></a>

## README.md

[Open original](../../README.md)


### MCCIA OS

Internal workspace for the MCCIA Applied AI Studio team: the work tracker,
workshops and events, social content, outreach messages and shared resources.
The team enters everything directly through the app.

Originally built to the specs in `PRD.md`, `TRD.md`, `APP_FLOW.md`,
`BACKEND_SCHEMA.md`, `UI_UX_BRIEF.md` and `IMPLEMENTATION_PLAN.md`. Those
documents still describe the Dashboard, Companies, Consulting, App Development
and Analytics modules, which have since been removed — see
[Removed modules](#removed-modules).

#### Quick start

```bash
npm install
npm run dev       # http://localhost:5173
```

`/api/*` is served by Vite dev middleware. Which database it writes to depends
on `DATABASE_URL` (see `.env.example`):

- **Set** — Neon Postgres, via `server/pg-store.ts`. Run `db/migrations.sql`
  against the database once first. This is the current setup; `.env` is
  git-ignored, so each developer supplies their own.
- **Unset** — a local JSON file at `server/data/records.json` (git-ignored), so
  the app still runs with zero setup. Delete that file to wipe all data.

Both backends implement the same `RecordStore` interface, so `handlers.ts` is
identical either way.

- App: `http://localhost:5173/` — open for everyone, no login.

Other scripts: `npm run build` (typecheck + prod build), `npm run typecheck`.

#### Architecture

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind, React Query, react-hook-form + Zod, react-router (lazy pages) |
| API | Runtime-agnostic handler in `server/handlers.ts`, served by the Vite dev middleware (`server/vite-plugin.ts`) |
| Data | Single generic `records` table (JSONB `data` + `sheet` discriminator). Neon Postgres when `DATABASE_URL` is set (`db/migrations.sql`), else a local JSON file store |

**Exception — Workshops & Events** is the one module with dedicated tables
(`db/events.sql`), because its rules are relational: a unique `(type, serial_no)`
pair driving code generation, a participant foreign key that cascades, and
counts that aggregate child rows. It needs real SQL and so requires
`DATABASE_URL`; without it those routes answer `503` rather than failing
obscurely. The Daily Work Log is the same. See
[Workshops & Events](#workshops--events) below.

##### Open access (no identity)
There is no login, name-picker, or per-user session. The app is open to
everyone on the team. Two separate notions of a person exist:

- The **Assigned to** field on creatives and messages, a plain name drawn from
  the team roster in Settings.
- The **`users` table**, seeded from that same roster (`db/work-tracker.sql`).
  The Work Tracker's "Viewing" selector doubles as the current user.

Neither is an access boundary — both are labels for coordination. Making
ownership real would need actual authentication.

##### Key flows
- **Work Tracker** is the landing page (`/` redirects to `/work-tracker`): what
  each person is working on, its status, dates, priority, who they report to and
  who approves it. See [Work Tracker](#work-tracker).
- **Workshops & Events** records every session run, with auto-numbered codes and
  per-participant attendance. See [Workshops & Events](#workshops--events).
- **Social / Messages / Templates** — full CRUD through SlideOver drawers;
  records can be assigned to a team member.
- **Resources** are globally shared — never filtered by assignment.
- **Social** and **Resources** support CSV/Excel bulk import/export.

##### Removed modules
The **Daily Work Log** was replaced by the Work Tracker. Its tables were
**renamed, not dropped** — `daily_logs_archive` (17 rows) and
`daily_checkins_archive` (2 rows) hold the team's real August entries and are
read-only. `/daily` and `/daily-logs` redirect to `/work-tracker`.

Dashboard, Companies, Consulting, App Development and Analytics were removed.
Their pages, routes, nav entries, server code (`server/analytics.ts`,
`server/reports.ts`) and their `Company` / `Session` / `Followup` / `Project`
sheets are gone from the types, schemas and store allowlist, and their records
were deleted from the database. `@dnd-kit/core` and `pdfkit` went with them.

#### Work Tracker

One screen at `/work-tracker`: a dense Jira-style table where every row is a
piece of work and every field is edited in place. Backed by `tasks`,
`task_activity` and `users` in `db/work-tracker.sql`.

**One table for the whole team.** `tasks` is filtered by `user_id`; there is no
table, schema or database per person. The person filter is a WHERE clause.
Each task has one owner and may also name collaborators in `task_members`.

##### Pipeline and rules

`upcoming` → `ongoing` → `hold` → `stopped` → `completed`. Priority is `high`,
`medium`, `low`.

- Completing stamps `completed_at`; leaving `completed` clears it.
- **Approval is a separate action, not a status.** The Approve item in the row
  menu is enabled only when the work is completed and the current person is its
  `approver_id`. Reopening completed work drops the approval, because work that
  is no longer finished cannot stay signed off.
- `deadline_date` can never be earlier than `due_date` — enforced in the form,
  in the API against the merged row, and as a CHECK constraint.
- Every field change appends to `task_activity`; roster changes append to
  `user_activity`.

##### Late, slipped, at risk

Computed per query, never stored, so they cannot go stale.

- **Overdue** — the deadline has passed (or the due date, when no deadline is
  set) and the work is still live. Missing the working target is not enough:
  `due_date` is a target, `deadline_date` is the limit. Stopped and completed
  work is never late.
- **Slipped** — past the working target but still inside the deadline. Shown as
  an amber due date, so a stricter overdue rule does not leave a slipped target
  with no signal.
- **Past deadline** — the hard limit has gone by. Red and bold.
- **At risk** — deadline within three days and still live.

##### Team freshness

The tracker shows one compact stand-up card per active person: their current
open-work count and the age of their latest identified update on work they
still carry. Today is green, yesterday is amber, and more than one full day (or
no identified update at all) is red. People with no open work stay neutral.
Clicking a card filters the table to that person.

Freshness follows `task_activity.actor_id`, not merely `tasks.updated_at`. If a
colleague edits somebody's task, the data changed but it does not demonstrate
that the owner checked in. As with the rest of the activity trail, the actor is
self-declared through the person selector; this is a workflow signal, not an
authentication guarantee.

##### The toolbar

One compact row above the table, nothing else between the title and the work:

- **Tabs** — All work, Assigned to me, Overdue, each with a count badge.
- **The person selector** — one dropdown on the right, beside New task. It
  narrows the table to one person and names who new work is filed under. The
  table opens on **Everyone**, showing the whole team.
- **At risk** — an amber chip when anything has a deadline inside three days.
- **New task**, and the autosave state.

Status and priority filter from their own **column headers**; Name, Title and
the three dates **sort** from theirs, case-insensitively. All of it stays in
the URL.

##### Columns

Name, Title, Priority, Status, Allocation, Due, Deadline, Reports to, Approver,
and the row menu. **Name is sticky**; the rest scroll. Column visibility is
per-user in `localStorage`.

Widths come from the content, not from round numbers. Each column is sized to
the widest thing it can ever hold — "Completed", "Medium", "dd/mm/yyyy" — and
the three people columns are measured against the longest name in the roster on
every render, so adding somebody called "Vedshri Kulkarni" widens them rather
than cutting the name off. Long titles and names carry a hover tooltip, because
an editable cell can always be given more text than fits.

The table is `table-layout: fixed`, which makes a column's width a property of
its header and nothing else. Under auto layout the widest cell won, so opening
the new-task row — whose controls are inevitably bulkier than the text they
stand in for — dragged every column out of line with its own heading. Two
consequences follow. The row's inputs use `ROW_CONTROL`, the form controls at
the 32px row's density, and they draw their own select chevron: Chrome reserves
space for the native arrow *outside* padding-right, where no width calculation
can see it, and that invisible space was eating "Medium" down to "Medi". And
Title's floor has to be the table's `minWidth` rather than the cell's, since a
fixed layout ignores a cell's own minimum — otherwise a 1280px window crushed
the one column carrying the actual sentence down to "Wh.".

**Percentage.** Tasks carry `percentage` (0-100, nullable — null means nobody
has said). It is the only number left on a task: `consultations_allocated`,
`consultations_done` and `callings_done` were dropped, because they stood empty
on every piece of work that was not a consultation, taking width the actual work
needed. Migrations: `db/work-tracker-metrics.sql`, then `db/consultations.sql`
which retires three of the four.

#### Consultations

Their own table and their own view, reached by **Add Consultation** beside New
task on the Work Tracker. A consultation records what it was, who took it, the
date, the time, how many were allocated and how many were completed.

**Not frozen.** Unlike a task, nothing here is gated by the admin passcode —
not editing a filled field, not deleting. These are running tallies the person
who took them updates through the day, and making them find the passcode to
correct a count would only teach everyone to leave the app unlocked. Removal
still hides rather than destroys (`consultations.deleted_at`), so a mis-click is
undoable from the toast.

`completed` is deliberately **not** capped by `allocated`: taking more than were
formally allocated is a normal thing to record, and a CHECK that rejects the
truth teaches people to enter something false. Both are nullable, because "not
applicable" is a different statement from "none yet" (0).

**Who can be reported to, and who can approve.** A task's Reports to and
Approver do not offer the whole roster. Two flags on `users` decide it —
`can_be_reported_to` and `can_approve` — set today to Sujal, Pratik, Ismail and
Ziya for reporting, and Ismail and Ziya for approval. They are checkboxes on the
Settings roster, not names in the code, because a name in the code is wrong the
moment somebody leaves or the arrangement changes and fixing it would take a
deploy. Migration: `db/reporting-roles.sql`.

The two are separate flags rather than one rank. Everyone who approves also
receives reports today, but that is the current arrangement, not a rule.

A task that already names somebody who has since lost the flag still shows them,
and still offers them **on that task only** — otherwise their name would vanish
from every task that recorded it.

**Commitments and operational updates are treated differently.** Filled title,
owner/team, allocation date, hard deadline, reporting line and approver fields
stay locked until the Settings switch is deliberately unlocked. An empty
commitment can still be filled. Status, percentage, priority and the working
due date are always editable because those values are expected to move during
the work. Changes to both groups are recorded with old→new values.

The switch lives in **Settings → Work Tracker**, together with the per-person
bulk clear and Sheets export. It is stored for that browser and guards against
accidental revisions; deleting a task also remains disabled while it is locked.

**Clearing one person's work.** Settings → Work Tracker lists everybody with
what they are carrying and a Clear button each. It hides rather than destroys,
exactly like removing a single task, so a bulk clear made in error is as
recoverable as a single one — which matters more here, not less, because the
mistake is larger. `DELETE /api/tasks` requires `?user=<id>`: there is no
clear-all, because the one button capable of emptying the whole tracker should
not sit next to nine that each empty a single person's.

**What this is not.** The field lock is not API authorization. The app has no
login and the selected actor is forgeable, as required for this trusted-team
tool. The lock prevents accidental clicks in the UI; the activity trail and
Sheets Change Log make intentional changes reviewable. See `src/lib/editLock.ts`.

**Adding work while viewing one person.** Filtered to somebody, the new row's
Name is frozen to them — their avatar and name, no picker. A picker there could
only ever file the task out of the view that was just asked for. Viewing
everyone, it is a picker again, defaulting to whoever is set on the right.

##### Identity

There is no login. The **I am** selector is treated as the current user and is
passed to the API as `?actor=`. **This is a label, not authentication** — a
caller can name anyone. Real enforcement needs the auth described above.

Switching back to Everyone widens the table but **keeps you as the last person
picked**. Approval is done on somebody else's work, so an approver has to be
able to see the whole team without ceasing to be themselves.

The selector carries no label. Who you are shows in its hover title, and in the
Approve item's tooltip when it refuses — which names both the task's approver
and you, so a disabled item is never a mystery.

##### Team and reporting lines

Managed on the Settings page, behind the passcode, in the `users` table: name,
email, designation, department, reports to, role and an active flag.

- **Deactivate, never delete.** The API refuses `DELETE` on a person outright:
  removing one orphans every task, `reports_to` link and approver reference they
  appear on. Deactivated people vanish from the pickers; their work stays.
- **Reporting loops are blocked.** A recursive walk up the proposed manager's
  chain rejects the change and names who already reports up to whom.
- A task's **Reports to and Approver are never guessed**. Both are left blank
  until somebody picks them, on the row or in the new-task row. `users.reports_to`
  records the line manager for reference only; it is not copied onto tasks,
  because a value nobody chose still looks decided.
- Email is **required by the form** from now on, though the column stays
  nullable — the rows that predate this have none, and inventing addresses for
  real people would be fabricating data.

##### Sample data

`node scripts/seed-work-tracker.mjs` adds 10 sample tasks across all five
statuses, including overdue, slipped and at-risk rows. `--clear` removes them.
Only tasks are invented; real people are never given invented attributes.

#### Workshops & Events

Every workshop and short event the Applied AI Studio runs, with registration and
attendance tracking. Lives at `/events`, backed by the `events` and
`event_participants` tables in `db/events.sql`.

##### Code generation

Each record carries a human-readable code. Workshops are numbered `W-01`,
`W-02`, … and standalone events `EV-01`, `EV-02`, … — **two independent
sequences**, so creating a workshop never advances the event numbering.

- Serials are zero-padded to two digits and widen naturally beyond them:
  `W-01` … `W-99`, then `W-100`.
- On create, leaving the code blank assigns the next serial for that type. The
  form shows what that will be (“Next code: W-14”) before you save.
- The allocation runs inside a transaction holding a Postgres advisory lock
  keyed on the type, so two people creating a workshop at the same moment
  cannot read the same `MAX(serial_no)`. The unique index on
  `(type, serial_no)` backs this up, and a create that still collides — because
  the serial was taken by a back-filled code — is retried.
- **Overriding** is for back-filling old workshops. Tick “Override the code” and
  supply e.g. `W-07`. The serial is read back out of the code, so `code` and
  `serial_no` can never disagree. A code whose prefix does not match the type is
  rejected (`422`), and one already in use is rejected (`409`).
- Changing an existing record's type is refused unless a matching new code is
  supplied, rather than silently renumbering a record others may refer to by
  its code.

##### Registered vs attended counts

Every event has two sources of truth for its numbers, and the newer one wins:

1. **Participant rows**, when the event has any — `registered` is the row count
   and `attended` the number ticked. Ticking the attendance box on the detail
   page therefore moves the figures immediately.
2. **The `registered_count` / `attended_count` columns**, used only when the
   event has no participant rows. These are the bulk figures on the event form,
   so an old workshop can be back-filled with just “40 registered, 31 attended”
   and no delegate list.

The stored columns are never overwritten by the fallback — add participants to
an event and the bulk figures stay underneath, unused; delete every participant
and the event falls back to them again. Attendance rate is
`attended / registered` as a percentage, and is shown as `—` rather than `0%`
when nobody registered, since no-registrations and nobody-turned-up are
different facts.

The list page's stat cards are aggregated in Postgres over the active filters,
so they always describe exactly the rows in the table beneath them.

##### Participant CSV format

Import and export share one column set:

```
name,company,designation,email,phone,isMember,attended
```

- **`name` is the only required column.** Rows without one are skipped and
  reported back with their spreadsheet row number; the rest still import.
- Header matching ignores case, spaces and punctuation, and understands the
  spellings real delegate lists use: *Organisation*/*Organization*/*Firm* for
  company, *Role*/*Job title* for designation, *Mobile*/*Contact* for phone,
  *Member*/*MCCIA member* for `isMember`, *Attendance*/*Present* for `attended`.
- `isMember` and `attended` accept `yes`/`no`, `true`/`false`, `1`/`0`.
- Importing **adds** to the list; it never replaces what is already there.
- Export is generated server-side with a UTF-8 BOM so Excel on Windows reads
  non-ASCII names correctly, and is named after the event code
  (`W-07-participants.csv`).

##### Other behaviour worth knowing

- **Venue vs meeting link** follow the mode: the form shows venue for
  `OFFLINE`/`HYBRID` and a meeting link for `ONLINE`/`HYBRID`, and the server
  clears whichever does not apply — switching a workshop to online drops its
  stale venue rather than keeping a hidden value.
- Deleting an event deletes its participants (`ON DELETE CASCADE`).
- Filters, tabs and sorting live in the URL, so a filtered view can be pasted to
  someone else and survives a refresh.

#### Project layout

```
src/
  types/         TypeScript entity types
  schemas/       Zod schemas (client + server validation source of truth)
  constants/     enums, tone maps, team roster
  lib/           api client, csv, theme, utils, query client
  hooks/         useSheet generic + per-module hooks
  components/    AppLayout, SlideOver, Toast, ui/ primitives, FormControls
  pages/         WorkTracker, Events*, Social, Resources, Messages, Templates, Settings
server/          store (file/Postgres), runtime-agnostic handlers, Vite plugin,
                 events + work-tracker (dedicated-table data access)
db/              production SQL schema + one-time migrations,
                 events + work-tracker schemas
```

#### Deploying

**There is no deployment target configured.** The Vercel adapter
(`api/[...path].ts`) and `vercel.json` were removed deliberately; the app runs
through `npm run dev`, which mounts the same runtime-agnostic handler as Vite
middleware.

To host it again, write a new adapter that converts the platform's request into
`ApiRequest` and writes back `ApiResponse` — `server/vite-plugin.ts` is the
working reference, about forty lines. `server/handlers.ts` needs no changes; that
is the point of keeping it runtime-agnostic.

Set `DATABASE_URL` to the pooled Neon connection string wherever it runs, and
apply the migrations in `db/` first.


#### Clearing and restoring

`node scripts/clear-work-tracker.mjs --yes` empties the tracker. It writes every
task to `backups/work-tracker-<timestamp>.json` first and prints the command
that puts them back — `node scripts/restore-work-tracker.mjs <file>`, which
restores each task under its original id, so running it twice is harmless. The
roster in `users` is left alone either way: people are managed on the Settings
page, and deleting them would orphan anything restored afterwards. `backups/` is
gitignored.


#### Daily export to Google Sheets

At 17:00 IST every day each person's work is appended to their own tab of the
MCCIA OS Task sheet, creating the tab if it does not exist. Tabs are matched by
name, case-insensitively and ignoring stray spaces, because a sheet maintained
by hand will have "Aarushi " in it sooner or later and a second tab for the same
person would split their history in two. Somebody with nothing on is skipped
entirely — a tab of empty dated rows is worse than no entry for a quiet day.

Running twice on one day writes once: each tab's last date is read first, and a
day already present is skipped. **Settings → Work Tracker → Run now** does the
same thing on demand and offers to write again anyway, which is what you want
after correcting a task late in the day.

Every task change is recorded immediately in the database with its actor and
old→new values. Each Sheets run also syncs those entries to a shared **Change
Log** tab. Audit-entry IDs make that sync incremental: rerunning it does not
duplicate existing entries, while edits made after an earlier same-day run are
still appended on the next run. A forced rerun can duplicate the daily work
snapshot by design, but never duplicates the Change Log.

**Setup.** Four environment variables, and the sheet shared with the service
account:

| Variable | Where it comes from |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the service account's `client_email` |
| `GOOGLE_PRIVATE_KEY` | its `private_key`, newlines escaped as `\n` |
| `SHEETS_SPREADSHEET_ID` | the id in the sheet's URL |
| `CRON_SECRET` | any long random string; a scheduler presents it |

1. Google Cloud console → new project (or an existing one) → enable the
   **Google Sheets API**.
2. Create a **service account**, then a **JSON key** for it.
3. Open the spreadsheet → Share → paste the service account's address → **Editor**.
   Without this every call returns 403, and the error says so by name.
4. Put the four variables in the environment wherever the app runs.

**The schedule.** `vercel.json` declares a cron at `30 11 * * *` — 11:30 UTC,
which is 17:00 IST. Vercel Cron issues a **GET** carrying
`Authorization: Bearer $CRON_SECRET`, so `CRON_SECRET` must be set in the Vercel
project or the run is refused. A GET without that secret is answered 405, so the
path cannot be fired by being linked to, prefetched or crawled.

The **Run the daily export** toggle in Settings stops the scheduled run. Pressing
**Run now** ignores it: someone who has just asked for an export has said what
they want. The **daily export time** field records intent only — the hour is
fixed by the cron expression above, and moving it means editing `vercel.json`.

Crons run only on a deployed Vercel project, never on `npm run dev`. To test the
scheduled path locally, call it the way Vercel does:

```bash
curl -X GET http://localhost:5173/api/export/daily \
  -H "Authorization: Bearer $CRON_SECRET"
```

#### Daily digest emails

Right after the 17:00 sheet export, one of two emails goes out to each active
person with an address on file — never both — built from the same data the
export just gathered: no separate schedule, no second trip to the Sheets API.

- **Everyone except admins** gets their own recap: the tasks currently on their
  board, and whether today's data — a task update, their calling numbers — is
  actually filled in. The point is the second half: three quiet days in the
  sheet can mean nothing happened, or that nobody logged anything, and the
  export alone cannot tell those apart. A person seeing "not filled in today"
  in their own inbox can.
- **Every `role = ADMIN` user** gets a different email instead — never the
  personal recap — covering the whole team: for each person, today's
  consultations (title, time, allocated/completed), today's calling figures,
  and their current task list. One team-wide picture, not an aggregate count.

Emails go out once per IST day no matter how many times the export runs that
day — a forced rerun or a doubled cron fires the sheet writes again but never
re-sends the mail (`db/digest.sql`, `digest_log`).

**Setup.** Two environment variables, using a Gmail account with 2-Step
Verification turned on:

| Variable | Where it comes from |
| --- | --- |
| `MAIL_USER` | the sending address, e.g. `mcciaexplore@gmail.com` |
| `MAIL_APP_PASSWORD` | a 16-character App Password for that account |
| `MAIL_FROM_NAME` | optional; the "From" display name (default `MCCIA OS`) |

1. On the sending Google account: **Google Account → Security → 2-Step
   Verification** → turn it on if it isn't already.
2. Same page → **App passwords** → create one (any name) → copy the
   16-character password. The account's own login password will not
   authenticate over SMTP once 2-Step Verification is on.
3. Put `MAIL_USER` and `MAIL_APP_PASSWORD` in the environment wherever the app
   runs, then `npm run mail:check` to confirm Gmail accepts them before relying
   on the 17:00 run.
4. Give each person an email in **Settings → Team** — a digest cannot reach
   someone with no address on file; they are silently skipped and counted in
   the export's result panel.

Leaving both variables unset runs the app exactly as before: no digest is
sent, and the sheet export is unaffected.


#### Settings and admin access

**There are no user accounts in this app.** No login, no roles, no user table
beyond a roster of names that fills dropdowns. So "admin" is not a role somebody
holds — it is a password somebody knows, and every visitor is anonymous and
identical until they present it. There is nobody to hide the Settings link
*from*, and hiding it would not be protection in any case.

**The gate.** `ADMIN_SETTINGS_PASSWORD`, compared server-side only. It is never
sent to the browser, never logged, and never returned by any route. A correct
password issues a session cookie:

| | |
| --- | --- |
| `HttpOnly` | page scripts cannot read it — `document.cookie` returns nothing |
| `SameSite=Strict` | another origin cannot ride the session |
| `Secure` | in production; localhost is plain http and would never store it |
| `Max-Age` | 8 hours, then it lapses on its own |

The cookie is `<expiry>.<hmac>`, signed with a key derived from the password.
There is no session store because there is nowhere durable a serverless
invocation could share; two useful things fall out of that. Changing the
password invalidates every live session, and a stolen cookie stops working at
its expiry rather than forever. See `server/admin-session.ts`.

**Required in production.** With `ADMIN_SETTINGS_PASSWORD` unset, a deployed
instance refuses every sign-in with a 503 naming the variable rather than
falling back to a default — a forgotten environment variable must not silently
keep accepting a password that is in this repository. `SETTINGS_PASSCODE` is
still read as the older name for the same thing, so an existing deployment does
not lose access.

**What replaced what.** The previous scheme kept the password in
`sessionStorage` and echoed it on every write as `x-settings-passcode`. Anything
that could run a script in the page could read it there. That is gone —
`src/lib/lock.ts` and `src/hooks/useUnlocked.ts` are deleted.

**Enforced server-side.** Every write Settings performs checks the session in
the handler. Hiding the screen is a courtesy to whoever should not be there, not
the boundary. `GET /api/settings/org` stays open deliberately: the app needs its
own name and colour to render, and none of it is secret.

**This is still not authentication.** One password is shared by everyone who
administers the app, so a session proves somebody knew it — never who they were.
Nothing here can attribute a change to a person.

##### What is editable

| Section | Settings |
| --- | --- |
| General | application name, tagline, organisation name |
| Branding | logo upload, brand colour |
| Contact | email, phone, website, address |
| Preferences | at-risk window (days), daily export time, export on/off |
| Notifications | overdue and approval notices, notification address |
| Team | the roster, and who may be reported to or approve |
| Work Tracker | the lock, and clearing one person's work |

Stored in `org_settings` — one row, structurally enforced (`id boolean primary
key`, so a second insert collides rather than creating a rival profile half the
app would read). Migration: `db/org-settings.sql`.

Two of these were hardcoded and are not any more: the app name and tagline came
from `src/lib/brand.ts`, and the at-risk window was a literal `+ 3` in the SQL,
where changing it meant a deploy. The constants remain as the fallback for first
paint and for an install that has never saved anything.

Validation is defined once, in `src/schemas/orgSettings.ts`, and used by both
the form and the API — so the two cannot disagree about what is acceptable.
Unreadable stored values fall back field by field rather than taking the page
down.


---


<a id="document-6"></a>

## TRD.md

[Open original](../../TRD.md)


### TRD.md — MCCIA OS

Technical requirements derived from PRD.md. Covers stack, non-functional requirements, and system boundaries. Data shapes live in BACKEND_SCHEMA.md; flows live in APP_FLOW.md; UI constraints live in UI_UX_BRIEF.md.

#### 1. Stack (unchanged from current app — no new tech introduced)

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (existing classes/tokens only — no new design system) |
| Data/state | React Query |
| Forms | react-hook-form + Zod resolvers |
| Routing | react-router, lazy-loaded pages |
| Drag-and-drop (Kanban) | dnd-kit |
| Backend | Runtime-agnostic handlers in `server/`, shared by Vercel functions (`api/`) and Vite dev middleware |
| Database | Neon Postgres, single generic `records` table (JSONB) |
| Hosting | Vercel |

No new libraries should be introduced unless something in this spec is impossible with the current stack — flag it if so, rather than silently adding a dependency.

#### 2. System Boundaries

```
┌────────────────────┐        ┌─────────────────────────┐
│  Public Intake Form │        │   Internal Team App      │
│  /intake (no auth)  │        │  (name-picker identity)  │
└──────────┬──────────┘        └────────────┬────────────┘
           │                                │
           ▼                                ▼
  /api/public-intake              /api/records, /api/bulk, /api/me
           │                                │
           └───────────────┬────────────────┘
                            ▼
                    Neon Postgres
                  (single `records` table)
```

Two distinct entry points share one data store and one set of Zod schemas as the single source of truth for validation.

#### 3. Authentication / Identity Requirements

- **Remove** all real authentication: JWT signing (`server/session.ts`), password/OTP flows, server-side session validation.
- **Replace** with a client-side identity picker: user selects their name from a fixed team list; selection persists in `localStorage`; sent as a plain `x-user-name` header on requests to `/api/records` and `/api/bulk`.
- The server does **not** validate this header against any credential — it is trusted input used only to populate `createdBy`/default `assignedTo` on new records.
- `/api/public-intake` requires no identity header at all.
- No row-level security or per-user filtering at the database or API layer. Every team member's request for a given `sheet` returns all rows for that sheet.

#### 4. API Requirements

| Endpoint | Method(s) | Auth | Behavior |
|---|---|---|---|
| `/api/records` | GET, POST, PATCH, DELETE | `x-user-name` header (trusted, unvalidated) | Sheet-scoped CRUD, no owner-based filtering, returns all rows for a sheet |
| `/api/bulk` | POST | `x-user-name` header | Bulk import/export, primarily for Companies |
| `/api/public-intake` | POST | None | Find-or-create Company, branch into Session and/or Project creation based on request type |
| `/api/me` | GET | `x-user-name` header | Echoes identity string back; no server-side session check |

Remove: `/api/login`, `/api/logout` (real versions). If retained as routes for compatibility, they must become no-ops that just acknowledge a client-side identity change.

#### 5. Data Layer Requirements

- Single `records` table remains the architecture (see BACKEND_SCHEMA.md for full schema).
- `owner_id` is renamed/repurposed as `assigned_to` — a plain label field, not a filter boundary.
- New `sheet` type: `Resource`, always globally visible regardless of `assigned_to`.
- All new fields on `Company`, `Session`, `Project` live inside the `data` JSONB column — no schema migrations required to add fields, only Zod/TypeScript updates.
- Adding indexes on `sheet` and `(sheet, assigned_to)` for query performance as data volume grows (Companies alone is expected to scale to 25k+ rows per existing system notes).

#### 6. Validation Requirements

- Zod is the single source of truth for shape validation, shared conceptually between client (react-hook-form resolvers) and server (validate payload before insert/update).
- Public intake payload validated against a subset/variant of the `Company`/`Session`/`Project` Zod schemas — must not require internal-only fields (e.g. `assignedTo`, `consultant`) that a public submitter wouldn't provide.
- Server-side validation on `/api/public-intake` is mandatory even though there's no auth — this is the one endpoint exposed to the public internet, so shape/size/type checks must not be skipped.

#### 7. Migration Requirements

1. **Kanban stage relabel**: existing `Project.stage` values (`Discovery/Design/Build/Testing/Delivered`) must be remapped to (`Pre Dev/Started/Completed/Deployed/Using`) via a one-time data migration script against the JSONB column, run before the new Zod enum is deployed (to avoid validation failures on old rows).
2. **Auth removal**: existing `users` table may be kept as a plain name list powering the identity picker dropdown, but its role as an access gate is removed.
3. **owner_id rename**: rename column (or map field name in application code, if renaming the column is disruptive) from `owner_id` to `assigned_to` semantics; ensure no remaining code path filters `/api/records` by requester identity.

#### 8. Non-Functional Requirements

- **No UI/visual changes.** Every new page/component must reuse existing patterns (grid/card layout, SlideOver drawer, form field components) — see UI_UX_BRIEF.md for the exact constraint list.
- **No new backend framework or hosting change** — stays within Vercel + Neon.
- **Backward compatibility for dev/prod parity**: new endpoints must work identically through Vite dev middleware and Vercel functions, per the existing runtime-agnostic handler pattern.
- **Public endpoint hygiene**: `/api/public-intake` must have basic abuse protection (rate limiting or simple honeypot field) since it is unauthenticated and internet-facing — not full auth, just spam resistance.
- **Idempotency on intake**: resubmission with the same email/UDYAM ID should attach to the existing Company rather than duplicating it.

#### 9. Risks / Open Technical Questions

- If `owner_id` is a column (not just a JSON field), renaming it may require a migration step — confirm current schema before assuming a pure application-code change.
- Basic spam protection for the public form needs a decision (simple honeypot vs a lightweight rate-limit) — flagged for IMPLEMENTATION_PLAN.md to sequence.
- Whether existing `users` table stays as-is or gets a `display_name` cleanup for the picker dropdown.


---


<a id="document-7"></a>

## UI_UX_BRIEF.md

[Open original](../../UI_UX_BRIEF.md)


### UI_UX_BRIEF.md — MCCIA OS

**Primary rule of this document: the existing UI does not change.** This brief exists to define how new pieces (Resources module, intake form, identity picker, unassigned filters, relabeled Kanban) slot into the current visual language without introducing anything new-looking. This is a constraints document, not a design-exploration document.

#### 1. Governing Principle

Every new screen, component, and interaction must be indistinguishable in style from what already exists. If a pattern already exists in the app for a given need (a list, a filter, a form, a detail view, a badge), reuse that exact pattern. Do not create a new visual treatment even if it "would look nicer." Consistency over novelty, everywhere.

#### 2. What Must Stay Exactly As-Is

- `AppLayout` shell: sidebar, mobile nav, header, notification bell, theme toggle
- Command palette (⌘K) behavior and styling
- Existing color tokens, spacing scale, typography, border radii, shadows (whatever Tailwind config/theme currently defines)
- Card/grid layout used in Companies and Social
- Kanban board visual structure in App Development (columns, card styling, drag interaction) — only the column **labels** change, not the look
- SlideOver drawer component used for add/edit flows across modules
- Table-based layouts, existing form input/select/date components

#### 3. New Screens — Required Pattern Reuse

##### 3.1 Resources module (`/resources`)
- Layout: reuse the **Companies or Social grid/card pattern** exactly (whichever is closer to a "link card" shape — likely a simpler card than Companies since fewer fields).
- Add/edit: reuse the **existing SlideOver drawer** component, with fields: name, URL, description, category (select), addedBy (read-only, auto-filled).
- Filtering: reuse whatever filter/search bar pattern is already used elsewhere (e.g. Social's filter bar).
- No new iconography beyond what's already used for links/external-URL indicators elsewhere in the app (if none exists, use the simplest existing icon set already imported, not a new one).

##### 3.2 Public Intake Form (`/intake`)
- Route renders **without** the AppLayout shell — no sidebar, no nav, no theme toggle, no command palette. Just the form, centered, using existing form field components (the same input/select/label styling already used in Companies/Consulting forms).
- Visually, this should look like "one of the existing add/edit drawers, but full-page and standalone" — not a new form design.
- Request Type field: reuse the existing select/dropdown component style.
- Submit button: reuse the existing primary button style used elsewhere (e.g. "Add Company," "Add Session").
- Confirmation state after submit: reuse whatever success/toast pattern already exists in the app (if a toast/notification component exists, use it; don't invent a new confirmation screen style).

##### 3.3 Identity Picker (replaces login screen)
- Reuse the **existing login screen's layout shape** (centered card, logo, single input area) but swap the email input for a dropdown/list of team member names.
- No new illustration, no new copy tone — same visual weight as the screen it replaces.
- A small "switch identity" affordance in the header/nav area should reuse whatever the current user-avatar/profile-menu pattern is (if one exists); otherwise, the simplest existing menu/dropdown component.

#### 4. New UI States — Required Pattern Reuse

##### 4.1 "Assigned to me" toggle (Dashboard and module lists)
- Reuse whatever toggle/filter-pill/switch component already exists in the app for similar binary filters. Do not introduce a new toggle style.

##### 4.2 "Unassigned / New Intake" filter (Consulting, App Development)
- Reuse existing filter/tab/segmented-control pattern (whatever is used today for status filters in these modules).
- Items from intake should be visually flagged using the **existing badge/tag component** (e.g. however "New" or a source label is already rendered elsewhere in the app) — do not design a new badge style. If no such badge exists yet, use the simplest existing small-label/pill styling already present (e.g. status pills in Companies).

##### 4.3 Kanban column relabel
- Purely a text change: `Discovery → Design → Build → Testing → Delivered` becomes `Pre Dev → Started → Completed → Deployed → Using`.
- Column width, color-coding (if any), card layout, and drag behavior remain untouched.

#### 5. Content / Copy Guidance

- No em-dashes in any copy, per existing team convention.
- Form labels and helper text should match the tone/format already used in existing forms (e.g. same phrasing style as current Company/Session fields), not new microcopy conventions.
- Public intake form copy should be simple and plain — MSME owners are the audience, not internal team members — but still visually identical in styling to internal forms.

#### 6. Explicitly Forbidden in This Build

- No new color palette or accent colors beyond what's already defined in the Tailwind theme.
- No new fonts.
- No new icon library additions.
- No redesign of the sidebar, header, or navigation structure to accommodate the new "Resources" nav item — it slots into the existing nav list using the current nav item component/style.
- No animation or micro-interaction patterns that don't already exist elsewhere in the app.

#### 7. Acceptance Check for Any New Screen

Before considering any new screen "done," it should pass this test: if a current team member were dropped onto the new screen without being told it was new, would they assume it always existed? If a component looks like it required a new design decision rather than a copy-paste-and-adapt of an existing one, that's a signal to go back and reuse an existing pattern instead.
