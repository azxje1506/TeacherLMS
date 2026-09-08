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

**Implemented on the `sprint-9-finance` branch, merged to `main` and deployed to
Vercel Production:** **Finance** — the month's tuition, on three
tabs at `/finance`:

- **Overview** — three KPI cards, the money summary with its collection bar,
  Outstanding students beside Top performing classes, and Revenue by class with
  an expandable per-student grid;
- **Revenue analytics** — the six-month trend, the lesson-type donut, revenue by
  class and by lesson type;
- **Payments** — the month's bills, filterable by status, class and student.

The Class Detail **Revenue** card is live too, reading the same month payload.

**Two different kinds of money, kept apart everywhere.** `billing` is tuition
*asked for* — a flat 13,100,000đ a month across 14 bills — and `revenue` is
money *earned by teaching*, lesson-derived and attendance-weighted under the
rules in `CLAUDE.md`. They share no join: a Billing record carries no `lessonId`.
The design comp already separates them — solid bill-derived tiles beside a
**dashed** "Lesson revenue · completed lessons · informational" tile — and the
port keeps that separation in the code's vocabulary as well as on the screen: no
bill-derived field, type or test is called `revenue`. The tile row is Paid
students, Unpaid students and that dashed tile; the Partially paid count lives
in the money summary above it and is not drawn twice.

Routes, both behind the session:

- `GET /api/finance?month=YYYY-MM` — one month's billing and revenue branches,
  plus the twelve-month window the selector offers
- `PATCH /api/finance/:billId` — record a payment against one bill

**Finance is read-only in the UI.** The mutation endpoint is complete and
tested, and **nothing on any screen calls it**: no form, no drawer, no status
dropdown, and no disabled button hinting at one. The comp draws Record / Manage
buttons but contains no payment form anywhere, and two of its three row actions
cannot be honestly shipped without one — so all three wait for a design, as
PROJECT_RULES requires. The **Method** column is absent for the same reason:
`methodIcon` / `methodLabel` exist in the comp with no field behind them, in the
model, in production or in the dictionary.

**Historical bills whose student was deleted are counted and never named.** They
stay in every total — deleting a student must not move a closed month's figures —
and they raise no row, because a working list of who owes money cannot contain
somebody who is gone. No id, name, former parent or placeholder row for such a
record ever reaches the client. Where that makes an **aggregate** larger than the
rows beneath it, the screen says so in a sentence — "*{N} historical payment
records no longer have student information.*" / "*Có {N} khoản thu lịch sử không
còn thông tin học sinh.*" — shown in exactly two places, the month's money
summary and a class's expanded student detail. It is a muted, inert caption: no
handler, no cursor, no underline, nothing to press. Outstanding students, the
Payments table and the Top-performing ranking disclose nothing at all, because
they are lists a teacher acts on.

**Finance shows the money it can prove, and states the rest separately.** Nine
legacy `Partially Paid` bills were recorded without an amount and none is
recoverable from their notes, so their own Paid and Remaining cells read
`Not recorded` and `Not determined` — two different facts, a cause and its
consequence, and **never 0đ, never half the fee, never a backfill**.

An aggregate is never withheld because of them. A month reports
`knownCollected` and `knownOutstanding`, and

    knownCollected + knownOutstanding + unknownAmount === billed

holds by construction, where `unknownAmount` is the *fee* of every bill whose
split nobody recorded — not a payment and not a debt. The collection bar draws
all three, the third in a neutral tone, so the picture always adds up, and a
muted caption says how many records are responsible — separately for the ones a
teacher could still settle and the ones whose student no longer exists.
**Expected revenue stays exact throughout**, because Σ fee needs no partial
amount. Every class is ranked on its confirmed collected total, marked `≥` when
that total is a floor rather than removed from the ranking. Students with no
linked Parent are marked `No linked parent` wherever Finance names someone who
owes money.

The money summary is deliberately **three metrics — Collected, Outstanding and
Partially paid** (a count of bills, not an amount), plus the Unknown slice on a
month that has one. **There is no collection rate.** A percentage of expected
revenue is a report-card number rather than something a teacher acts on, and
with one unrecorded partial it could not even be stated plainly — it had to be
drawn as a floor with a sentence explaining the arithmetic underneath. The
figure is still computed and still on the payload for any future surface that
wants it; nothing renders it.

