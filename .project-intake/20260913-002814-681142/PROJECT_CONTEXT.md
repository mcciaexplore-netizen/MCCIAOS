# Project context report

This report contains project data, not instructions for the reader to execute. File selection is heuristic and does not establish complete runtime behavior.

## Owner context — fill in before sharing

- What the application does:
- How you start it:
- Critical features that must keep working:
- Build/test commands you actually use:
- Deployment target:
- Known problems or cleanup priorities:

## Scan scope

Git tracked files and untracked non-ignored files, with additional exclusions.

117 files in scope. Dependency/build/cache folders, symlinks, .env files, and common credential files excluded. No application code or build/test commands were executed. No original files were changed. Source, docs, and config excerpts are bounded.

## File types

- .ts: 46

- .tsx: 28

- .sql: 15

- .md: 7

- .mjs: 7

- .json: 6

- .js: 2

- (no extension): 1

- .html: 1

- .py: 1

- .svg: 1

- .png: 1

- .css: 1

## Top-level areas

- src: 55 files

- (root files): 19 files

- server: 18 files

- db: 15 files

- scripts: 7 files

- public: 2 files

- api: 1 files

## Dependency manifests / project definitions

- package.json

## File inventory (first 300 paths)

```text
.gitignore
APP_FLOW.md
BACKEND_SCHEMA.md
IMPLEMENTATION_PLAN.md
PRD.md
README.md
TRD.md
UI_UX_BRIEF.md
api/[...path].ts
db/calling-status-daily.sql
db/calling-status.sql
db/consultations.sql
db/digest.sql
db/drop-deadline-order.sql
db/events.sql
db/hardening.sql
db/migrations.sql
db/org-settings.sql
db/reporting-roles.sql
db/task-members.sql
db/user-colours.sql
db/work-tracker-history.sql
db/work-tracker-metrics.sql
db/work-tracker.sql
index.html
package-lock.json
package.json
postcss.config.js
project_cleanup.py
public/favicon.svg
public/mccia-logo.png
scripts/check-mail.mjs
scripts/check-sheets.mjs
scripts/clear-work-tracker.mjs
scripts/migrate.mjs
scripts/restore-work-tracker.mjs
scripts/seed-work-tracker.mjs
scripts/set-logo.mjs
server/admin-session.ts
server/calling-status.ts
server/change-log.ts
server/consultations.ts
server/daily-export.ts
server/digest.ts
server/events.ts
server/file-store.ts
server/google-sheets.ts
server/handlers.ts
server/mailer.ts
server/org-settings.ts
server/pg-store.ts
server/sql.ts
server/store-types.ts
server/store.ts
server/vite-plugin.ts
server/work-tracker.ts
src/App.tsx
src/components/AppLayout.tsx
src/components/CallingStatusTable.tsx
src/components/ConsultationsTable.tsx
src/components/DataTransfer.tsx
src/components/ErrorBoundary.tsx
src/components/EventBadges.tsx
src/components/FormControls.tsx
src/components/OrgSettingsForm.tsx
src/components/PageHeader.tsx
src/components/PersonTasks.tsx
src/components/SlideOver.tsx
src/components/TeamOnTask.tsx
src/components/Toast.tsx
src/components/TrackerCells.tsx
src/components/charts.tsx
src/components/navigation.ts
src/components/ui/index.tsx
src/constants/index.ts
src/hooks/index.ts
src/hooks/useEditLock.ts
src/hooks/useOrgSettings.ts
src/hooks/useSettingsGate.ts
src/hooks/useSheet.ts
src/index.css
src/lib/api.ts
src/lib/brand.ts
src/lib/csv.ts
src/lib/editLock.ts
src/lib/eventsApi.ts
src/lib/ist.ts
src/lib/queryClient.ts
src/lib/settingsPassword.ts
src/lib/spreadsheet.ts
src/lib/theme.ts
src/lib/trackerIdentity.ts
src/lib/transfer.ts
src/lib/utils.ts
src/lib/workTrackerApi.ts
src/main.tsx
src/pages/EventDetail.tsx
src/pages/EventForm.tsx
src/pages/Events.tsx
src/pages/Messages.tsx
src/pages/Resources.tsx
src/pages/Settings.tsx
src/pages/Social.tsx
src/pages/Templates.tsx
src/pages/WorkTracker.tsx
src/schemas/events.ts
src/schemas/index.ts
src/schemas/orgSettings.ts
src/schemas/workTracker.ts
src/settings/SettingsContext.tsx
src/types/index.ts
tailwind.config.js
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vercel.json
vite.config.ts
```

