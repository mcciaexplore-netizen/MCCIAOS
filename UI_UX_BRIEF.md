# UI_UX_BRIEF.md — MCCIA OS

**Primary rule of this document: the existing UI does not change.** This brief exists to define how new pieces (Resources module, intake form, identity picker, unassigned filters, relabeled Kanban) slot into the current visual language without introducing anything new-looking. This is a constraints document, not a design-exploration document.

## 1. Governing Principle

Every new screen, component, and interaction must be indistinguishable in style from what already exists. If a pattern already exists in the app for a given need (a list, a filter, a form, a detail view, a badge), reuse that exact pattern. Do not create a new visual treatment even if it "would look nicer." Consistency over novelty, everywhere.

## 2. What Must Stay Exactly As-Is

- `AppLayout` shell: sidebar, mobile nav, header, notification bell, theme toggle
- Command palette (⌘K) behavior and styling
- Existing color tokens, spacing scale, typography, border radii, shadows (whatever Tailwind config/theme currently defines)
- Card/grid layout used in Companies and Social
- Kanban board visual structure in App Development (columns, card styling, drag interaction) — only the column **labels** change, not the look
- SlideOver drawer component used for add/edit flows across modules
- Table-based layouts, existing form input/select/date components

## 3. New Screens — Required Pattern Reuse

### 3.1 Resources module (`/resources`)
- Layout: reuse the **Companies or Social grid/card pattern** exactly (whichever is closer to a "link card" shape — likely a simpler card than Companies since fewer fields).
- Add/edit: reuse the **existing SlideOver drawer** component, with fields: name, URL, description, category (select), addedBy (read-only, auto-filled).
- Filtering: reuse whatever filter/search bar pattern is already used elsewhere (e.g. Social's filter bar).
- No new iconography beyond what's already used for links/external-URL indicators elsewhere in the app (if none exists, use the simplest existing icon set already imported, not a new one).

### 3.2 Public Intake Form (`/intake`)
- Route renders **without** the AppLayout shell — no sidebar, no nav, no theme toggle, no command palette. Just the form, centered, using existing form field components (the same input/select/label styling already used in Companies/Consulting forms).
- Visually, this should look like "one of the existing add/edit drawers, but full-page and standalone" — not a new form design.
- Request Type field: reuse the existing select/dropdown component style.
- Submit button: reuse the existing primary button style used elsewhere (e.g. "Add Company," "Add Session").
- Confirmation state after submit: reuse whatever success/toast pattern already exists in the app (if a toast/notification component exists, use it; don't invent a new confirmation screen style).

### 3.3 Identity Picker (replaces login screen)
- Reuse the **existing login screen's layout shape** (centered card, logo, single input area) but swap the email input for a dropdown/list of team member names.
- No new illustration, no new copy tone — same visual weight as the screen it replaces.
- A small "switch identity" affordance in the header/nav area should reuse whatever the current user-avatar/profile-menu pattern is (if one exists); otherwise, the simplest existing menu/dropdown component.

## 4. New UI States — Required Pattern Reuse

### 4.1 "Assigned to me" toggle (Dashboard and module lists)
- Reuse whatever toggle/filter-pill/switch component already exists in the app for similar binary filters. Do not introduce a new toggle style.

### 4.2 "Unassigned / New Intake" filter (Consulting, App Development)
- Reuse existing filter/tab/segmented-control pattern (whatever is used today for status filters in these modules).
- Items from intake should be visually flagged using the **existing badge/tag component** (e.g. however "New" or a source label is already rendered elsewhere in the app) — do not design a new badge style. If no such badge exists yet, use the simplest existing small-label/pill styling already present (e.g. status pills in Companies).

### 4.3 Kanban column relabel
- Purely a text change: `Discovery → Design → Build → Testing → Delivered` becomes `Pre Dev → Started → Completed → Deployed → Using`.
- Column width, color-coding (if any), card layout, and drag behavior remain untouched.

## 5. Content / Copy Guidance

- No em-dashes in any copy, per existing team convention.
- Form labels and helper text should match the tone/format already used in existing forms (e.g. same phrasing style as current Company/Session fields), not new microcopy conventions.
- Public intake form copy should be simple and plain — MSME owners are the audience, not internal team members — but still visually identical in styling to internal forms.

## 6. Explicitly Forbidden in This Build

- No new color palette or accent colors beyond what's already defined in the Tailwind theme.
- No new fonts.
- No new icon library additions.
- No redesign of the sidebar, header, or navigation structure to accommodate the new "Resources" nav item — it slots into the existing nav list using the current nav item component/style.
- No animation or micro-interaction patterns that don't already exist elsewhere in the app.

## 7. Acceptance Check for Any New Screen

Before considering any new screen "done," it should pass this test: if a current team member were dropped onto the new screen without being told it was new, would they assume it always existed? If a component looks like it required a new design decision rather than a copy-paste-and-adapt of an existing one, that's a signal to go back and reuse an existing pattern instead.
