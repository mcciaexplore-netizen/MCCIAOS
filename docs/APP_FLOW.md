# APP_FLOW.md — MCCIA OS

Describes user journeys end-to-end, across both the internal app and the public intake form. Pairs with PRD.md (why) and TRD.md (how it's built).

## 1. Team Member — First Visit / Identity Selection

1. User opens the app URL.
2. No login screen with email/OTP — instead, a simple picker: "Who are you?" with a dropdown/list of known team members (Sujal, Pratik, Aditya, Sarthak, Ismail, Gauri, etc.).
3. User selects their name → stored locally → app proceeds directly to Dashboard.
4. On every subsequent visit from the same browser, the app remembers the selection and skips the picker (with an easy way to switch identity from the nav, e.g. clicking their name).

## 2. Team Member — Daily Dashboard Check

1. Land on `/` (Dashboard).
2. See stat cards: overdue, due-this-week, active projects, pending creatives.
3. See "attention required" list — now includes **unassigned/new-intake items** flowing in from the public form.
4. Toggle "assigned to me" to filter the whole dashboard down to just their own workload.
5. Click into any item → navigates to the relevant module/detail page.

## 3. Team Member — Logging a Consultation

1. Navigate to `/consulting`.
2. Click "Add session" (existing SlideOver drawer pattern).
3. Fill query/solution, consultant, mode, payment, domain, outcome, and link to a Company (existing or newly created inline).
4. Optionally set a follow-up with a due date.
5. Save → session appears in the list, `assignedTo` defaults to current identity unless changed.

## 4. Team Member — Managing App Development Pipeline

1. Navigate to `/app-development`.
2. See Kanban board with columns: **Pre Dev → Started → Completed → Deployed → Using**.
3. Drag a project card between columns as work progresses (dnd-kit, unchanged interaction).
4. Click a card to open detail drawer: progress %, repo/live URL, next action, blocker, assignedTo.
5. Toggle to list view for a non-Kanban view of the same data, same as today.

## 5. Team Member — Resources Module

1. Navigate to `/resources` (new nav item, same nav pattern as other modules).
2. See a grid/list (matching existing Companies/Social visual pattern) of shared links: name, description, category, URL.
3. Click "Add resource" → SlideOver drawer, same pattern as other add flows.
4. Any team member can add/edit — no ownership restriction; this module is always fully shared regardless of `assignedTo`.

## 6. MSME Owner — Public Intake Submission

1. MSME owner receives the `/intake` link (e.g. via WhatsApp broadcast, workshop QR code, or the AI Experience Center booking flow).
2. Opens `/intake` — no sidebar, no nav, standalone form (same visual form components as internal app, but no shell chrome).
3. Fills: Full Name, Email, Phone, Company/Org Name, Job Title/Role, Membership Status, UDYAM ID, "How did you hear about this," Industry, Scale.
4. Selects **Request Type**: Consultation / App Development / Both.
5. Submits.

### Backend branch on submit:

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

## 7. Team Member — Claiming a New Intake Item

1. Team member opens Consulting or App Development module, filters by "Unassigned / New Intake."
2. Sees the new Session/Project created from the intake form, tagged with a visual `source: intake-form` indicator (existing badge/tag component, not a new UI element).
3. Opens the item, reviews details, sets `assignedTo` to themselves or a colleague.
4. Item moves out of the "unassigned" filter and into the assignee's normal workload view.

## 8. Team Member — Companies Module (with new fields)

1. Navigate to `/companies`.
2. Existing grid + detail page, now showing new fields where relevant: `contactRole`, `leadSource`, `businessScale`, `status`.
3. Companies created via intake form appear with `status='New Lead'` until a team member updates it (e.g. to `Contacted` or `Active`).
4. Bulk import/export continues to work as today, extended to include the new fields as optional columns.

## 9. Edge Cases to Handle

- **Duplicate intake submission**: same email or UDYAM ID submitted twice → attach new Session/Project to the existing Company, don't create a duplicate Company.
- **Partial match**: email matches one company but UDYAM ID matches a different one → default to email match, flag for manual review (exact tie-breaking rule to be finalized during build).
- **No team member selected yet**: any write action from the internal app without an identity selected should prompt the picker before allowing submission, rather than silently writing null.
- **Kanban stage migration**: existing projects with old stage names must be visible correctly under new column names immediately after deploy — no orphaned cards in a stage that no longer exists.
