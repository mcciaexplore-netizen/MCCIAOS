# MCCIA OS

Internal workspace for the MCCIA Applied AI Studio team: the work tracker,
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
- The **`users` table**, seeded from that same roster (`db/work-tracker.sql`).
  The Work Tracker's "Viewing" selector doubles as the current user.

Neither is an access boundary — both are labels for coordination. Making
ownership real would need actual authentication.

### Key flows
- **Work Tracker** is the landing page (`/` redirects to `/work-tracker`): what
  each person is working on, its status, dates, priority, who they report to and
  who approves it. See [Work Tracker](#work-tracker).
- **Workshops & Events** records every session run, with auto-numbered codes and
  per-participant attendance. See [Workshops & Events](#workshops--events).
- **Social / Messages / Templates** — full CRUD through SlideOver drawers;
  records can be assigned to a team member.
- **Resources** are globally shared — never filtered by assignment.
- **Social** and **Resources** support CSV/Excel bulk import/export.

### Removed modules
The **Daily Work Log** was replaced by the Work Tracker. Its tables were
**renamed, not dropped** — `daily_logs_archive` (17 rows) and
`daily_checkins_archive` (2 rows) hold the team's real August entries and are
read-only. `/daily` and `/daily-logs` redirect to `/work-tracker`.

Dashboard, Companies, Consulting, App Development and Analytics were removed.
Their pages, routes, nav entries, server code (`server/analytics.ts`,
`server/reports.ts`) and their `Company` / `Session` / `Followup` / `Project`
sheets are gone from the types, schemas and store allowlist, and their records
were deleted from the database. `@dnd-kit/core` and `pdfkit` went with them.

## Work Tracker

One screen at `/work-tracker`: a dense Jira-style table where every row is a
piece of work and every field is edited in place. Backed by `tasks`,
`task_activity` and `users` in `db/work-tracker.sql`.

**One table for the whole team.** `tasks` is filtered by `user_id`; there is no
table, schema or database per person. The person filter is a WHERE clause.
**One person per task** — there is no collaborators table.

### Pipeline and rules

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

### Late, slipped, at risk

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

### The toolbar

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

### Columns

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

**Recorded work is read-only.** A field that already holds a value cannot be
changed without the admin passcode, and neither can deleting a task. A field
that is still empty stays editable — filling in a blank adds information, it
does not revise a record, and making people unlock to enter a missing due date
would only teach them to leave the app unlocked all day. Note that status and
priority always hold a value, so every progress update needs the passcode; that
is the intended trade and it is the main day-to-day cost of the freeze.

The lock is one gate shared with the Settings page: unlocking either unlocks
both, for the life of the tab. The toolbar shows **Locked** / **Unlocked** so
the state is visible before somebody clicks a cell and finds it inert.

It is enforced in the API, not only on screen — every edit carries the passcode
in an `x-settings-passcode` header and `server/handlers.ts` refuses the ones
that do not. A check that lived only in the browser would be a suggestion, and
one PATCH from anywhere else would walk straight past it.

**What this is not.** It is not authentication. This app has no login, everyone
shares one passcode, and anyone holding it — or reading a tab's session storage
— can change anything. It stops accidents and casual edits; it does not record
who made a change, and it does not keep out anybody determined. See
`src/lib/lock.ts`.

**Adding work while viewing one person.** Filtered to somebody, the new row's
Name is frozen to them — their avatar and name, no picker. A picker there could
only ever file the task out of the view that was just asked for. Viewing
everyone, it is a picker again, defaulting to whoever is set on the right.

### Identity

There is no login. The **I am** selector is treated as the current user and is
passed to the API as `?actor=`. **This is a label, not authentication** — a
caller can name anyone. Real enforcement needs the auth described above.

Switching back to Everyone widens the table but **keeps you as the last person
picked**. Approval is done on somebody else's work, so an approver has to be
able to see the whole team without ceasing to be themselves.

The selector carries no label. Who you are shows in its hover title, and in the
Approve item's tooltip when it refuses — which names both the task's approver
and you, so a disabled item is never a mystery.

### Team and reporting lines

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

### Sample data

`node scripts/seed-work-tracker.mjs` adds 10 sample tasks across all five
statuses, including overdue, slipped and at-risk rows. `--clear` removes them.
Only tasks are invented; real people are never given invented attributes.

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
  pages/         WorkTracker, Events*, Social, Resources, Messages, Templates, Settings
server/          store (file/Postgres), runtime-agnostic handlers, Vite plugin,
                 events + work-tracker (dedicated-table data access)
api/             Vercel function wrapper
db/              production SQL schema + one-time migrations,
                 events + work-tracker schemas
```

## Deploying to Neon + Vercel
1. Run `db/migrations.sql` against your Neon database, then `db/events.sql`
   and `db/work-tracker.sql` (both additive and idempotent — they only create
   their own tables; `work-tracker.sql` reads `records` once, to seed the team
   roster from Settings, and never writes to it).
2. Set `DATABASE_URL` as a Vercel environment variable (the same pooled Neon
   connection string used locally). `server/store.ts` picks up Postgres
   automatically whenever it is present.
3. Deploy to Vercel — `vercel.json` routes `/api/*` to the catch-all function
   and everything else to the SPA.


## Clearing and restoring

`node scripts/clear-work-tracker.mjs --yes` empties the tracker. It writes every
task to `backups/work-tracker-<timestamp>.json` first and prints the command
that puts them back — `node scripts/restore-work-tracker.mjs <file>`, which
restores each task under its original id, so running it twice is harmless. The
roster in `users` is left alone either way: people are managed on the Settings
page, and deleting them would orphan anything restored afterwards. `backups/` is
gitignored.
