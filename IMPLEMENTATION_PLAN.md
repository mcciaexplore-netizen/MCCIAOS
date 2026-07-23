# IMPLEMENTATION_PLAN.md — MCCIA Intern OS

Build sequence, ordered so each phase is independently testable and nothing later depends on something not yet built. Pairs with all preceding docs (PRD, TRD, APP_FLOW, UI_UX_BRIEF, BACKEND_SCHEMA).

## Guiding Rules for the Build

- No visual/UI changes at any phase — every new screen reuses existing components (per UI_UX_BRIEF.md).
- Ship in the order below; do not start a phase until the prior one is verified working.
- Every phase should be deployable/testable in isolation — avoid big-bang merges.

---

## Phase 0 — Prep

- [ ] Snapshot/backup the current `records` table before any migration.
- [ ] Confirm actual current `Project.stage` values in production data (to finalize the old→new stage mapping before running the migration script).
- [ ] Confirm whether `owner_id` is a real column or purely an application-level convention — determines whether a `rename column` migration is needed.

**Exit check:** you have a full data backup and a confirmed stage-mapping table.

---

## Phase 1 — Strip Auth, Add Identity Picker

1. Remove JWT/session logic (`server/session.ts`), real `/api/login` and `/api/logout` handlers.
2. Build identity picker UI reusing the existing login screen's layout/component shell (per UI_UX_BRIEF.md 3.3) — dropdown of team member names instead of email input.
3. Store selected identity in `localStorage`; send as `x-user-name` header on all `/api/records`, `/api/bulk` requests.
4. Update `/api/me` to simply echo the header.
5. Remove owner-based filtering from `/api/records` GET handler — return all rows for the requested `sheet`.
6. Add a "switch identity" affordance to the nav (reusing existing profile/menu component).

**Exit check:** any team member can open the app, pick a name, and see all existing data with no login wall. No visual difference from before beyond the picker replacing the login form.

---

## Phase 2 — Kanban Stage Rename + Data Migration

1. Run the stage-remap SQL (BACKEND_SCHEMA.md section 5) against the confirmed mapping from Phase 0.
2. Update `projectStageValues` tuple and label maps in constants.
3. Update the Zod schema enum for `Project.stage`.
4. Verify Kanban board renders the 5 new columns with correct card placement, drag-drop still functional.

**Exit check:** every existing project card appears in a valid new-named column, none orphaned or failing validation.

---

## Phase 3 — Companies: New Fields

1. Add `contactRole`, `leadSource`, `businessScale`, `status` to `Company` type + Zod schema + constants (`_VALUES` tuples, label maps).
2. Add corresponding fields to the existing Company add/edit drawer, using existing field components.
3. Add these columns as optional fields to bulk import/export.
4. Backfill `status='Active'` (or an agreed default) on existing Company rows that predate this field, so nothing displays as blank/broken.

**Exit check:** Companies module shows new fields in detail view and forms, existing rows still display correctly, bulk import/export handles the new optional columns without breaking on old-format files.

---

## Phase 4 — assignedTo Surfacing

1. Ensure `assignedTo` (renamed from `owner_id` conceptually) is an explicit, editable field on Company, Session, Project (already present as a column — this phase is about UI + filtering, not schema).
2. Add "assigned to me" toggle to Dashboard and each module list view, reusing existing toggle/filter-pill pattern.
3. Update Dashboard aggregation queries to group/filter by `assignedTo` rather than any remaining requester-based filtering.

**Exit check:** filtering by "assigned to me" correctly narrows each module and the Dashboard to only that person's records; toggling off shows everyone's.

---

## Phase 5 — Resources Module

1. Add `Resource` to sheet allowlist (`server/store.ts`) and `SHEET_NAMES`.
2. Add `resourceCategoryValues` + label map to constants.
3. Add `resourceSchema` in `src/schemas/`.
4. Build `useResources.ts` hook (copy `useCompanies.ts` pattern, using shared `mutationUtils.ts`).
5. Build `/resources` page reusing the Companies/Social grid pattern (per UI_UX_BRIEF.md 3.1), and its add/edit SlideOver drawer.
6. Add route in `src/App.tsx` and nav item in `src/components/navigation.ts`.
7. Confirm Resources are always globally visible (no `assignedTo` filtering applied to this sheet, by design).

**Exit check:** any team member can add a resource link and every other team member sees it immediately, with no assignment/ownership filtering applied.

---

## Phase 6 — Public Intake Form + API

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

## Phase 7 — Unassigned / New Intake Queues

1. Add "Unassigned / New Intake" filter to Consulting and App Development modules, reusing existing filter/tab pattern.
2. Add a visual source indicator (existing badge/pill component) to Session/Project cards created via `intake-form`.
3. Surface unassigned/new-intake counts on the Dashboard's attention-required section.
4. Verify the "claim" flow: opening an unassigned item and setting `assignedTo` removes it from the unassigned filter and places it under that person's "assigned to me" view.

**Exit check:** a fresh intake submission is visible to the team within the unassigned filter immediately, and claiming it correctly reassigns and removes it from that queue.

---

## Phase 8 — Full Regression Pass

- [ ] Confirm zero visual differences from the pre-build UI in all untouched modules (Dashboard core layout, Companies grid, Consulting, Social).
- [ ] Confirm no remaining code path filters `/api/records` by requester identity.
- [ ] Confirm old JWT/session code is fully removed, not just bypassed.
- [ ] Confirm bulk import/export still works end-to-end with new optional fields.
- [ ] Confirm intake form is reachable and functional without any internal identity selected.

---

## Suggested Sequencing Rationale

Auth removal comes first because every later phase's testing assumes open access without a login wall. Kanban rename comes early since it's small and isolated. Companies fields and assignedTo surfacing build the foundation the intake form's find-or-create and unassigned queues (Phases 6-7) depend on. Resources is independent and can technically be built in parallel with Phases 3-4 if working with more than one person, since it touches no shared logic with the other phases.