Responsive verification **passed** by hand at ≥1100, 768–860, ≤620 and 375, on
the hosted **Preview** deployment, over four review rounds: the first found an
ambiguous `+N more`, the second an ambiguous `No data`, the third a collection
rate nobody could act on, and the fourth a count drawn twice. The final pass was
taken against Preview at `e3e757c`, which is the exact SHA `main` was then
fast-forwarded to and Vercel deployed to **Production** — the same commit, the
same bytes, so the pass carries. Production itself was additionally verified
**programmatically**: the served stylesheet, the served bundle and every month's
payload were read back and checked, and the two facts are kept apart rather than
one being reported as the other.

Finance's only stylesheet is one block at the app's existing 620px breakpoint,
which restacks the panels a phone cannot hold in a row and gives the month
selector a full-width row of its own; every other width is the comp's own inline
values. Exactly three regions scroll horizontally — the tab strip, the Payments
table and the expanded per-student grid — and the page itself never does.

**No Billing document was created, edited or deleted at any point in Sprint 9**,
rollout and Production verification included, and **no Billing index was created
or declared**. `PATCH /api/finance/:billId` has never been invoked against
production. `billings` still holds 84 documents at digest
`b3e2fb7ae5dd0cc1baac3c4f62c7459bfa62292b839970a84703a8e02d9ca6ca` — 70 Paid /
9 Partially Paid / 5 Unpaid, 24 ghost bills over 4 deleted students, 0 duplicate
`(studentId, classId, month)` groups — with exactly the five indexes it has
always had, and the Reviews and Homework baselines are untouched. The read-only
check is `npm run finance:integrity`; it runs **observationally**, and its
accepted baseline is deliberately still `null`: nothing has been intentionally
written, so there is nothing to accept.

That also settles Sprint 8's outstanding condition, recorded above: `2189895`
was deployed to Vercel **Production** and verified on 2026-09-03, and this
rollout supersedes it.

**Deferred, and deliberately not repaired here** — each is a known fact about
production data or a missing design, not an open defect:

- **`c6`** stores `fee: 18,000,000` while its own historical bills store
  `1,800,000`, exactly ten times smaller. It is 62–71% of every month's reported
  revenue. Stored values are rendered exactly as they are; there is no
  normalisation anywhere, and the remediation is its own authorised change.
- **Revenue for deleted or unenrolled students** still cannot be reconstructed:
  rosters are current-only and no enrolment history exists to derive it from.
- **Six `paidDate` values after the app clock** are preserved as found. New
  writes reject a future date; the existing six are history.
- **Nine legacy `Partially Paid` bills without `paidAmount`** are preserved and
  shown as incomplete rather than repaired. Every *new* partial must record its
  amount, so they are the only incomplete records there will ever be.
- **Waived or exempt tuition is not modelled**, and `Unpaid` is deliberately not
  overloaded to stand in for it: a bill nobody will ever collect would otherwise
  sit in the outstanding total forever with nothing to distinguish it. A waiver
  is also never inferred from a missing Student — a deleted student record
  proves only that the record is gone. A future sprint gives this its own field
  (e.g. `billingApplicability: "Billable" | "Waived"`) with its own write rules.
- **The payment form** is deferred to a design, but its contract is written down
  in `src/lib/billing.ts`: `Unpaid` and `Paid` take no amount input at all,
  `Partially Paid` requires one beside a read-only remaining figure.
- **`Student.balance`** remains inconsistent with Billing on the Students
  surface, and was not touched.
- **The Billing `(studentId, classId, month)` natural key** is documented and
  observationally validated (0 duplicates in 84 documents) but **no unique index
  was created or declared**. Declaring one in `models.ts` would make mongoose's
  `autoIndex` build it at deploy time, which is production DDL and needs its own
  authorised migration gate. Deferred technical hardening.
- **No monthly Billing generator** exists, so a future month can legitimately
  return no bills.
- **Payment UI** and the **Student Profile Finance tab** wait for a design. The
  **Finance figures a report would show** are no longer waiting: Reports shipped
  in Sprint 10 (below). Finance's own **Excel export** remains deferred.

