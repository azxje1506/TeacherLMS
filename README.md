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

**Sprint 11 — Settings: implemented, human-verified, merged, closed.** The
contract was banked in [`PROJECT_RULES.md`](./PROJECT_RULES.md) as its
`## Settings` section before any code, and the module was then built against it.
The Gate 1 audit's headline finding shaped the whole sprint: the Settings
*state* had existed and been production-used since the earliest sprints —
`SettingsProvider`, the bound formatter, the translation layer, the appearance
CSS tokens and the `etlms.*` `localStorage` keys, read by 48 call sites across
every module — while `/settings` itself still rendered the module placeholder,
leaving accent, surface, density and the language switch fully styled but
unreachable by any control. Sprint 11 built the page over that store and added
no second one.

**Preferences are device-local and save themselves.** Nine settings ship and no
others: **Appearance** — Theme, Accent colour, Surface, Density; **Language &
Region** — interface language, date format, time format, currency, number
format. Every change applies immediately through the existing setters into the
existing `etlms.*` keys, so there is **no Save button, no Apply button and no
form** — and **no Settings API, model, collection, schema change, index,
migration, production DDL or new dependency**, and no change to authentication,
JWT or cookies. A stored value that is not in its authorised enumeration now
falls back to the existing default rather than reaching the document as an
appearance with no matching token block.

**The Workspace card is read-only** — account name, email, current currency and
the application day. Nothing on this page edits an account, a password, a role
or a session. **Currency is a display preference only:** choosing `USD` changes
how an amount renders and nothing else; stored tuition, fees, billing and every
derived revenue figure stay integer VND in the database and in all arithmetic.
**Notifications are deferred in full** — the application has no notification
source, model, menu, unread count or read state, so Settings draws **no
Notifications card at all**, not even an inert one, and the two reserved keys
are left exactly as they were. Notifications gets its own sprint.

**Two shipped behaviours reach beyond the page, because the preferences always
did.** The interface language is not CSS: it is the text of every page, chosen
while the server renders, and the server cannot read `localStorage` — so with
English persisted the server shipped Vietnamese and the browser painted it
before any React ran. The authenticated workspace therefore publishes its own
readiness at `AppShell`, the single common root of every authenticated route,
and reveals in the correct language atomically; `ThemeScript` continues to
settle the colours before first paint, which is exactly why appearance never
flashed and language did. **Login is deliberately not gated** — it has no shell
and consumes no workspace preference. Alongside it, workspace **density** now
reaches shared control clusters (filter pills and action rows) through tokens
derived from the one `--gap`, leaving control heights, typography, icon sizes
and hit targets untouched; the header's spacing stays fixed by design, being the
one non-wrapping row whose intrinsic minimum is the document's own. Shared
**input, textarea and select** hover moved off a neutral grey onto the accent
system, and the shared focus ring moved to `:focus-visible` so a keyboard user
keeps a visible ring while a click no longer leaves one stuck.

Human verification of the deployed branch passed on all five checks — app-wide
language hydration, density, accent hover, focus behaviour and the regression
sweep — and Sprint 11 merged to `main` at `ceb1e8b` as a fast-forward,
preserving every implementation commit.

The Sprint 11 **closure audit has since passed**, re-checked against the merged
code rather than against the gate reports: the shipped implementation matches the
banked contract, no blocker remains open, and no debug code, temporary comment,
migration, test-only bypass or unfinished TODO was introduced. **Sprint 11 —
Settings is closed.**

**Sprint 12 — Notifications: implemented, human-verified, merged, production verified and CLOSED.** The numbered
priority list in [`PROJECT_RULES.md`](./PROJECT_RULES.md) runs *1. Students … 9.
Settings* and was fully consumed by Sprint 11, so it names no successor — but
Notifications was the only module the repository designated for a sprint of its
own, in four places written across three sprints. Its product contract had never
been written down, so it has now been banked as a dedicated `## Notifications`
section before any code, the same order every prior sprint used.

The existing header bell becomes interactive and that is the whole surface: **no
`/notifications` route, no sidebar item, no page, and not the deferred
Notifications Settings card** — the Sprint 11 Settings contract is unchanged at
three sections and nine settings. Three notification types ship and no fourth:
**unpaid tuition**, **upcoming makeup** within 7 calendar days, and **review
due**. Notifications **own no data** — no model, collection, schema, index,
migration or API, no persisted copy of any Billing, Lesson or Review value, and no
notification interaction writes to any domain collection. They are derived at read
time from entities that already own their data; only acknowledgement is stored,
device-locally, in the two keys the design reserved years ago
(`etlms.notifRead`, `etlms.notifDismissed`) with no third key and no rename.
**Nothing is ever sent** — no email, SMS, `mailto:`, push or parent-facing
delivery; the bell is a read-only awareness layer over state the application
already holds.

