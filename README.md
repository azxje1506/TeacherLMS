# English Tutor LMS

A calm, single-teacher Learning Management System — students, parents, classes,
lessons, attendance, homework, monthly reviews, tuition/finance and reports —
implemented in **Next.js 16 (App Router)** from an imported Claude Design comp,
preserved **pixel-for-pixel**.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** conventions; the design system is ported
  verbatim from the design comp into `src/app/globals.css` (CSS variables driven
  by `data-theme` / `data-accent` / `data-surface` / `data-spacing`).
- **MongoDB Atlas** via **Mongoose** (Route Handlers under `app/api`)
- **JWT auth** (`jose`) in an **HttpOnly cookie**; route protection in `src/proxy.ts`
- **TanStack React Query** for client data fetching
- **React Hook Form + Zod** for forms and validation (schemas shared client/server)
- Deploys on **Vercel**

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

- `MONGODB_URI` — your MongoDB Atlas connection string (Driver → Node.js)
- `JWT_SECRET` — a long random string. Generate one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the single admin account (defaults:
  `teacher@tutor.app` / `demo1234`)

### 3. Seed the database

Loads the admin user and the full deterministic demo dataset (parents, students,
classes, lessons, attendance, billing, homework, reviews, activity):

```bash
npm run seed
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in with the admin credentials.

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel (framework auto-detected).
2. In **Project → Settings → Environment Variables**, add `MONGODB_URI`,
   `MONGODB_DB`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.
3. In **MongoDB Atlas → Network Access**, allow Vercel (add `0.0.0.0/0` or
   Vercel's egress ranges).
4. Deploy. Run the seed once against your Atlas cluster (`npm run seed` locally
   with the production `MONGODB_URI`).

## Project structure

```
design-reference/          The imported Claude Design comp (visual source of truth)
  English Tutor LMS.dc.html
  lib/*.js                  Original vanilla logic modules (reference)
src/
  app/
    (app)/                  Authenticated shell + module pages
    api/                    Route Handlers (auth, dashboard, meta, …)
    login/                  Login screen
    globals.css             Design system, ported verbatim
  components/
    shell/                  Sidebar, Header, AppShell
    ui/                     Toast (shadcn-style additions land here)
    icons.tsx               Inline SVG icons (paths from the design)
  lib/
    types.ts constants.ts calc.ts format.ts i18n.ts   Ported logic (TS)
    finance.ts generate.ts dashboard.ts               Business logic
    db.ts models.ts repo.ts                            MongoDB layer
    auth.ts jwt.ts http.ts schemas.ts                 Auth + validation
    settings-context.tsx                               Theme / i18n / regional
scripts/seed.ts             Atlas seeder
```

## Implementation status

**Done:** project scaffold, design-system port, full domain model + Mongoose
models, deterministic seed + derived lessons/attendance/billing, JWT auth
(login/logout/session + route protection), Settings state (theme/accent/surface/
density + language + regional formats), the app shell (sidebar + header), the
Login screen, the **Dashboard** (revenue engine, KPIs, today's classes,
upcoming lessons, activity), and **Attendance** (register index, take/edit
attendance, and its API) — all pixel-faithful and wired to live data.

**Deployed, production-verified and closed:** **Homework** — the assignment
index with its class filter, the assign/edit drawer, duplicate, and pending-only
delete, plus its API. Deployed and running against production data, and every
operation this MVP ships has been verified against it: the read-only production
check passed (Gate 5 Phase 0), then one controlled create, one edit, Duplicate’s
write-free prefill and one Assigned-only delete — each confirmed by hand in the
hosted app where a visual check applied. The edit changed only the four fields a
teacher authored and left ownership, status and recorded outcomes untouched; the
delete removed only that one smoke assignment, returning production to its
original 15-record baseline, byte-identical, with no test data left behind. The
Sprint 7 closure audit has since **passed**, and **Sprint 7 — Homework is
closed**.
Recording submission outcomes stays deferred: this MVP ships no submission
writer.

**In progress (incremental):** Students, Parents, Classes, Lessons,
Reviews, Finance, Reports, Calendar and Settings screens — each ported
from the design comp with its create/edit drawer, list/empty/loading/error
states, API routes and validation.

## Business rules

Tuition/revenue and lesson-type rules live in [`CLAUDE.md`](./CLAUDE.md) and are
implemented in `src/lib/finance.ts` and `src/lib/generate.ts`.