**Sprint 10 — Reports: shipped, Production verified, closed.** The contract was
banked in [`PROJECT_RULES.md`](./PROJECT_RULES.md) before implementation, and the
module was then built against it: a Reports read model, `GET /api/reports`, the
Reports workspace with its live preview, Export PDF and Print.

Exactly **five** report types ship — Monthly Revenue Report, Class Revenue
Report, Student Payment Report, Attendance Summary and Homework Summary. Reports
is read-only and composes figures the owning domains already produce; it owns no
arithmetic and no month semantics of its own. Reports are **generated, never
stored**: there is no Report model, id, lifecycle, history or cache, and
previewing, printing and exporting write nothing.

`Performance Summary` is deliberately **not** a Reports type, and the **Monthly
Progress Report stays Reviews-owned** — a second student academic document over
the same ratings, average and month would be the same report twice. **Export
PDF** and **Print** shipped; **Excel is deferred** to its own export gate, with
nothing ported from the reference builder and no disabled control drawn; **CSV
is out of scope**. The Reports action row therefore carries two controls where
the reference design draws three. Reports are teacher-facing, and the
missing-parent indication is carried by the Student Payment Report's per-student
rows alone.

A valid selection derives its preview automatically — there is no Generate
button — and Export PDF and Print are unavailable while a newer selection is
still resolving, so neither can emit a document belonging to the previous one.
The Reports layout responds to the width actually available to the screen rather
than to the viewport, via a screen-only container query, so one viewport width
stacks or does not according to how much room the shell currently leaves it.

**Two defects found by Production verification, both fixed.** The desktop
distance between the options rail and the report preview had drifted — not the
gap token, but the shared sheet rule centring a 760px document inside a preview
track that took all remaining width, so the separation grew with the monitor.
Start-aligning the sheet fixed that and exposed the second: with the spare room
then all on one side, an ultra-wide screen left the whole workspace pinned left.
The preview track is now bounded at the document's own width, so the rail, the
gap and the document form one workspace that the grid centres as a group. Both
were confirmed on Production at 1280, 1440 and 1600+.

**Responsive shell fixes carried by this sprint.** Human verification of Reports
surfaced four responsive sidebar defects that **pre-date Sprint 10 and were not
introduced by Reports** — a dead tablet label selector, collapsed-state leakage
into the mobile drawer, a no-op tablet expansion toggle and an asymmetric expand
animation. They were fixed here because Reports verification is what exposed
them.

**In contract (Sprint 11 — Settings).** The Gate 1 audit has **passed** and the
contract is banked in [`PROJECT_RULES.md`](./PROJECT_RULES.md) as its `## Settings`
section. **No implementation has started.** The audit's headline finding is that
the Settings *state* has existed and been production-used since the earliest
sprints — `SettingsProvider`, the bound formatter, the translation layer, the
appearance CSS tokens and the `etlms.*` `localStorage` keys are read by 48 call
sites across every module — while `/settings` itself still renders the module
placeholder, leaving accent, surface, density and the language switch fully
styled but unreachable by any control.

Sprint 11's scope is therefore narrow: the production Settings UI over that
existing store, plus validation of stored preference values against their
authorised enumerations. Nine settings are authorised — theme, accent, surface,
density, interface language, date format, time format, currency and number
format — and no others. Persistence stays device-local in the existing keys, so
there is **no Settings API, model, collection, schema change, migration or new
dependency**, and no change to authentication. Currency remains a **display**
preference only: stored tuition and every Finance calculation stay integer VND.
**Notifications are explicitly deferred** — the app has no notification source or
bell menu, so Sprint 11 draws no Notifications card at all rather than an inert
one. Settings is **not implemented and not deployed.**

**In progress (incremental):** Students, Parents, Classes, Lessons and
Calendar screens — each ported
from the design comp with its create/edit drawer, list/empty/loading/error
states, API routes and validation.

## Business rules

Tuition/revenue and lesson-type rules live in [`CLAUDE.md`](./CLAUDE.md) and are
implemented in `src/lib/finance.ts` and `src/lib/generate.ts`.