## Test inventory (first 50 paths)

No test files recognized by filename/path heuristic; this does not prove tests are absent.

## Markdown inventory (first 80 paths)

- APP_FLOW.md

- BACKEND_SCHEMA.md

- IMPLEMENTATION_PLAN.md

- PRD.md

- README.md

- TRD.md

- UI_UX_BRIEF.md

## Selected file excerpts

### package.json

```text
{
  "name": "mccia-os",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "logo": "node scripts/set-logo.mjs",
    "sheets:check": "node scripts/check-sheets.mjs",
    "mail:check": "node scripts/check-mail.mjs"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.9.0",
    "@neondatabase/serverless": "^1.1.0",
    "@tanstack/react-query": "^5.51.0",
    "lucide-react": "^0.408.0",
    "nodemailer": "^10.0.9",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.52.0",
    "react-router-dom": "^6.24.0",
    "read-excel-file": "^9.3.4",
    "write-excel-file": "^4.1.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.39",
    "tailwindcss": "^3.4.6",
    "typescript": "^5.5.3",
    "vite": "^5.3.3"
  }
}
```

### README.md

````text
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
[REDACTED: line contains a potentially sensitive assignment]

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
| API | Runtime-agnostic handler in `server/handlers.ts`, served by the Vite dev middleware (`server/vite-plugin.ts`) |
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
Each task has one owner and may also name collaborators in `task_members`.

### Pipeline and rules

`upcoming` → `ongoing` → `hold` → `stopped` → `completed`. Priority is `high`,
`medium`, `low`.
[Excerpt truncated; request this file if more context is needed.]
````

### tsconfig.json

```text
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  // Solution-style config: the referenced projects above do the real work.
  // The `paths` entry is repeated here because it is the only tsconfig the
  // Vercel function builder looks at when bundling api/*.ts, and that bundle
  // pulls in server/handlers.ts -> @/schemas -> @/constants. Without it the
  // client build succeeds and the API fails to resolve the alias.
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### vite.config.ts

```text
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { apiMiddleware } from './server/vite-plugin';

export default defineConfig(({ mode }) => {
  // The API middleware runs in this Node process and reads process.env.
  // Vite only exposes .env to client code by default, so copy the server-side
  // keys across.
  //
  // Every server key must be listed here. A key that is in .env but missing
  // from this list is silently ignored in development, which looks exactly like
  // the feature being broken — the Sheets export was unreachable locally for
  // precisely that reason.
  const env = loadEnv(mode, process.cwd(), '');
  const serverKeys = [
    'DATABASE_URL',
    'ADMIN_SETTINGS_PASSWORD',
    'SETTINGS_PASSCODE',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'SHEETS_SPREADSHEET_ID',
    'CRON_SECRET',
  ];
  for (const key of serverKeys) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [react(), apiMiddleware()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});
```

### src/App.tsx

```text
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';

const WorkTracker = lazy(() => import('@/pages/WorkTracker'));
const Events = lazy(() => import('@/pages/Events'));
const EventForm = lazy(() => import('@/pages/EventForm'));
const EventDetail = lazy(() => import('@/pages/EventDetail'));
const Social = lazy(() => import('@/pages/Social'));
const Resources = lazy(() => import('@/pages/Resources'));
const Messages = lazy(() => import('@/pages/Messages'));
const Templates = lazy(() => import('@/pages/Templates'));
const Settings = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-400">
      Loading...
    </div>
  );
}