One prior test assertion was deliberately inverted, and it is the only one:
`tests/settings.test.ts` asserted the reserved keys were *read by nothing*, which
was true until the sprint that gives them a reader. It was inverted rather than
deleted and now walks **all** of `src/` to require that every reader is either the
declaring module or Notifications code — the old form scanned four Settings files,
so a reader placed anywhere else would have satisfied it while proving nothing.
The Settings-card, Finance-reminder and Reports-notification bans are untouched.

The module **shipped against that contract**: a headless derivation layer with no
React, fetch or storage call inside the rules; source data read once in
`(app)/layout.tsx` and handed down as props, so the panel needs no API route and
no client fetch; and acknowledgement held device-locally in the two reserved keys.
A falsification audit caught two defects able to **500 every authenticated page**
— derivation runs in the shared layout, and a `Student` without `joined` or a
`Billing` without `month` is legal in the database because neither field is
`required` in its schema; both now skip the record and fail closed. The human
browser pass **passed** and returned two further defects, both fixed: a stale
keyboard focus ring after a pointer click (`:focus-visible` is re-evaluated only
when focus *changes*), and no visible read/unread distinction once the panel is
open.

`main` was **fast-forwarded** from `b542fd4` to `b074656`, preserving all six
commits with no squash, rebase or merge commit, and the branch is retained. That
revision is live on **Vercel Production** — the deployed artifact was proven
identical to a local build of `b074656` by MD5 across all 41 static chunks and the
stylesheet. **No production record was created or mutated for verification, and no
DDL was performed.** The browser re-pass against Production has since been
performed and returned A–G all PASS — on bytes already proven identical to the
ones the Gate 6 pass verified.

**Sprint 12 is closed.** The closure audit was run against the merged code on
`main` rather than against the gate reports, and it passed: the shipped module
still matches the banked contract on surface, audience, the three types,
derivation bounds, stable identity, ordering, the presentation-only cap of 20,
the read/dismiss split, persistence containment and the accepted refresh
boundary. Domain interactions remain read-only — derivation reads through
`getAll()` and writes nothing. The one residue item found, a trailing blank line
at the end of `notification-menu.tsx`, was trimmed; nothing else surfaced.

Human verification is the authoritative layer and both rounds are recorded: the
initial Gate 6 pass returned a stuck pointer focus ring and a missing read/unread
distinction, the Gate 6.1 fixes were re-tested **R1 PASS / R2 PASS**, and the
Production pass returned **A–G all PASS**, including the four high-risk widths
320, 360, 390 and 430. Final automated state at closure: **2621 / 2621** tests,
lint 0 errors with the same 8 pre-existing warnings, `tsc --noEmit` clean, build
green and `git diff --check` clean.

**Sprint 13 — Student Profile: Attendance & Homework: designated, contract
banked, implementation not started.** The numbered priority list in
[`PROJECT_RULES.md`](./PROJECT_RULES.md) has named no successor since Sprint 11
consumed it, and Notifications — the one module the repository had reserved a
sprint of its own — shipped in Sprint 12, so Gate 1 designated Sprint 13 on
repository evidence rather than from a list. The evidence is that the Student
Profile renders a six-tab strip and answers two of it: **Attendance** and
**Homework** are already reachable, keyboard-operable and deep-linkable, and both
dead-end on the comp's *"arrives in a later sprint"* panel. The imported design
draws **complete bodies for both**, each with its own empty state; twelve
Vietnamese keys for them were ported and have had **no reader in `src/`** until
now; and the per-student derivations — `studentAttendanceRate` and
`studentHomeworkCompletion` — already exist and are already consumed by Reports
and Reviews. The design, the data, the translations and the helpers are all
present; only the two tab bodies are missing.

The contract is banked in [`PROJECT_RULES.md`](./PROJECT_RULES.md) as a dedicated
`## Student Profile — Attendance & Homework` section, before any code, the same
order every sprint since Sprint 9 has used. **Both tabs are read-only and own no
data** — no model, collection, schema field, index, migration, production DDL or
new dependency, and no notification, lesson, register or outcome is ever written
by opening a profile. Every figure is derived at read time from entities that
already own it, at the scope the Reviews tab already uses, so the attendance and
homework percentages on the two surfaces **must agree by construction**. The
implementation direction chosen in Gate 2 is **two dedicated module-owned
endpoints** — `GET /api/attendance/student/:studentId` and
`GET /api/homework/student/:studentId` — mirroring the shipped
`GET /api/reviews/student/:studentId`, rather than widening the Students
endpoint, so each read stays inside the module that owns its data and no existing
route, response type or cache key changes.

