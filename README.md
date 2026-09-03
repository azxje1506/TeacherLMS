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

**Implemented on the `sprint-8-reviews` branch and verified on a hosted Vercel
Preview deployment:** **Reviews** — a student's month, assessed. Ten skill
ratings (1–5) and five text fields, on:

- the **reviews index** — one card per reviewable student, with the latest
  review's average, performance label, review count and latest month;
- the **dedicated composer** — one full-page surface for Create, View and Edit,
  with the generated monthly report rendered live beside the form. A saved
  review opens as something to read and becomes editable only when the teacher
  says so; there is no lifecycle behind that, just screen state;
- the **Student Profile Reviews tab** — the history timeline plus the analytics
  the amendment added: skill radar with previous-month comparison, score trend,
  score distribution, skill heatmap, strengths / focus areas and the monthly
  learning journey;
- **Print** and **Export PDF** of the monthly report, from every stage —
  including a Create that has never been saved, because the report is generated
  from what is on screen rather than from a record.

Routes, all behind the session:

- `GET /api/reviews` — the index payload
- `POST /api/reviews` — write one review
- `PATCH /api/reviews/:id` — correct one review
- `GET /api/reviews/student/:studentId` — one student's history and month options
- `GET /api/reviews/composer` — the composer's context for one student
- `GET /api/reviews/:id/report` — one persisted review, as the report model

Screens: `/reviews`, `/reviews/new?studentId=…`, `/reviews/{reviewId}`, and the
profile's `?tab=Reviews`.

There is no Review `DELETE` and no `GET /api/reviews/:id`.

Print and PDF are **client-side and read-only**: printing unwraps the report
overlay through the app's print stylesheet, and the export draws the same report
DTO with jsPDF over an embedded Unicode font (`public/fonts/Roboto-*.ttf`,
Apache-2.0) so Vietnamese renders correctly. Neither saves, neither touches the
form's dirty state, and neither adds a server endpoint. Skill-bar colour is
per rating (the app's existing 1-5 performance bands) on all four surfaces, and
the teacher summary names every skill tied at the highest or lowest rating rather
than picking one. The print layout is budgeted to keep a short report on one A4
page; the URL, date, page number and site name that a browser draws at the edges
of a printed sheet are the **browser's** own headers and footers and cannot be
removed by the app — a reader who wants a completely clean sheet turns them off
in their own print dialog. **Browser print omits the app's report footer**: the
screen preview keeps it and the downloaded PDF draws its own at the bottom of
every page — that file is the family-facing generated document — but the
printed sheet sizes entirely from its content, so no footer geometry can cost
it a page. The teacher summary renders as a
card per item — strongest skills, focus areas, biggest improvement — with the
skill names wrapping rather than being shortened, in the same structure on
screen, on paper and in the file.

Sprint 8's implementation is **complete**, and the branch has been verified on a
hosted **Vercel Preview** deployment at
`teacher-lms-git-sprint-8-reviews-azjxe.vercel.app`, running deployed SHA
`c19629c`. A human browser pass against that deployment **passed**. Keep the two
facts apart: the *deployment environment* was Preview, while the *database* it
read was production Atlas — a Preview deployment reading production data is not
a Vercel **Production** deployment, and nothing here claims one happened.

One production change has been made, and it is DDL rather than data: the
`(studentId, month)` unique index — `review_student_month_unique` — was created
explicitly in Gate 5.1, and `models.ts` declares the matching index as of Gate
5.2, so source and production describe the same index by name, key, key order
and uniqueness. Because the index already existed with an identical spec,
mongoose's default `autoIndex` build on the Preview deployment's first model use
was a **no-op**: the hosted rollout created no index, dropped none and changed
none, and produced **no duplicate compound index** — `studentId_1_month_1` does
not exist. There was **no deployment-time DDL**.

**No production Review was created, edited or deleted** at any point in Sprint 8,
rollout verification included, and the Homework baseline is likewise untouched:
`reviews` still holds 33 documents at digest
`c4418428f5d247b7c58caf046ce09c6e71f24dd30caab3bc86d4032a5fa8c4d5` with 11 ghost
reviews over 5 deleted students and 0 duplicate pairs, and `homeworks` still
holds 15 at digest
`aef736e9931fac3350c6b7a9a2d17834ca3f22566792f952183fc7ed9e85741f`.

Closure audit **passed**. **Sprint 8 remains open until this `main` revision is
deployed to Vercel Production and that deployment is verified.**

The read-only production check is `npm run reviews:integrity`; it reports the
collection's count, digest, month histogram, ghost-review count and any duplicate
`(studentId, month)` pairs, and it runs **observationally**. Global Search
remains deferred: the header seam exists and calls nothing.

**In progress (incremental):** Students, Parents, Classes, Lessons,
Finance, Reports, Calendar and Settings screens — each ported
from the design comp with its create/edit drawer, list/empty/loading/error
states, API routes and validation.

## Business rules

Tuition/revenue and lesson-type rules live in [`CLAUDE.md`](./CLAUDE.md) and are
implemented in `src/lib/finance.ts` and `src/lib/generate.ts`.