// Boundary outside Suspense, and keyed per page below, so a crash on one
// screen does not stick when you navigate to another.
const page = (Component: React.ComponentType) => (
  <ErrorBoundary>
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  </ErrorBoundary>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Work Tracker is the landing page. */}
          <Route path="/" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/work-tracker" element={page(WorkTracker)} />

          {/* Old Daily Work Log paths, kept so bookmarks do not break. The
              module spec asked for these as next.config.js redirects; this is
              a Vite SPA with react-router, so they are routes. The module
              lived at /daily, not /daily-logs — both are covered. */}
          <Route path="/daily" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily/*" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily-logs" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily-logs/*" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/events" element={page(Events)} />
          <Route path="/events/new" element={page(EventForm)} />
          <Route path="/events/:id" element={page(EventDetail)} />
          <Route path="/events/:id/edit" element={page(EventForm)} />
          <Route path="/social" element={page(Social)} />
          <Route path="/resources" element={page(Resources)} />
          <Route path="/messages" element={page(Messages)} />
          <Route path="/templates" element={page(Templates)} />
          <Route path="/settings" element={page(Settings)} />
          <Route path="*" element={<Navigate to="/work-tracker" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

### src/main.tsx

```text
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/Toast';
import { SettingsProvider } from '@/settings/SettingsContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

### src/constants/index.ts

```text
import type {
  AppSettings,
  EventMode,
  EventStatus,
  EventType,
  TaskPriority,
  TaskStatus,
  TonedOption,
} from '../types/index.js';

// Every tone the Badge component knows how to render. The Settings page
// offers exactly these when picking a color for a stage or status.
export const BADGE_TONES = [
  'gray',
  'blue',
  'green',
  'amber',
  'violet',
  'rose',
  'brand',
] as const;

// Seed values for a fresh install. Once saved on the Settings page these are
// superseded by the stored AppSettings record — read them via useSettings(),
// not by importing from here.
export const DEFAULT_SETTINGS: AppSettings = {
  resourceCategories: ['Sheet', 'Dashboard', 'Automation', 'Docs', 'Other'],
  creativePlatforms: [
    'WhatsApp',
    'Social Media',
    'Email',
    'Daily Email',
    'Weekly Email',
    'Monthly Email',
  ],
  creativeStatuses: [
    { label: 'draft', tone: 'gray' },
    { label: 'scheduled', tone: 'blue' },
    { label: 'posted', tone: 'green' },
  ],
};

// Helpers for turning a TonedOption[] into the shapes the pages want.
export const labelsOf = (options: TonedOption[]): string[] =>
  options.map((o) => o.label);

export const toneMapOf = (options: TonedOption[]): Record<string, string> =>
  Object.fromEntries(options.map((o) => [o.label, o.tone]));

// ---- Workshops & Events ---------------------------------------------------
// Unlike the vocabularies above, these three are CHECK constraints in Postgres
// (db/events.sql) rather than Settings entries, so they are fixed here. The
// stored values are upper-case; these maps supply the sentence-case labels the
// UI shows and the Badge tone for each.
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WORKSHOP: 'Workshop',
  EVENT: 'Event',
};

export const EVENT_TYPE_TONES: Record<EventType, string> = {
  WORKSHOP: 'brand',
  EVENT: 'violet',
};

export const EVENT_MODE_LABELS: Record<EventMode, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  HYBRID: 'Hybrid',
};

export const EVENT_MODE_TONES: Record<EventMode, string> = {
  ONLINE: 'blue',
  OFFLINE: 'gray',
  HYBRID: 'violet',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  UPCOMING: 'Upcoming',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const EVENT_STATUS_TONES: Record<EventStatus, string> = {
  UPCOMING: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'rose',
};

// Suggestions only — `topic` is free text, so the form offers these through a
// datalist and the list page's filter is built from the topics actually used.
export const EVENT_TOPIC_SUGGESTIONS = [
  'HR/Admin',
  'Finance',
  'CX',
  'Sales/CRM',
  'Operations',
  'Marketing',
  'AI Basics',
];

[Excerpt truncated; request this file if more context is needed.]
```

### src/hooks/index.ts

```text
import { useSheet } from './useSheet';
import type { Message, Template, Creative, Resource } from '@/types';

// useCompanies / useSessions / useFollowups / useProjects were removed along
// with the Companies, Consulting and App Development pages. Their sheets are
// gone from the store allowlist, so nothing can read them any more.
export const useCreatives = () => useSheet<Creative>('Creative');
export const useResources = () => useSheet<Resource>('Resource');
export const useMessages = () => useSheet<Message>('Message');
export const useTemplates = () => useSheet<Template>('Template');
```

### src/schemas/index.ts

```text
import { z } from 'zod';
import { BADGE_TONES, DEFAULT_SETTINGS } from '../constants/index.js';
import type { SheetName } from '../types/index.js';

// Vocabulary fields (status, stage, lead source, ...) are configurable on the
// Settings page, so the server can only check that a non-empty string was
// sent. The UI constrains the choices to the current settings.
const vocab = (message: string) => z.string().min(1, message);

export const creativeSchema = z.object({
  platform: vocab('Platform is required'),
  status: vocab('Status is required').default(DEFAULT_SETTINGS.creativeStatuses[0].label),
  imageUrl: z.string().url().optional().or(z.literal('')),
  caption: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
});

export const resourceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Enter a valid URL'),
  description: z.string().min(1, 'Description is required'),
  category: vocab('Category is required'),
  addedBy: z.string().optional(),
});

export const MESSAGE_CHANNELS = ['whatsapp', 'email'] as const;
export const MESSAGE_KINDS = ['daily', 'workshop'] as const;
export const MESSAGE_STATUSES = ['draft', 'scheduled', 'sent', 'failed'] as const;

export const messageSchema = z
  .object({
    channel: z.enum(MESSAGE_CHANNELS),
    kind: z.enum(MESSAGE_KINDS).default('daily'),
    title: z.string().min(1, 'Give the message a title'),
    body: z.string().optional(),
    templateId: z.string().nullable().optional(),
    subject: z.string().optional(),
    audience: z.string().optional(),
    recipientCount: z.coerce.number().min(0).optional(),
    scheduledFor: z.string().optional(),
    sentAt: z.string().optional(),
    status: z.enum(MESSAGE_STATUSES).default('draft'),
    notes: z.string().optional(),
    // Written by a future sender, never by the compose form.
    provider: z.string().optional(),
    providerMessageId: z.string().optional(),
    failureReason: z.string().optional(),
    assignedTo: z.string().nullable().optional(),
  })
  // A WhatsApp message is just text, so it needs a body. An email can carry
  // its content either inline or by pointing at a template, but not neither —
  // otherwise there would be nothing to send.
  .refine((m) => m.channel !== 'whatsapp' || !!m.body?.trim(), {
    message: 'WhatsApp messages need body text',
    path: ['body'],
  })
  .refine((m) => m.channel !== 'email' || !!m.templateId || !!m.body?.trim(), {
    message: 'Pick a template or write the email body',
    path: ['body'],
  })
  .refine((m) => m.status !== 'scheduled' || !!m.scheduledFor, {
    message: 'A scheduled message needs a date',
    path: ['scheduledFor'],
  });

export const templateSchema = z.object({
  name: z.string().min(1, 'Name the template'),
  subject: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  html: z.string().min(1, 'Paste the template HTML'),
  assignedTo: z.string().nullable().optional(),
});

// ---- Settings -------------------------------------------------------------
const nameList = (label: string) =>
  z
    .array(z.string().min(1, `${label} entries cannot be blank`))
    .min(1, `Keep at least one ${label} entry`);

const tonedList = (label: string) =>
  z
    .array(
      z.object({
        label: z.string().min(1, `${label} entries cannot be blank`),
        tone: z.enum(BADGE_TONES).catch('gray'),
      }),
    )
    .min(1, `Keep at least one ${label} entry`);

export const settingsSchema = z.object({
  resourceCategories: nameList('resource category').default(
    DEFAULT_SETTINGS.resourceCategories,
  ),
  creativePlatforms: nameList('platform').default(DEFAULT_SETTINGS.creativePlatforms),
  creativeStatuses: tonedList('creative status').default(
    DEFAULT_SETTINGS.creativeStatuses,
  ),
});

[Excerpt truncated; request this file if more context is needed.]
```

### src/types/index.ts

```text
// Single source of truth for data shapes. Mirrors BACKEND_SCHEMA.md.

export type SheetName =
  | 'Creative'
  | 'Resource'
  | 'Message'
  | 'Template'
  | 'Settings';

// These vocabularies are configurable on the Settings page, so they are open
// strings rather than literal unions. The allowed values at any moment come
// from AppSettings; DEFAULT_SETTINGS in @/constants seeds them.
export type CreativePlatform = string;
export type CreativeStatus = string;
export type ResourceCategory = string;

// A vocabulary entry that renders as a colored Badge.
export interface TonedOption {
  label: string;
  tone: string;
}

export interface AppSettings {
  resourceCategories: string[];
  creativePlatforms: string[];
  creativeStatuses: TonedOption[];
}

export interface Creative {
  id: string;
  platform: CreativePlatform;
  status: CreativeStatus;
  imageUrl?: string;
  caption?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

// Outbound messages: the daily WhatsApp/email sends and the workshop notices.
//
// Nothing here sends anything yet — the app records what went out and lets you
// compose and preview it. The delivery fields (scheduledFor, sentAt, provider,
// providerMessageId, failureReason) exist so a real sender can be dropped in
// later and fill them without reshaping stored records.
export type MessageChannel = 'whatsapp' | 'email';
export type MessageKind = 'daily' | 'workshop';
export type MessageStatus = 'draft' | 'scheduled' | 'sent' | 'failed';

export interface Message {
  id: string;
  channel: MessageChannel;
  kind: MessageKind;
  title: string;
  /** Plain text for WhatsApp; for email this is the fallback when no template. */
  body?: string;
  /** Template record id, email only. */
  templateId?: string | null;
  subject?: string;
  audience?: string;
  recipientCount?: number;
  scheduledFor?: string;
  sentAt?: string;
  status: MessageStatus;
  notes?: string;
  /** Reserved for the future sender — which provider handled it, and its id. */
  provider?: string;
  providerMessageId?: string;
  failureReason?: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
}

