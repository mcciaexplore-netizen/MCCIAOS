# TRD.md — MCCIA Intern OS

Technical requirements derived from PRD.md. Covers stack, non-functional requirements, and system boundaries. Data shapes live in BACKEND_SCHEMA.md; flows live in APP_FLOW.md; UI constraints live in UI_UX_BRIEF.md.

## 1. Stack (unchanged from current app — no new tech introduced)

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (existing classes/tokens only — no new design system) |
| Data/state | React Query |
| Forms | react-hook-form + Zod resolvers |
| Routing | react-router, lazy-loaded pages |
| Drag-and-drop (Kanban) | dnd-kit |
| Backend | Runtime-agnostic handlers in `server/`, shared by Vercel functions (`api/`) and Vite dev middleware |
| Database | Supabase Postgres, single generic `records` table (JSONB) |
| Hosting | Vercel |

No new libraries should be introduced unless something in this spec is impossible with the current stack — flag it if so, rather than silently adding a dependency.

## 2. System Boundaries

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
                  Supabase Postgres
                  (single `records` table)
```

Two distinct entry points share one data store and one set of Zod schemas as the single source of truth for validation.

## 3. Authentication / Identity Requirements

- **Remove** all real authentication: JWT signing (`server/session.ts`), password/OTP flows, server-side session validation.
- **Replace** with a client-side identity picker: user selects their name from a fixed team list; selection persists in `localStorage`; sent as a plain `x-user-name` header on requests to `/api/records` and `/api/bulk`.
- The server does **not** validate this header against any credential — it is trusted input used only to populate `createdBy`/default `assignedTo` on new records.
- `/api/public-intake` requires no identity header at all.
- No row-level security or per-user filtering at the database or API layer. Every team member's request for a given `sheet` returns all rows for that sheet.

## 4. API Requirements

| Endpoint | Method(s) | Auth | Behavior |
|---|---|---|---|
| `/api/records` | GET, POST, PATCH, DELETE | `x-user-name` header (trusted, unvalidated) | Sheet-scoped CRUD, no owner-based filtering, returns all rows for a sheet |
| `/api/bulk` | POST | `x-user-name` header | Bulk import/export, primarily for Companies |
| `/api/public-intake` | POST | None | Find-or-create Company, branch into Session and/or Project creation based on request type |
| `/api/me` | GET | `x-user-name` header | Echoes identity string back; no server-side session check |

Remove: `/api/login`, `/api/logout` (real versions). If retained as routes for compatibility, they must become no-ops that just acknowledge a client-side identity change.

## 5. Data Layer Requirements

- Single `records` table remains the architecture (see BACKEND_SCHEMA.md for full schema).
- `owner_id` is renamed/repurposed as `assigned_to` — a plain label field, not a filter boundary.
- New `sheet` type: `Resource`, always globally visible regardless of `assigned_to`.
- All new fields on `Company`, `Session`, `Project` live inside the `data` JSONB column — no schema migrations required to add fields, only Zod/TypeScript updates.
- Adding indexes on `sheet` and `(sheet, assigned_to)` for query performance as data volume grows (Companies alone is expected to scale to 25k+ rows per existing system notes).

## 6. Validation Requirements

- Zod is the single source of truth for shape validation, shared conceptually between client (react-hook-form resolvers) and server (validate payload before insert/update).
- Public intake payload validated against a subset/variant of the `Company`/`Session`/`Project` Zod schemas — must not require internal-only fields (e.g. `assignedTo`, `consultant`) that a public submitter wouldn't provide.
- Server-side validation on `/api/public-intake` is mandatory even though there's no auth — this is the one endpoint exposed to the public internet, so shape/size/type checks must not be skipped.

## 7. Migration Requirements

1. **Kanban stage relabel**: existing `Project.stage` values (`Discovery/Design/Build/Testing/Delivered`) must be remapped to (`Pre Dev/Started/Completed/Deployed/Using`) via a one-time data migration script against the JSONB column, run before the new Zod enum is deployed (to avoid validation failures on old rows).
2. **Auth removal**: existing `users` table may be kept as a plain name list powering the identity picker dropdown, but its role as an access gate is removed.
3. **owner_id rename**: rename column (or map field name in application code, if renaming the column is disruptive) from `owner_id` to `assigned_to` semantics; ensure no remaining code path filters `/api/records` by requester identity.

## 8. Non-Functional Requirements

- **No UI/visual changes.** Every new page/component must reuse existing patterns (grid/card layout, SlideOver drawer, form field components) — see UI_UX_BRIEF.md for the exact constraint list.
- **No new backend framework or hosting change** — stays within Vercel + Supabase.
- **Backward compatibility for dev/prod parity**: new endpoints must work identically through Vite dev middleware and Vercel functions, per the existing runtime-agnostic handler pattern.
- **Public endpoint hygiene**: `/api/public-intake` must have basic abuse protection (rate limiting or simple honeypot field) since it is unauthenticated and internet-facing — not full auth, just spam resistance.
- **Idempotency on intake**: resubmission with the same email/UDYAM ID should attach to the existing Company rather than duplicating it.

## 9. Risks / Open Technical Questions

- If `owner_id` is a column (not just a JSON field), renaming it may require a migration step — confirm current schema before assuming a pure application-code change.
- Basic spam protection for the public form needs a decision (simple honeypot vs a lightweight rate-limit) — flagged for IMPLEMENTATION_PLAN.md to sequence.
- Whether existing `users` table stays as-is or gets a `display_name` cleanup for the picker dropdown.