**The Classes and Finance tabs keep the placeholder** — the comp gives them no
tab body, so under *Missing UI Specification* they are not built — and the
Reviews tab, the Overview tab and the tablist are untouched. One banked test
expectation was inverted here and only one: `tests/reviews-ui.test.ts` #83
asserted that Reviews was the page's one branch, which stops being the invariant
in the sprint that gives two more tabs a body. It is **inverted rather than
deleted** and now bounds the branch set instead of counting it, so Attendance and
Homework are permitted while **Classes and Finance can never gain a branch**; the
`TABS` array, the fallback and the Overview cards stay pinned exactly as written.
The positive assertion — that those two branches exist — belongs to the
implementation gate, so the suite is **green at banking time**, the same division
Sprint 12 used.

**Gate 3 has since shipped the backend, and only the backend.** Two module-owned,
session-guarded, read-only endpoints now exist —
`GET /api/attendance/student/:studentId` and `GET /api/homework/student/:studentId`
— mirroring the shipped `GET /api/reviews/student/:studentId`, each answering an
unresolvable student with the repository's own `Student not found` 404 while an
archived student stays readable. Behind them sit a pure
`src/lib/student-profile.ts` and a DB-bound `src/lib/student-profile-service.ts`,
the pairing `reports.ts` / `reports-service.ts` already draws.

**No counting rule was restated.** The attendance percentage is
`studentAttendanceRate` and the completion percentage is
`studentHomeworkCompletion` — the shipped helpers Reports and the Reviews learning
journey already read. They are called per month and their numerators and
denominators summed, so the lifetime figure *is* the monthly one added up, and
both suites prove that identity by running it rather than asserting about it.
`Excused` attends and is never filed as an absence; the **Lesson owns the date**
and the legacy `AttendanceRecord.date` mirror is addressed nowhere; a class-scoped
assignment is read through `submissions[studentId]` and a **missing key means the
work is not theirs**; `Total` includes `Assigned` and is therefore legitimately
larger than `Completed + Late + Missing`; ordering is deterministic with the
source id as the final tie-breaker; the 20- and 5-item caps are presentation only;
and nothing recorded reports `null` rather than `0`.

**Gate 2's recommended shape turned out to be unavailable, and the guards that
blocked it were left sealed.** The reads could not go in `homework-service.ts` —
`tests/homework-service.test.ts` #40 pins its imports, #22 forbids it from naming
`submissions` anywhere, #23 forbids `status`, #26 forbids the ownership keys —
because Sprint 7 deliberately left that service *unable to address a submission at
all*, which is what keeps the deferred submission writer absent by construction.
Nor in `attendance-service.ts`, whose `ATTENDANCE_ERROR` key set is pinned to four
reasons with no `student_not_found`. Nor in `finance.ts`, which three further
guards seal. A composing module was the answer, exactly as Reports composes other
domains' figures without editing them. **No banked guard was weakened, moved or
deleted**, and `finance.ts`, `attendance.ts`, `homework.ts` and both module
services are byte-identical to `main`.

The suite moves **2621 -> 2683**, all green, across
`tests/student-attendance.test.ts` (32) and `tests/student-homework.test.ts` (30).
Five deliberate defects were introduced and reverted to prove the guards bite; the
fifth found a **real gap in this gate's own tests** — removing the shipped
helper's top-level `Assigned` exclusion changed nothing any test could see,
because that exclusion and the per-student one agree on every ordinary record — so
**#11b** was added with the one divergent fixture that isolates it.

**Gate 4 has since built the Attendance tab — and only that tab.** The profile
page gained exactly one branch, rendering
`src/components/attendance/student-attendance.tsx`: the comp's headline rate
beside its four status counts, the six-month chart, the timeline, and *Recent
absences* / *Recent late arrivals* in the supporting column. The page passes a
student id and nothing else, holds no attendance state and knows no attendance
rule — the shape `StudentReviews` has had since Sprint 8.

