# MCCIA OS

Internal workspace for the MCCIA Applied AI Studio team: the daily work log,
workshops and events, social content, outreach messages and shared resources.
The team enters everything directly through the app.

Originally built to the specs in `PRD.md`, `TRD.md`, `APP_FLOW.md`,
`BACKEND_SCHEMA.md`, `UI_UX_BRIEF.md` and `IMPLEMENTATION_PLAN.md`. Those
documents still describe the Dashboard, Companies, Consulting, App Development
and Analytics modules, which have since been removed — see
[Removed modules](#removed-modules).

## Quick start

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

## Architecture

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind, React Query, react-hook-form + Zod, react-router (lazy pages) |
| API | Runtime-agnostic handler in `server/handlers.ts`, shared by Vite dev middleware (`server/vite-plugin.ts`) and a Vercel catch-all (`api/[...path].ts`) |
| Data | Single generic `records` table (JSONB `data` + `sheet` discriminator). Neon Postgres when `DATABASE_URL` is set (`db/migrations.sql`), else a local JSON file store |

**Exception — Workshops & Events** is the one module with dedicated tables
(`db/events.sql`), because its rules are relational: a unique `(type, serial_no)`
pair driving code generation, a participant foreign key that cascades, and
counts that aggregate child rows. It needs real SQL and so requires
`DATABASE_URL`; without it those routes answer `503` rather than failing
obscurely. The Daily Work Log is the same. See
[Workshops & Events](#workshops--events) below.

### Open access (no identity)
There is no login, name-picker, or per-user session. The app is open to
everyone on the team. Two separate notions of a person exist:

- The **Assigned to** field on creatives and messages, a plain name drawn from
  the team roster in Settings.
- The **`users` table**, added for the Daily Work Log and seeded from that same
  roster (`db/daily-logs.sql`).

Neither is an access boundary — both are labels for coordination. Making
ownership real would need actual authentication.

### Key flows
- **Daily Log** is the landing page (`/` redirects to `/daily`): what each
  person worked on, what came of it, and who has not reported.
- **Workshops & Events** records every session run, with auto-numbered codes and
  per-participant attendance. See [Workshops & Events](#workshops--events).
- **Social / Messages / Templates** — full CRUD through SlideOver drawers;
  records can be assigned to a team member.
- **Resources** are globally shared — never filtered by assignment.
- **Social** and **Resources** support CSV/Excel bulk import/export.

### Removed modules
Dashboard, Companies, Consulting, App Development and Analytics were removed.
Their pages, routes, nav entries, server code (`server/analytics.ts`,
`server/reports.ts`) and their `Company` / `Session` / `Followup` / `Project`
sheets are gone from the types, schemas and store allowlist, and their records
were deleted from the database. `@dnd-kit/core` and `pdfkit` went with them.

## Workshops & Events

Every workshop and short event the Applied AI Studio runs, with registration and
attendance tracking. Lives at `/events`, backed by the `events` and
`event_participants` tables in `db/events.sql`.

### Code generation

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

### Registered vs attended counts

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

### Participant CSV format

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

### Other behaviour worth knowing

- **Venue vs meeting link** follow the mode: the form shows venue for
  `OFFLINE`/`HYBRID` and a meeting link for `ONLINE`/`HYBRID`, and the server
  clears whichever does not apply — switching a workshop to online drops its
  stale venue rather than keeping a hidden value.
- Deleting an event deletes its participants (`ON DELETE CASCADE`).
- Filters, tabs and sorting live in the URL, so a filtered view can be pasted to
  someone else and survives a refresh.

## Project layout

```
src/
  types/         TypeScript entity types
  schemas/       Zod schemas (client + server validation source of truth)
  constants/     enums, tone maps, team roster
  lib/           api client, csv, theme, utils, query client
  hooks/         useSheet generic + per-module hooks
  components/    AppLayout, SlideOver, Toast, ui/ primitives, FormControls
  pages/         Daily* (4), Events*, Social, Resources, Messages, Templates, Settings
server/          store (file/Postgres), runtime-agnostic handlers, Vite plugin,
                 events + daily-logs (dedicated-table data access)
api/             Vercel function wrapper
db/              production SQL schema + one-time migrations,
                 events + daily-logs schemas
```

## Deploying to Neon + Vercel
1. Run `db/migrations.sql` against your Neon database, then `db/events.sql`
   and `db/daily-logs.sql` (both additive and idempotent — they only create
   their own tables; `daily-logs.sql` reads `records` once, to seed the team
   roster from Settings, and never writes to it).
2. Set `DATABASE_URL` as a Vercel environment variable (the same pooled Neon
   connection string used locally). `server/store.ts` picks up Postgres
   automatically whenever it is present.
3. Deploy to Vercel — `vercel.json` routes `/api/*` to the catch-all function
   and everything else to the SPA.