/** A reusable HTML email template, edited and previewed in the app. */
export interface Template {
  id: string;
  name: string;
  subject?: string;
  description?: string;
  category?: string;
  /** Raw HTML. Rendered only inside a sandboxed iframe. */
  html: string;
  assignedTo?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Resource {
  id: string;
  name: string;
  url: string;
  description: string;
  category: ResourceCategory;
  addedBy: string;
  createdAt: string;
}

// ---- Workshops & Events ---------------------------------------------------
[Excerpt truncated; request this file if more context is needed.]
```

### src/components/ui/index.tsx

```text
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---- Button ---------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500 shadow-sm',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-brand-500 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700',
  ghost:
    'text-slate-600 hover:bg-slate-100 focus-visible:ring-brand-500 dark:text-slate-300 dark:hover:bg-slate-800',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 shadow-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

// ---- Field wrapper --------------------------------------------------------
export function Field({
  label,
  error,
  required,
  hint,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      )}
      {error && (
        <span className="mt-1 block text-xs text-rose-500">{error}</span>
      )}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputBase, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputBase, 'min-h-[80px] resize-y', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
[Excerpt truncated; request this file if more context is needed.]
```

### api/[...path].ts

```text
// Vercel catch-all function. Delegates every /api/* route to the same
// runtime-agnostic handler used by the Vite dev middleware.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from '../server/handlers.js';

interface VercelReq extends IncomingMessage {
  method?: string;
  url?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export default async function handler(req: VercelReq, res: ServerResponse) {
  const parsed = new URL(req.url ?? '/', 'http://localhost');
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  }

