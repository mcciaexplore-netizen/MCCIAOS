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

**Percentage.** Tasks carry `percentage` (0-100, nullable — null means nobody
has said). It is the only number left on a task: `consultations_allocated`,
`consultations_done` and `callings_done` were dropped, because they stood empty
on every piece of work that was not a consultation, taking width the actual work
needed. Migrations: `db/work-tracker-metrics.sql`, then `db/consultations.sql`
which retires three of the four.

## Consultations

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

**Recorded work is read-only.** A field that already holds a value cannot be
changed without the admin passcode, and neither can deleting a task. A field
that is still empty stays editable — filling in a blank adds information, it
does not revise a record, and making people unlock to enter a missing due date
would only teach them to leave the app unlocked all day. Note that status and
priority always hold a value, so every progress update needs the passcode; that
is the intended trade and it is the main day-to-day cost of the freeze.

The switch lives in **Settings → Work Tracker**, together with the per-person
bulk clear. The tracker itself shows only a **Locked** / **Unlocked** status that
links there — a status, not a switch, because the alternative is discovering the
table is read-only by clicking a cell and finding it inert with nowhere obvious
to go. Reaching Settings at all requires the passcode, so arriving there unlocks
editing; **Lock again** puts it back without leaving the page.

**Clearing one person's work.** Settings → Work Tracker lists everybody with
what they are carrying and a Clear button each. It hides rather than destroys,
exactly like removing a single task, so a bulk clear made in error is as
recoverable as a single one — which matters more here, not less, because the
mistake is larger. `DELETE /api/tasks` requires `?user=<id>`: there is no
clear-all, because the one button capable of emptying the whole tracker should
not sit next to nine that each empty a single person's.

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


**Removing work does not destroy it.** Deleting a task sets `tasks.deleted_at`
and every read filters on it, so the row and its history stay. The toast that
confirms a deletion offers **Undo** for ten seconds, and
`POST /api/tasks/:id/restore` does the same thing from the API — both need the
passcode, like the delete they reverse.

This exists because deletion was the one hole in the freeze. Changing a filled
field needed the passcode, but deleting the row needed the same passcode and
left nothing at all: `task_activity` cascades, so the trail went with it. A task
called "Mail IIT's" was lost that way on 2026-09-02 and the database could not
say what had happened to it. Each history row now also carries `task_title`, so
the trail reads on its own and a later rename does not rewrite the past.

Migration: `db/work-tracker-history.sql`, applied with
`node scripts/migrate.mjs db/work-tracker-history.sql`. Additive and idempotent
— it adds two columns and an index, drops nothing, and leaves every existing row
visible.

## Clearing and restoring

`node scripts/clear-work-tracker.mjs --yes` empties the tracker. It writes every
task to `backups/work-tracker-<timestamp>.json` first and prints the command
that puts them back — `node scripts/restore-work-tracker.mjs <file>`, which
restores each task under its original id, so running it twice is harmless. The
roster in `users` is left alone either way: people are managed on the Settings
page, and deleting them would orphan anything restored afterwards. `backups/` is
gitignored.


## Daily export to Google Sheets

At 18:00 IST every day each person's work is appended to their own tab of the
MCCIA OS Task sheet, creating the tab if it does not exist. Tabs are matched by
name, case-insensitively and ignoring stray spaces, because a sheet maintained
by hand will have "Aarushi " in it sooner or later and a second tab for the same
person would split their history in two. Somebody with nothing on is skipped
entirely — a tab of empty dated rows is worse than no entry for a quiet day.

Running twice on one day writes once: each tab's last date is read first, and a
day already present is skipped. **Settings → Work Tracker → Run now** does the
same thing on demand and offers to write again anyway, which is what you want
after correcting a task late in the day.

**Setup.** Three environment variables, and the sheet shared with the service
account:

| Variable | Where it comes from |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the service account's `client_email` |
| `GOOGLE_PRIVATE_KEY` | its `private_key`, newlines escaped as `\n` |
| `SHEETS_SPREADSHEET_ID` | the id in the sheet's URL |
| `CRON_SECRET` | any long random string; Vercel Cron presents it |

1. Google Cloud console → new project (or an existing one) → enable the
   **Google Sheets API**.
2. Create a **service account**, then a **JSON key** for it.
3. Open the spreadsheet → Share → paste the service account's address → **Editor**.
   Without this every call returns 403, and the error says so by name.
4. Put the four variables in Vercel's project settings.

The schedule is in `vercel.json` as `30 12 * * *` — 12:30 UTC is 18:00 IST.
Vercel Cron runs in UTC and has no timezone setting, so the offset is baked into
the expression; if India ever changed its offset this line would need changing
with it. On Vercel's Hobby plan crons fire approximately, not to the minute.

The client is `server/google-sheets.ts` — a signed JWT and three REST calls
rather than the `googleapis` package, which is tens of megabytes for the same
three endpoints. `server/daily-export.ts` builds the rows.

Nothing here is required: with none of the variables set the app runs exactly as
before, and the endpoint answers 501 explaining what is missing.



## Settings and admin access

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

### What is editable

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