**The payload is rendered as it arrives.** The tab derives nothing: no rate, no
monthly rate, no count, no list. It applies no filter, sort or arithmetic —
`absences` already excludes `Excused` and the timeline already carries its
tie-break, so a client-side filter would be a second copy of a domain rule with
nothing testing it. `null` is never `0%`: the headline and every monthly point go
through the shared `rateLabel`, and the one template that builds a percent from a
rate is the bar's CSS height, pinned exactly. Loading is a skeleton in the tab's
own shape showing no values; error is inline, retryable and decided **before**
empty, so a failed request is never dressed as "this student has no attendance";
the whole-tab empty state is the comp's dashed panel on the server's own
`hasRecords`. Colour is never the only signal, the chart's bars are `aria-hidden`
because their values are already written in text beneath them, and no chart
library was added.

**`.sp-split` is the stylesheet's**, in its own Student Profile section, with the
desktop template in CSS and no inline `grid-template-columns` — an inline
declaration beats every rule written against it, which this repository has shipped
as a dead rule more than once. It collapses on a **container query** anchored to
the existing `[data-screen-label="Student profile"]`, declared for `screen` only,
following Reports and Settings. **No new viewport breakpoint.** The threshold is
**600px, derived from this tab's own content and deliberately not Reports' 667** —
borrowing that number would have broken two banked `reports-ui` guards that pin it
as the file's single occurrence, and the block also had to sit **above** the
Settings section because `settings-propagation` #6 reads everything after the
Settings banner as Settings CSS. Three banked guards were found by breaking them
first; all three were left sealed and this sprint's own CSS changed instead.

**Every string already had a Vietnamese entry** — the keys Gate 1 found ported and
unread now have their reader, and no thirteenth key was invented. The suite moves
**2683 -> 2720**, all green, with `tests/student-attendance-ui.test.ts` (37)
carrying the positive branch assertion Gate 2.1 deliberately left unwritten:
Attendance branches, Homework does **not** yet, Classes and Finance never do, and
the fallback survives. Five deliberate defects were introduced and reverted to
prove the guards bite.

**Manual browser QA has NOT been performed and is not claimed.** This repository
has no browser automation, so the ten widths from 1440 down to 320, the density
and theme variants, the Vietnamese/English pass and the pointer-versus-keyboard
focus behaviour are **reserved for human QA**.

**Gate 5 has since built the Homework tab, and the branch set is now complete.**
Four of the six tabs render their own body — Overview, Reviews, Attendance,
Homework — and that is the final count: **Classes and Finance never gain a
branch**, because the imported design supplies them no tab body, so the comp's
later-sprint panel is their permanent state. `src/components/homework/student-homework.tsx`
renders the completion ring beside the four summary tiles, the homework timeline,
and *Missing homework* / *Late homework* in the supporting column; the page passes
a student id and nothing else.

**Two contract cases carry this tab, and both are pinned by tests.** *"No outcome
yet" is not "no homework"* — a student whose work is all still `Assigned` has
`completionRate: null` with real assignments, so the whole-tab empty state is
decided by the server's `hasRecords` and by nothing else, and the ring shows the
shared em dash while drawing **no arc at all**. And *`Total` includes `Assigned`*,
so it is legitimately larger than `completed + late + missing`; each tile reads its
own server field and summing the other three is forbidden, because that would
delete the unmarked work from the screen.

**The submissions map never crosses the wire.** Each row's status is already this
student's own outcome, resolved on the server, so the browser is handed an outcome
rather than a map — it cannot read another student's key, and an assignment's own
status can never be mistaken for a person's result. `missing` and `late` are the
server's own lists rather than the timeline filtered twice: the two are capped
differently, so rebuilding one from the other would lose rows for a student with a
long history. Error is decided **before** empty, so a failed request is never
rendered as "no homework assigned".

**`globals.css` is byte-identical to Gate 4** — the tab reuses `.sp-split` and the
existing container query unchanged, adding no breakpoint, no second container
query and no overflow escape hatch. **One translation key was added**, and it is a
missing sibling rather than a new pattern: the comp draws `attended` under the
Attendance ring and `completed` under this one, and only the first was in the
dictionary.

The suite moves **2720 -> 2758**, all green. Five deliberate defects were
introduced and reverted; the third exposed a **real defect in this gate's own
test** — a landmark-slicing assertion that passed while the defect was live — and
it was rewritten to read the branch condition itself. One banked guard was
updated deliberately, `tests/homework-ui.test.ts` #64, which had pinned the
Homework client at four endpoints since Sprint 7; the fifth is the read approved
in the banked contract, and the guard's real protection is untouched because the
new call carries no `method`, leaving the write verbs exactly DELETE, PATCH and
POST.

**Attendance is untouched by this gate** — its component, its presentation
helpers, its client, its endpoint, both `student-profile` library files and
`globals.css` are all byte-identical, and both Attendance suites pass unchanged.
The two tabs deliberately share no code beyond helpers that already existed;
generalising them belongs after sprint closure.

