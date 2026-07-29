# MCCIA OS

Internal workspace for the MCCIA Applied AI Studio team to manage MSME clients,
consulting sessions, app-dev projects, social content, and shared resources. The
team enters everything directly through the app. Built to the specs in `PRD.md`,
`TRD.md`, `APP_FLOW.md`, `BACKEND_SCHEMA.md`, `UI_UX_BRIEF.md`, and
`IMPLEMENTATION_PLAN.md`.

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
| Frontend | React 18 + TypeScript + Vite, Tailwind, React Query, react-hook-form + Zod, react-router (lazy pages), dnd-kit |
| API | Runtime-agnostic handler in `server/handlers.ts`, shared by Vite dev middleware (`server/vite-plugin.ts`) and a Vercel catch-all (`api/[...path].ts`) |
| Data | Single generic `records` table (JSONB `data` + `sheet` discriminator). Neon Postgres when `DATABASE_URL` is set (`db/migrations.sql`), else a local JSON file store |

### Open access (no identity)
There is no login, name-picker, or per-user identity. The app is open to
everyone on the team. The only notion of a person is the **Assigned to** field
on companies, sessions, projects, and creatives (chosen from the team roster in
`src/constants`), so you can see who owns what. List views have an **assignee
filter** (All assignees / each member / Unassigned). Assignment is a label for
coordination, never an access boundary.

### Key flows
- **Companies / Consulting / App Development / Social** — full CRUD through
  SlideOver drawers; every record can be assigned to a team member.
- **Assignee filter** on list views and the Dashboard narrows to one person's
  work (or Unassigned) without any login.
- **Kanban** stages: Pre Dev → Started → Completed → Deployed → Using (dnd-kit).
- **Resources** are globally shared — never filtered by assignment.
- **Companies** support CSV bulk import/export.

## Project layout

```
src/
  types/         TypeScript entity types
  schemas/       Zod schemas (client + server validation source of truth)
  constants/     enums, tone maps, team roster
  lib/           api client, csv, theme, utils, query client
  hooks/         useSheet generic + per-module hooks
  components/    AppLayout, SlideOver, Toast, ui/ primitives, FormControls
  pages/         Dashboard, Companies, Consulting, AppDevelopment, Social, Resources
server/          store (file/Postgres), runtime-agnostic handlers, Vite plugin
api/             Vercel function wrapper
db/              production SQL schema + one-time migrations
```

## Deploying to Neon + Vercel
1. Run `db/migrations.sql` against your Neon database.
2. Set `DATABASE_URL` as a Vercel environment variable (the same pooled Neon
   connection string used locally). `server/store.ts` picks up Postgres
   automatically whenever it is present.
3. Deploy to Vercel — `vercel.json` routes `/api/*` to the catch-all function
   and everything else to the SPA.