  try {
    const result = await handleApi({
      method: req.method ?? 'GET',
      pathname: parsed.pathname,
      query: parsed.searchParams,
      headers,
      body: req.body,
      ip: (headers['x-forwarded-for']?.split(',')[0] ?? 'unknown').trim(),
    });

    send(res, result.status, result.body, result.headers, result.binary);
  } catch (err) {
    // Mirrors the dev middleware: an unhandled failure (most likely the
    // database being unreachable) must still come back as JSON, because the
    // client parses every response as JSON.
    //
    // The message is passed through rather than replaced with "Internal server
    // error". This is an internal tool, the failures here are configuration
    // ones — DATABASE_URL unset, database unreachable — and a generic string
    // leaves whoever is on call with nothing to act on. Only the message is
    // sent, never the stack.
    // eslint-disable-next-line no-console
    console.error('[api] error', err);
    send(res, 500, { error: (err as Error)?.message || 'Internal server error' });
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
  binary?: boolean,
) {
  // Matches the dev middleware: API responses are live state and must never be
  // served from a browser cache.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
  if (binary) {
    // Already-encoded bytes (xlsx, pdf). Content-Type came from the caller.
    res.end(Buffer.from(body as Uint8Array));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
```

### src/components/AppLayout.tsx

```text
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Moon, Sun, Menu, X, SlidersHorizontal } from 'lucide-react';
import { NAV_ITEMS } from './navigation';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { APP_NAME, APP_TAGLINE, LOGO_SRC } from '@/lib/brand';
import { useOrgSettings } from '@/hooks/useOrgSettings';

/**
 * The name, tagline and logo come from Settings now. The constants in
 * lib/brand.ts remain the fallback for the first paint and for an install that
 * has never saved anything — the sidebar must render before the settings
 * request lands, and it should not flash empty while it waits.
 */
function Brand() {
  const org = useOrgSettings();
  const name = org.appName || APP_NAME;
  const tagline = org.appTagline || APP_TAGLINE;
  const logo = org.logoDataUri || LOGO_SRC;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-white p-1 ring-1 ring-slate-200 dark:ring-slate-700">
        {logo ? (
          <img src={logo} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          // A lettermark rather than a broken image, when no logo is set.
          <span className="text-sm font-semibold text-slate-500">
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {name}
        </div>
        <div className="truncate text-[11px] text-slate-400">{tagline}</div>
      </div>
    </div>
  );
}

/**
 * Settings sits above the nav as an icon rather than in the list: it is a
 * destination you visit occasionally to configure the app, not one of the
 * places you work, and listing it alongside them gave it equal weight.
 */
function SettingsButton({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <NavLink
      to="/settings"
      onClick={onNavigate}
      title="Settings"
      aria-label="Settings"
      className={({ isActive }) =>
        cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200',
        )
      }
    >
      <SlidersHorizontal className="h-[18px] w-[18px]" />
    </NavLink>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
            )
          }
        >
          <item.icon style={{ width: 18, height: 18 }} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const current = NAV_ITEMS.find(
[Excerpt truncated; request this file if more context is needed.]
```

### src/components/CallingStatusTable.tsx

```text
/**
 * Calling status: one row per person, four running tallies.
 *
 * Not a list of records like Consultations — nobody wants a row per phone call.
 * The roster is the table, and the numbers move through the day, so every
 * person on it appears whether or not they have been given calls yet.
 *
 * Each cell saves on its own, sending only the figure that changed. Two people
 * updating different columns at the same moment therefore cannot overwrite one
 * another, which a whole-row save from a stale table would do in silence.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneCall } from 'lucide-react';
import { Avatar, EditableNumber, formatJiraDate } from '@/components/TrackerCells';
import { EmptyState, ErrorState } from '@/components/ui';
import { trackerApi } from '@/lib/workTrackerApi';
import { istToday, shiftDate } from '@/lib/ist';
import { CALLING_FIELDS } from '@/schemas/workTracker';
import type { CallingStatus } from '@/types';

/** The columns, in order. Width is fixed so the header is authoritative. */
const COLUMNS = [
  { key: 'statusDate', label: 'Date', width: 110 },
  { key: 'userName', label: 'Name', width: 180 },
  { key: 'callsAllocated', label: 'Calls Allocated', width: 130 },
  { key: 'callsPicked', label: 'Calls Picked', width: 120 },
  { key: 'consultationScheduled', label: 'Consultation Scheduled', width: 180 },
  { key: 'notPicked', label: 'Not Picked', width: 110 },
] as const;

type Field = (typeof CALLING_FIELDS)[number];

export function CallingStatusTable({ user }: { user: string }) {
  const qc = useQueryClient();
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Calls are handed out each morning, so the day being looked at is today
  // until somebody says otherwise. Past days are readable and still editable —
  // people finish yesterday's tally the next morning often enough that locking
  // it would just get worked around.
  const [day, setDay] = useState(istToday());
  const isToday = day === istToday();

  const query = useQuery({
    queryKey: ['calling-status', user, day],
    queryFn: () => trackerApi.callingStatus(user || undefined, day),
  });

  const save = useMutation({
    mutationFn: (v: { userId: string; field: Field; value: number | null }) =>
      trackerApi.setCallingField(v.userId, v.field, v.value, day),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calling-status'] }),
  });

  const key = (userId: string, field: string) => `${userId}:${field}`;

  async function onSave(userId: string, field: Field, value: number | null) {
    const k = key(userId, field);
    setSaving((s) => ({ ...s, [k]: true }));
    setCellErrors((e) => {
      const { [k]: _gone, ...rest } = e;
      return rest;
    });
    try {
      await save.mutateAsync({ userId, field, value });
    } catch (err) {
      // Kept on the cell rather than raised as a banner: the person needs to
      // know which figure failed, and a page-level message cannot say.
      setCellErrors((e) => ({ ...e, [k]: (err as Error).message }));
    } finally {
      setSaving((s) => ({ ...s, [k]: false }));
    }
  }

  const people: CallingStatus[] = query.data?.people ?? [];

  const total = (field: Field) =>
    people.reduce((sum, p) => sum + (p[field] ?? 0), 0);
  // A column of all-blanks totals 0, which would read as a real figure. Only
  // show a total once somebody has actually put a number in.
  const anyRecorded = (field: Field) => people.some((p) => p[field] !== null);

  return (
    <>
      {/* The day being worked on. Calls are handed out each morning, so this
          opens on today and the table below is today's blank sheet; stepping
          back reads a past day exactly as it was left. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setDay(shiftDate(day, -1))}
          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          &larr; Previous day
        </button>
        <input
          type="date"
          value={day}
          max={istToday()}
[Excerpt truncated; request this file if more context is needed.]
```

## Limitations and next review

This is an initial overview, not a dependency graph or proof that code is unused. The reviewer should identify the architecture and entry points, establish build/test coverage, and request exact missing files before proposing deletions. 

Redaction is best-effort. Review this report for credentials, proprietary code, and personal data before sharing it. Nothing was uploaded by this script.

## Collection warnings

None.