**Manual browser QA has NOT been performed and is not claimed.** There is no
browser automation in this repository, so the width matrix, density and theme
variants, the Vietnamese/English pass and focus behaviour — for **both** tabs
together — remain reserved for the human gate, which is what Sprint 13 still needs
before it can close. **No schema, index, migration, production DDL, new dependency
or production write** was introduced, and no submission writer exists: the tab
holds no mutation and cannot record an outcome. A separate future candidate — a
**Finance class payment slip** for printing tuition notices, with a playful print
style, an amount due, tuition-month content and a fixed bank QR code — is recorded
at product level only and is **explicitly excluded from Sprint 13 by name**; it has
no design in the imported comp and would need its own gate.

**Sprint 13 Gate 6 — integrated responsive and accessibility QA, and it found a
real defect.** Both tabs were audited together, and the fault is one this
repository has already catalogued against itself. The comp writes the four
summary counts as an inline `repeat(4,1fr)` — a hard-coded **desktop** column
count — and an inline declaration beats every container rule written against it,
so the count could never change on a narrow screen. `globals.css` states the same
finding, in its own words, about the two **Attendance** screens: *"hard-code a
desktop column count inline, so the count never changed on a phone ... giving
each about 63px"*. `.att-summary`, `.att-stats`, `.kpi-grid` and `.ov-grid` are
all that same escape; these two tabs shipped the unguarded form and had none.

It is two faults, and the first is the one that scrolls the page. A `1fr` track
is `minmax(auto,1fr)`, and that `auto` is the grid item's **automatic minimum
size** — the track refuses to shrink below its own min-content, so four tiles of
padding around an unbreakable word (`Completed` is the long one) are a floor the
row cannot go under: it grows past the card and the document scrolls sideways.
The second is readability, which is why the **count** collapses rather than the
tiles merely shrinking.

The fix is the app's own: the row is now `.sp-tiles`, **the stylesheet owns its
template**, the tracks are `minmax(0,1fr)` so no track can refuse to shrink, and
it collapses **4 -> 2** — the `.att-summary` treatment — on the **same 600px
container query Gate 4 already declared**. No new threshold, no new container, no
new viewport breakpoint, no overflow escape hatch, and above the threshold the
row is the comp's four columns unchanged. One class serves both tabs, so the fix
was not written twice. The label also carries `overflow-wrap:anywhere`, which is
the guarantee that does **not** depend on a font metric.

**The defect was live and the suite was green**, which is itself the finding: no
guard covered the tile row. Eight were added (**2758 -> 2766**) and all were
mutation-tested — restoring the inline template, using bare `1fr` tracks,
deleting the collapse, dropping the label guard, collapsing with a **viewport**
media query instead, and fixing only the live row while leaving the skeleton
inline each fail a named assertion, the last proving the skeleton clause is not
vacuous. `src/lib/student-profile.ts` and `src/lib/student-profile-service.ts`
are **byte-identical**: no backend semantics, API shape, ordering, cap or count
changed, and the fix is presentation-only.

Also verified and **unchanged**: all thirty-two Vietnamese strings both tabs
render resolve, including `"completed": "đã hoàn thành"`; every colour is a token
defined in **both** `:root` and `[data-theme="dark"]`, with no hex literal in
either tab; Classes and Finance still have no profile branch and `TABS` is still
its six entries in order. One item is recorded rather than fixed: the card
headings are `<h3>` under the profile's `<h1>` with no `<h2>` between them, a
skipped level that is **not** a regression — those headings did not exist before
Sprint 13 — and repairing it is left out of a gate told not to open an ARIA
refactor.

**The browser matrix is still NOT claimed.** There is no browser automation in
this repository, so the ten widths, the sidebar/density permutations, both
themes, both languages, pointer-versus-keyboard focus and the live data spot
check remain **HUMAN REQUIRED**, and Sprint 13 needs a **Gate 6.1 human re-test**
before it can close. The **Finance class payment slip** remains deferred and
untouched: no QR asset, bank information, print component, billing API, payment
UI, Settings field or print stylesheet.

**In progress (incremental):** Students, Parents, Classes, Lessons and
Calendar screens — each ported
from the design comp with its create/edit drawer, list/empty/loading/error
states, API routes and validation.

## Business rules

Tuition/revenue and lesson-type rules live in [`CLAUDE.md`](./CLAUDE.md) and are
implemented in `src/lib/finance.ts` and `src/lib/generate.ts`.
