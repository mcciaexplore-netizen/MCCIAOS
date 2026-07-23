# PRD.md — MCCIA Intern OS

## 1. Product Summary

MCCIA Intern OS is an internal, open-access workspace used by the Applied AI Studio team (interns + staff) at MCCIA, Pune, to manage MSME clients, consulting sessions, custom app-development projects, social content, and shared resource links — with a public front door for MSME owners to submit consultation or app-development requests directly.

This document covers **what** the product does and **why**. It does not cover technical implementation (see TRD.md), data structures (see BACKEND_SCHEMA.md), or UI details (see UI_UX_BRIEF.md).

**Non-negotiable constraint carried through every doc in this set: the existing UI/visual design is not to be changed.** All new work must use existing components, layout patterns, and styling. This PRD only concerns behavior and data — not appearance.

---

## 2. Problem Statement

The team currently manages MSME client relationships, consulting logs, app-dev pipeline status, and social content requests in a scattered way (spreadsheets, WhatsApp, memory). This causes:

- No single source of truth on which company is being worked on by whom
- No visibility into what stage an app-dev project is at, or who owns it
- No structured intake path for new MSME leads coming from workshops, the AI Experience Center, or word of mouth
- No shared place for important reference links (dashboards, sheets, automations) used across the team
- Manual, repeated compilation of status for weekly reporting

## 3. Goals

1. Give every team member a single place to see all companies, sessions, projects, and creatives — with no login friction.
2. Make it obvious who is responsible for what, without enforcing access restrictions (trusted small team, shared visibility by design).
3. Provide a public-facing intake form so MSME owners can request a consultation or app-development help directly, which flows straight into the same data the team already works from.
4. Provide a shared library of important links (databases, sheets, dashboards) visible to the whole team.
5. Keep the existing UI completely intact — this is a backend/data/workflow upgrade, not a redesign.

## 4. Non-Goals

- Not building real authentication, roles, or permissions. This is a trusted-team internal tool.
- Not changing any existing visual design, layout, component styling, or navigation structure.
- Not building a public-facing marketing site — the intake form is a single utility page, not a broader website.
- Not building notification infrastructure (email/SMS) in this phase — reminders stay in-app only.

## 5. Users

| User type | Description | Access |
|---|---|---|
| Team member (intern/staff) | Sujal, Pratik, Aditya, Sarthak, Ismail, Gauri, etc. | Full read/write to everything, no login wall, identifies via name-picker |
| MSME owner / prospect | External person requesting help | Access only to `/intake`, no visibility into internal app |

There is no "admin" role distinct from other team members in this phase — everyone has equal access. `assignedTo` is a label for coordination, not a permission boundary.

## 6. Core Use Cases

1. **A team member logs a consultation** they just had with an MSME owner, and sets a follow-up reminder.
2. **A team member drags an app-dev project** across its pipeline stage (Pre Dev → Started → Completed → Deployed → Using) as work progresses.
3. **An MSME owner fills out the public intake form** requesting either a consultation, app-development help, or both — this creates (or attaches to) a Company record and creates the relevant Session/Project automatically, unassigned.
4. **A team member checks the Dashboard** each morning to see what's overdue, what's unassigned/new from intake, and what needs attention.
5. **Anyone on the team adds a resource link** (e.g. a shared Google Sheet or automation dashboard) so the rest of the team can find it without asking around.
6. **A team member filters any module by "assigned to me"** to see just their own workload.

## 7. Functional Requirements

### 7.1 Identity (not authentication)
- On first visit, user picks their name from a list of known team members.
- This choice persists locally and is sent with requests to pre-fill `assignedTo`/`createdBy`.
- No password, OTP, or session validation. Anyone can switch identity at any time.

### 7.2 Companies module
- Existing MSME CRM fields remain (UDYAM, district, RAMP, membership, industry, contacts).
- New fields: `contactRole`, `leadSource`, `businessScale`, `status` (New Lead / Contacted / Active).
- Bulk import/export retained as-is.

### 7.3 Consulting module
- Existing session + follow-up logging retained.
- New: `source` field (`manual` vs `intake-form`) and unassigned/new-intake filter.

### 7.4 App Development module
- Kanban stages renamed: **Pre Dev → Started → Completed → Deployed → Using**.
- Existing fields (progress %, repo/live URL, next action, blocker) retained.
- New: `source` field and unassigned/new-intake filter.

### 7.5 Social module
- Unchanged from current functionality.

### 7.6 Resources module (new)
- Shared library of links: name, URL, description, category, addedBy.
- Visible to all team members regardless of who added it — this is the one place where "shared" overrides "assigned to."

### 7.7 Public Intake Form (new)
- Standalone, unauthenticated route.
- Fields: Full Name, Email, Phone, Company/Org Name, Job Title/Role, Membership Status, UDYAM ID, How did you hear about this, Industry, Scale, and **Request Type** (Consultation / App Development / Both).
- On submit: find-or-create the Company (matched by email or UDYAM ID) and create the corresponding Session and/or Project record(s), unassigned, tagged with `source='intake-form'`.

### 7.8 Dashboard
- Existing aggregation (stat cards, attention-required, follow-ups, stage bars, activity feed) retained.
- New: "assigned to me" toggle, and visibility into new-intake/unassigned items across modules.

## 8. Success Criteria

- Every team member can find any company, session, project, or resource without asking a colleague.
- New MSME leads from the intake form appear in the team's queue within the same session, with zero manual re-entry.
- Nobody needs a password to use the tool day-to-day.
- The weekly report can eventually be generated from this data instead of manually compiled (future phase, not in this build).

## 9. Out of Scope for This Phase

- Automated email/WhatsApp notifications on new intake or follow-up due dates
- Role-based permissions
- Analytics/reporting beyond what Dashboard already aggregates
- Any visual redesign
