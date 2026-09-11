# Changelog

## Unreleased — Student Profile: Attendance & Homework (Sprint 13) — **both tabs shipped, integrated QA done, human re-test pending**

### Gate 1 — module designation (PASS)
- The numbered priority list in `PROJECT_RULES.md` (`# Current Milestone`) runs
  **1. Students … 9. Settings** and has named no successor since Sprint 11
  consumed it. Notifications — the only module the repository had ever reserved a
  sprint of its own — shipped and closed in Sprint 12, so **no deferred item
  carried a sprint designation**, and the string `Sprint 13` appeared nowhere in
  the repository. Sprint 13 was therefore designated on repository evidence, the
  same way Sprint 12 was.
- **Designation: Student Profile — Attendance & Homework.** The profile renders a
  six-tab strip and answers two of it. Attendance and Homework are already
  reachable, keyboard-operable and deep-linkable, and both dead-end on the comp's
  *"arrives in a later sprint"* panel; the page's own header comment names the
  precondition — those modules being closed — which Sprints 6 and 7 have met.
- **Four independent lines of evidence.** The imported comp contains **complete
  designs for both tab bodies**, each with its own empty state, distinct from the
  `tabOther` placeholder branch it also draws. **Twelve Vietnamese keys** for
  those two designs were ported and have **zero readers in `src/`** — found by
  resolving all 764 dictionary keys against every `.ts`/`.tsx` file. The data is
  owned by two closed modules, and the per-student derivations
  (`studentAttendanceRate`, `studentHomeworkCompletion`) already exist in
  `src/lib/finance.ts` and are already consumed by Reports and Reviews.
- **Candidates considered and rejected**, each for want of a design rather than
  want of value: **Global Search** (a full command-menu vocabulary sits dead in
  the dictionary, but the comp draws no overlay, palette or results surface —
  the vocabulary came from the original vanilla app, not the governing design);
  the **Homework submission writer**; the **Finance payment UI** (three row
  actions are drawn, no form is drawn anywhere, and `paidDate` is a required
  choice no drawn control supplies); the **Student Profile Finance tab**; and
  **AI review generation**. **Class Detail enrolment** was ranked second — its
  read designs exist and `studentIds` is already writable end-to-end — but the
  comp draws the *Assign students* trigger and never the picker it opens, so it
  would have shipped a roster you can remove from but not add to.
- **Excel export** was ranked third: the comp draws the control and
  `design-reference/lib/etlms-export.js` is a complete dependency-free xlsx
  builder, but the repository reserves it for *"its own export gate"* — a gate,
  not a sprint.
- Also recorded, as maintenance rather than sprint work: `ModulePlaceholder` is
  now referenced by **zero** files in `src/` while `PROJECT_RULES.md` still says
  modules use it; the Class Detail comment claiming "no lesson data" has been
  false since Sprint 5; **Quick add** has no `onClick` at all and, unlike the
  search triggers, no comment explaining why; and ~143 further dictionary keys
  are dead beyond the clusters named above.

### Gate 2 — contract and implementation plan (PASS)
- **Five design ambiguities resolved explicitly** rather than deferred into
  implementation: `Excused` is **not** listed under *Recent absences* (it counts
  as attended everywhere else in the app, so filing it as an absence would
  contradict production); the Homework **`Total` tile includes `Assigned`** work,
  so it is legitimately larger than `Completed + Late + Missing`; a class-scoped
  assignment shows the **student's own outcome** from `submissions[studentId]`,
  never the assignment's top-level status; timelines cap at **20** and side cards
  at **5**, presentation only; and the monthly chart is **six months** ending at
  the application's current month, with a month that has no completed lesson
  drawing the em-dash placeholder rather than `0%`.
- **Implementation direction: two dedicated module-owned endpoints** —
  `GET /api/attendance/student/:studentId` and
  `GET /api/homework/student/:studentId` — mirroring the shipped
  `GET /api/reviews/student/:studentId`. Extending `GET /api/students/:id` was
  rejected: it would make every Overview load and every student save pay for four
  extra collection reads, put Attendance and Homework data inside the Students
  module's response, and place the payload under `studentKeys.detail(id)`, where
  renaming a student would refetch their whole attendance history.
- The plan, the QA checklist and the rollback assessment are recorded in the gate
  report; no code, service, endpoint, component, stylesheet rule or feature test
  was written.

### Gate 2.1 — contract banked on the feature branch
- Branch `sprint-13-student-profile` cut from `main` at `94521b3`, and the
  contract banked as its **first commit** — never on `main` — the order every
  sprint since Sprint 9 has used.
- `PROJECT_RULES.md` gains a dedicated
  `## Student Profile — Attendance & Homework` section:
  - **read-only in the strictest sense.** No mutation, form, drawer or dirty
    state, and opening a profile never mutates a lesson, advances a lifecycle,
    creates a register, records an outcome or normalises a stored value.
  - **the tabs own no data.** No model, collection, schema field, index,
    migration, backfill, production DDL or new dependency; every figure is
    derived at read time from entities that already own it, and nothing is copied
    onto the Student.
  - **the scope is the Reviews tab's scope** — the student's own classes — so the
    attendance and homework percentages the learning journey already shows and
    the ones these tabs show **must agree by construction**. Roster membership is
    read as it stands today, and that limitation is stated rather than papered
    over.
  - **the counting rules are not restated.** `studentAttendanceRate` and
    `studentHomeworkCompletion` state them once in `src/lib/finance.ts`; a
    lifetime figure extends that same file rather than copying the rule.
  - Attendance: `Present`/`Late`/`Excused` attended and `Absent` not; four raw
    lifetime counts in the design's order; six monthly bars; **the Lesson owns
    the date** and the legacy `AttendanceRecord.date` mirror is never read;
    *Recent absences* is `Absent` only and *Recent late arrivals* is `Late` only.
  - Homework: `Completed` and `Late` done, `Missing` not, **`Assigned` excluded
    from the measure entirely**; `Total` counts all work addressed to the
    student; an assignment with no entry for this student does not appear.
  - deterministic newest-first ordering with source identity as the final
    tie-breaker; presentation-only caps of 20 and 5; deleted students' entries
    and submission keys never surfaced, counted, repaired or erased; both tab
    empty states, with an empty side card kept as its own separate state.
  - the responsive split is **a class the stylesheet owns, never an inline
    `grid-template-columns`**, collapsing on a container query anchored to the
    existing `[data-screen-label="Student profile"]`; **no new viewport
    breakpoint**, so the 620/767/860/1099/1100 allowlist is not loosened.
  - accessibility: nothing carried by colour alone, existing `:focus-visible`
    treatment, existing tablist semantics unchanged — the absence of
    `role="tabpanel"` pre-dates Sprint 13, spans two closed tabs and is **not**
    repaired here.
  - **Classes and Finance keep the placeholder**, `TABS` stays at six entries in
    order, and **the Reviews tab is not touched** — Sprint 8's deliberate
    omission of the comp's attendance and homework blocks is not reversed.
- **One authorised test-contract inversion, and only one.**
  `tests/reviews-ui.test.ts` #83 asserted that Reviews was the page's one branch
  and that every other tab fell through to the later-sprint panel — correct for
  every sprint up to and including Sprint 12, and no longer the invariant in the
  sprint that gives two of those tabs a body. It is **inverted rather than
  deleted**: the branch set is now **bounded instead of counted**, so Attendance
  and Homework are permitted and **Classes and Finance can never gain a branch**.
  Every other clause is the original, word for word — the six-entry `TABS` order,
  the Overview branch, the Reviews branch, the `t("arrives in a later sprint")`
  fallback and the Overview cards. **Verified by mutation:** giving Finance a
  branch fails it, and renaming the branch expression so the regex matches
  nothing also fails it, so it cannot pass vacuously.
- **The positive assertion is deliberately absent.** That an Attendance branch
  and a Homework branch *exist* is the implementation gate's to make and cannot
  honestly be written at banking time — the same division Sprint 12 used when it
  banked the reserved-key inversion before any reader existed. The suite is
  therefore **green at banking time**, matching the Sprint 12 contract commit,
  which recorded 2420 / 2420.
- **No feature code.** The diff touches nothing under `src/` at all: no route,
  component, service, read model, stylesheet rule, model, schema, index,
  migration, storage key or production write, and no product behaviour changes.
- **Finance — Class Payment Slip Printing remains deferred and untouched.** The
  future request for printable per-class tuition notices — playful print style,
  amount due, tuition-month content and a fixed bank QR code — is recorded at
  product level only and **named as an explicit exclusion in the Sprint 13
  contract**. No QR asset, bank information, print component, billing API,
  payment UI, Settings field or print stylesheet was introduced. It has no design
  in the imported comp and needs its own gate.

### Gate 3 — backend read models and module-owned endpoints
- **Backend only. No UI.** Neither tab is built: no component, no React Query
  hook, no Student Profile branch, no `.sp-split`, no container query, no chart,
  ring or timeline in JSX. The Classes and Finance tabs are untouched and the
  profile page is byte-identical to `main`. A test in this gate asserts all of
  that, so the boundary is checked rather than promised.
- **Two module-owned GET endpoints**, both behind the session, both read-only,
  both mirroring the shipped `GET /api/reviews/student/:studentId`:
  `GET /api/attendance/student/:studentId` and
  `GET /api/homework/student/:studentId`. Each answers a student who does not
  resolve with the repository's own `Student not found` 404; an **archived**
  student is readable, because their history is a record of things that happened.
  Neither route defines POST, PATCH, PUT or DELETE.
- **`src/lib/student-profile.ts`** — the pure read models. No database, no React,
  no fetch, no storage and no clock: `appMonth` is an argument, so Sprint 13
  introduces no application clock and `TODAY` keeps the meaning it had.
- **`src/lib/student-profile-service.ts`** — the DB-bound half, the pairing
  `reports.ts` / `reports-service.ts` already draws. One query per collection,
  never one per lesson or per assignment; `.select()` and `.lean()` throughout.
  **Zero writes**: no create, update, delete or upsert verb appears, no update
  operator appears, and — unlike the Attendance register read, which legitimately
  does — neither function advances a lesson lifecycle. A profile view must never
  mutate a lesson because somebody looked at a student.

#### Why these reads are not in attendance-service.ts and homework-service.ts
- That was Gate 2's recommended shape, and **banked guards make it impossible**.
  They were found by implementing it first and watching six tests fail, and every
  one of them is right, so this gate left them all sealed rather than arguing:
  - `tests/homework-service.test.ts` **#40** pins that service's imports to
    exactly six modules; **#22** forbids it from naming `submissions` anywhere;
    **#23** forbids `status`; **#26** forbids `studentId:`, `scope:`, `classId:`
    and `createdAt:`. Sprint 7 deliberately left the Homework service *unable to
    address a submission at all* — which is what makes the deferred submission
    writer absent by construction rather than by care. A read that must select
    `submissions` and `status` cannot live there without dismantling that.
  - `tests/attendance.test.ts` pins `ATTENDANCE_ERROR`'s key set to exactly four
    reasons, so that module has no `student_not_found` to answer with.
- An earlier attempt also tried adding the shared derivations to `finance.ts` and
  hit three more: `tests/homework-service.test.ts` **#42** pins finance's
  homework exports at exactly two, **#42b** pins its `Assigned` exclusions at
  exactly two occurrences, and `tests/review-analytics.test.ts` **#32** pins its
  null-returning helpers at two. `finance.ts` is deliberately sealed too, and is
  **unmodified by this gate**.
- The precedent for a screen that composes other modules' figures without editing
  them is Reports (Sprint 10). **No banked guard was weakened, moved or deleted,
  and the endpoints stay module-owned**, which is what *Data Ownership* protects.

#### The rules, and where each one lives
- **No counting rule is restated.** The attendance percentage is
  `studentAttendanceRate` and the completion percentage is
  `studentHomeworkCompletion` — the shipped helpers Reports and the Reviews
  learning journey already read. They are **called**, once per month, and their
  numerators and denominators summed; summing an exact numerator and an exact
  denominator is exact, so the lifetime figure *is* the monthly one added up.
- **Attendance.** `Present`, `Late` and `Excused` attend and `Absent` does not;
  the denominator is stored entries on **completed** lessons of the student's own
  classes, and nothing is invented where no register exists. Four raw lifetime
  counts. Six monthly points, oldest first, ending at the application month, each
  equal to the shipped helper's own answer for that month. **The Lesson owns the
  date** — the legacy `AttendanceRecord.date` mirror is not addressed anywhere.
  *Recent absences* is `Absent` only; *Recent late arrivals* is `Late` only.
- **Homework.** A class-scoped assignment is read through `submissions[studentId]`
  and **never** through its top-level status; **a missing key means the work is
  not theirs** and the assignment is omitted rather than defaulted to `Assigned`.
  `Total` counts every assignment addressed to the student, `Assigned` included,
  so it is **legitimately larger** than `Completed + Late + Missing` — the two
  answer different questions and the gap is the unmarked work.
- **Ordering is deterministic** — newest first, by `Lesson.date` or `dueDate`,
  with the source entity's own id as the final tie-breaker. Reversing the input
  cannot change the output, so the database's natural order is never relied upon.
- **Caps are presentation only** — 20 on a timeline, 5 on a side card — and every
  percentage, tile and aggregate still describes the whole record.
- **`null`, never `0`**, wherever nothing was recorded: an empty month's bar, a
  student with no entries, and a student whose work carries no outcome yet. A
  student with work but no outcomes is **not** the empty state.

#### Tests
- **`tests/student-attendance.test.ts` (32)** and
  **`tests/student-homework.test.ts` (30)**. Totals move 2621 -> 2683, all green.
- **Cross-module agreement is executed, not asserted about.** Both suites prove
  the identity that stops one fact appearing as two numbers: the payload's own
  numerator and denominator equal the shipped helper summed over the months in
  scope, and each monthly point equals that helper's answer for its month.
- **Mutation-tested, five defects introduced and reverted.** Counting `Excused`
  as an absence fails #21; reading the legacy `AttendanceRecord.date` fails #11;
  using a class-scoped assignment's top-level status fails #2, #3, #7 and #8;
  treating a missing submission key as `Assigned` fails #2 and #3.
- **The fifth mutation found a real gap in this gate's own tests, and it was
  fixed.** Removing the top-level `Assigned` exclusion from the shipped helper
  changed nothing any test could see, because that exclusion and the per-student
  one agree on every ordinary record — the seeder writes an all-`Assigned`
  submissions map exactly when the assignment is `Assigned`, and this MVP ships
  no submission writer to break that. **#11b** was added with the one divergent
  fixture that isolates it, and now fails when the exclusion is removed. It pins
  shipped behaviour rather than choosing new behaviour.
- The Gate 2.1 inversion is untouched: `tests/reviews-ui.test.ts` needed no
  further change and stays green, and the positive assertion that the two
  branches exist is still the UI gate's to make.

#### Unchanged
- **No schema, index, migration, backfill, production DDL or new dependency**, no
  change to authentication, JWT or cookies, and no production write. `finance.ts`,
  `attendance.ts`, `homework.ts`, `attendance-service.ts` and `homework-service.ts`
  are all byte-identical to `main`.
- **Finance — Class Payment Slip Printing remains deferred and untouched.** No QR
  asset, bank information, print component, billing API, payment UI, Settings
  field or print stylesheet was introduced.
- **Sprint 13 is not complete.** The Attendance and Homework tabs are still
  unbuilt, and the profile still renders the comp's later-sprint panel for both.

### Gate 4 — the Attendance tab
- **The Attendance tab is built. Homework is not** — that is Gate 5, and it still
  falls through to the comp's later-sprint panel alongside Classes and Finance,
  which never gain a branch at all because the imported design supplies them no
  tab body.
- **`src/components/attendance/student-attendance.tsx`** renders the comp's
  `tabAttendance` section: the headline rate beside four status counts, the
  six-month chart, the timeline, and *Recent absences* / *Recent late arrivals* in
  the supporting column. **`src/app/(app)/students/[id]/page.tsx` gained exactly
  one branch** and nothing else — the page passes a student id, holds no
  attendance state and knows no attendance rule, the same shape `StudentReviews`
  has had since Sprint 8.
- **The payload is rendered as it arrives.** The tab derives NOTHING: not the
  headline rate, not a monthly rate, not a count, not one of the three lists. It
  applies no filter, no sort and no arithmetic — `absences` is already `Absent`
  only and `timeline` already carries its tie-break, so a client-side filter would
  be a second copy of a domain rule with nothing testing it, and the first thing
  it would do is let `Excused` into the absences card. A test asserts the absence
  of `Math.round`, `reduce(`, `filter(` and `sort(` in the file.
- **`null` is never `0%`.** Both the headline figure and every monthly point go
  through the shared `rateLabel`, which renders `null` as the app's em dash. The
  one template literal that builds a percent from a rate is the bar's CSS
  **height**, and the test pins it exactly so a second one cannot appear unnoticed.
- **Four states, kept distinct.** Loading is a skeleton in the tab's own two-column
  shape that shows no values and reads no data, so revealing the payload does not
  move the tablist above it. Error is inline and retryable and is decided
  **before** empty, so a failed request can never be dressed as "this student has
  no attendance" — a claim about their record rather than about the network. The
  whole-tab empty state is the comp's dashed panel on the server's own
  `hasRecords`, and it returns early: nothing partial is drawn beside it.
- **Colour is never the only signal** — the four tiles, every timeline row and
  every absence row name their status in text beside it, through the shared
  `ATTENDANCE_DISPLAY_ORDER` and `ATTENDANCE_COLORS`. The chart's bars are
  `aria-hidden` because every value they encode is already written underneath in
  text; each of the five regions is a labelled `<section>` with a real heading. No
  chart library was added, and the tab installs no focus handling of its own.

#### The positive contract assertion Gate 2.1 left unwritten
- `tests/reviews-ui.test.ts` #83 bounds what MAY branch and is **untouched**.
  `tests/student-attendance-ui.test.ts` now states the other half positively:
  Attendance branches and renders the component, **Homework does not yet**,
  Classes and Finance never do, the fallback survives, `TABS` is unchanged, and
  the branch set is exactly `["Overview", "Reviews", "Attendance"]`.
- `tests/student-homework.test.ts` #29 moved once, deliberately and in the gate
  that made it false: its Attendance clauses retired into the positive suite
  above, and its **Homework** clauses are untouched and still bite.

#### Responsive
- **`.sp-split` is declared in `globals.css`, in its own Student Profile section**,
  and the stylesheet owns `grid-template-columns`. The element carries a class and
  no inline template — an inline declaration beats every media and container rule
  written against it, which this repository has shipped as a dead rule more than
  once.
- It collapses on a **container query** anchored to the existing
  `[data-screen-label="Student profile"]`, declared for `screen` only, following
  Reports (Gate 6.4) and Settings (Gate 4). **No new viewport breakpoint**: a
  container query is not a media query, so the allowlist in
  `tests/finance-ui.test.ts` #122 is untouched.
- **The threshold is 600px, derived from this tab's own content — deliberately not
  Reports' 667.** Borrowing 667 would have broken `tests/reports-ui.test.ts` #107
  and #116, which pin it as the file's single occurrence, and editing two banked
  guards in a closed sprint to say something they were written not to say is the
  wrong trade. The binding constraint here is the supporting column: a status
  badge that must not wrap, its gap, 40px of card padding and room for a class
  name to ellipse — about 230px, which at 1.6fr / 1fr needs about 598px of
  container. **The block was also moved above the Settings section**, because
  `tests/settings-propagation.test.ts` #6 slices from the Settings banner to
  end-of-file and would otherwise have read `.sp-split` as an un-namespaced
  Settings selector. Both guards now pass unmodified.

#### Translations
- **Every string it renders already had a Vietnamese entry.** The keys Gate 1
  found ported and unread now have their reader, and **no thirteenth key was
  invented**; the tab reads the one `useSettings` store and defines no local
  dictionary. `en` continues to use the existing source-string fallback.

#### Tests
- **`tests/student-attendance-ui.test.ts` (37).** Totals move 2683 -> 2720, all
  green, with every pre-existing guard intact.
- **Mutation-tested, five defects introduced and reverted.** Removing the
  Attendance branch fails #1 and #5; printing a null rate as `0%` fails #16;
  letting `Excused` into the absences card fails #23; moving the grid template
  inline fails #27; deleting the container-query collapse fails #28.
- **Three banked guards were found by breaking them first, and all three were left
  sealed** — `reports-ui` #107 and #116 on the uniqueness of 667, and
  `settings-propagation` #6 on Settings selector namespacing. The fix was to
  change this sprint's own CSS, not their assertions.

#### Not done here, and not claimed
- **Manual browser QA has NOT been performed.** There is no browser automation in
  this repository — no Playwright, Puppeteer or Cypress — so the widths 1440,
  1280, 1100, 860, 767, 620, 430, 390, 360 and 320, the density and theme
  variants, the Vietnamese/English pass and the pointer-versus-keyboard focus
  behaviour are **reserved for human QA** rather than reported as passing.
- **Homework UI, the Homework read model and every Homework endpoint are
  untouched.** Finance, Classes and Reviews are untouched. **Finance — Class
  Payment Slip Printing remains deferred**: no QR asset, bank information, print
  component, billing API, payment UI, Settings field or print stylesheet.
- **No schema, index, migration, dependency or production write.** Sprint 13 is
  not complete.

### Gate 5 — the Homework tab
- **The Homework tab is built, and the branch set is now complete.** Four of the
  six tabs render their own body — Overview, Reviews, Attendance, Homework — and
  that is the final count: **Classes and Finance never gain a branch**, because
  the imported design supplies them no tab body, so the comp's later-sprint panel
  is their permanent state rather than a temporary one.
- **`src/components/homework/student-homework.tsx`** renders the comp's
  `tabHomework` section: the completion ring beside the four summary tiles, the
  homework timeline, and *Missing homework* / *Late homework* in the supporting
  column. The profile page gained **exactly one branch**; it passes a student id
  and nothing else — no class list, no assignment, no submissions map.
- **The payload is rendered as it arrives.** No `Math.round`, `reduce(`,
  `filter(` or `sort(` appears in the tab. `missing` and `late` are the SERVER'S
  lists, not the timeline filtered twice: the two are capped differently (20 and
  5), so rebuilding one from the other would silently lose rows for a student
  with a long history.
- **The submissions map never crosses the wire.** Each row's status is already
  this student's own outcome, resolved on the server, so the browser is handed an
  outcome rather than a map it could read another student's key out of — and an
  assignment's own top-level status can never be mistaken for a person's result.
  A test asserts no `submissions[` subscript and no `.submissions` read.

#### The two contract cases this tab is easiest to get wrong
- **"No outcome yet" is not "no homework".** A student whose work is all still
  `Assigned` has `completionRate: null` with real assignments. The whole-tab empty
  state is decided by the server's `hasRecords` **and by nothing else** — a test
  now pins the branch condition to exactly `!data.hasRecords` and forbids
  `completionRate` or `counts.total` from gating any branch in the file. The ring
  shows the shared em dash and **draws no arc at all**, because a zero-length ring
  labelled 0% would state an assessment nobody made.
- **`Total` includes `Assigned`**, so it is legitimately larger than
  `completed + late + missing`. Each tile reads its own server field; a test
  forbids summing the other three, which would delete the unmarked work from the
  screen.

#### States
- Loading is a skeleton in the tab's own `.sp-split` shape that reads no data and
  shows no values. **Error is decided before empty**, so a failed request can
  never render *"No homework assigned to this student yet."* — a claim about the
  record rather than about the network — and there is no `?? []` or `?? 0`
  papering over a failure. The empty state carries the comp's own **Assign
  homework** action, which opens the Homework index: there is no student-scoped
  assign deep link and inventing a route to carry one is out of scope, so it opens
  the narrowest existing relevant screen.

#### Responsive — zero CSS changes
- **`globals.css` is byte-identical to Gate 4.** The tab reuses `.sp-split` and
  the existing `sp-page` container query unchanged; a test asserts there is still
  exactly one Student Profile container query, one `container-name`, two
  `.sp-split` rules, no new viewport breakpoint, and that Reports' 667 threshold
  is still the file's single occurrence.

#### Translations
- **One key was added, and it is a missing sibling rather than a new pattern.**
  The comp draws `attended` under the Attendance ring and `completed` under this
  one; `"attended"` was already in the dictionary and `"completed"` was its absent
  twin. Every other string reuses an existing key — including `"Due"`, which the
  Homework index already renders the same way, rather than adding the comp's bare
  lowercase `due`.

#### Tests
- **`tests/student-homework-ui.test.ts` (38).** Totals move 2720 -> 2758, all
  green.
- **Mutation-tested, five defects introduced and reverted.** Removing the Homework
  branch fails #1/#3 here and #2/#5 in the Attendance UI suite; rendering a null
  completion as `0%` fails #16 and #18; treating an Assigned-only payload as empty
  fails #13, #14 and #15; deriving `Total` from the other three fails #20;
  client-filtering the timeline to build the Missing list fails #9, #22 and #25.
- **The third mutation exposed a real defect in this gate's own test, and it was
  fixed.** #15 originally sliced the file between two landmarks and asked whether
  `completionRate` appeared inside. Widening the empty-state condition moved the
  opening landmark, the slice collapsed, and the assertion **passed while the
  defect was live**. It now reads the branch condition itself and pins it to
  `!data.hasRecords` exactly, which cannot fail that way.

#### Guards
- **One banked guard was updated, deliberately and in the gate that made it
  false.** `tests/homework-ui.test.ts` #64 pinned the Homework client at four
  endpoints since Sprint 7; Gate 5 adds the fifth — `GET
  /api/homework/student/:studentId`, approved in the banked Sprint 13 contract and
  shipped in Gate 3 before any client touched it. This is the same tripwire
  Sprint 8 moved from one finance export to two. **What the guard actually
  protects is untouched**: the new call carries no `method`, so the write verbs
  are still exactly DELETE, PATCH and POST, and #66's "no submission mutation"
  stands.
- **Gate 2.1's bounded-branch guard (`tests/reviews-ui.test.ts` #83) needed no
  change and was not touched** — it already permitted Attendance and Homework and
  still forbids Classes and Finance.
- Two of this sprint's own tests moved into their positive form, each in the gate
  that made it false: `student-attendance-ui` #2 and #5 now assert four branches,
  and `student-homework` #29 retired its "no UI yet" clauses into the new UI
  suite while keeping its own subject — the read model as the screen's only
  source.

#### Attendance regression
- **`student-attendance.tsx`, `attendance-ui.tsx`, the Attendance client, the
  Attendance endpoint, both `student-profile` library files and `globals.css` are
  all byte-identical to Gate 4.** Both Attendance suites pass unchanged (37 UI,
  32 read model). The two components deliberately share no code beyond the
  geometry and formatting helpers they already had — generalising them belongs
  after sprint closure, not while the second tab is being introduced.

#### Not done here, and not claimed
- **Manual browser QA has NOT been performed.** There is still no browser
  automation in this repository, so the width matrix, density and theme variants,
  the Vietnamese/English pass and the focus behaviour — for **both** tabs together
  — remain reserved for the human gate.
- **No schema, index, migration, dependency or production write.** No submission
  writer: the tab holds no mutation and cannot record an outcome. **Finance —
  Class Payment Slip Printing remains deferred and untouched.** Classes, Finance
  and Reviews are untouched.

### Gate 6 — integrated responsive + accessibility QA (both tabs together)

#### The defect this gate found, and the app had already named it
- **The four summary tiles could not collapse.** Both tabs draw a ring beside a
  four-up count row, and the comp writes that row as an inline `repeat(4,1fr)` —
  a hard-coded **desktop** column count. An inline declaration beats every media
  and container rule ever written against it, so the count was fixed at four at
  every width. This is the **identical fault `globals.css` already records
  against the two Attendance screens**: *"Both Attendance screens hard-code a
  desktop column count inline, so the count never changed on a phone ... giving
  each about 63px"*. `.att-summary`, `.att-stats`, `.kpi-grid` and `.ov-grid` are
  all that same escape; these two tabs shipped the unguarded form and had none.
- **It is two faults, and the first one scrolls the page.** A `1fr` track is
  `minmax(auto,1fr)`, and that `auto` is the grid item's **automatic minimum
  size** — a track refuses to shrink below its own min-content. Four tiles of
  24px padding around an unbreakable word (`Completed` is the long one) are a
  floor the row cannot go under, so the tracks come out **unequal** and the row
  spills out of its own box. The second fault is readability, which is why the
  count collapses rather than the tiles merely shrinking. **Gate 6.1 measured
  this and corrected the severity claimed here — see its entry: the spill lands
  in the card padding and does NOT scroll the page.**

#### The fix, which is the app's own and adds no new number
- **`.sp-tiles`, and the stylesheet owns the template.** The inline
  `gridTemplateColumns` is gone from **both** tabs — live row and skeleton, so the
  shape does not change when the data arrives — exactly as Gate 4 did for
  `.sp-split` and for the same stated reason.
- **`minmax(0,1fr)` tracks**, removing the automatic minimum size, as `.ov-grid`,
  `.kpi-grid` and `.att-summary` already state in their own templates. It changes
  nothing at any width where the tiles already fit.
- **4 -> 2 on the SAME 600px container query Gate 4 declared.** No new threshold,
  no new container, no new `container-name`, and **no new viewport breakpoint** —
  the 620/767/860/1099/1100 allowlist is untouched. Above the threshold the row is
  the comp's four columns, unchanged. **One class serves both tabs**, so the fix
  exists once and cannot drift.
- **`overflow-wrap:anywhere` on the tile label** — the one guarantee that does not
  depend on a font metric this repository has no browser to measure.
- **No overflow escape hatch.** Nothing gained `overflowX`, and the app still has
  exactly the three horizontal scroll regions `tests/finance-ui.test.ts` #123 pins.

#### The test gap was the real finding
- **The defect was live and the suite was green.** No guard covered the tile row
  at all. Eight were added — **2758 -> 2766** — and every one was mutation-tested:
  restoring the inline template, using bare `1fr` tracks, deleting the collapse,
  dropping the label guard, collapsing with a **viewport** media query instead,
  and fixing only the live row while leaving the skeleton inline each fail a named
  assertion. The last proves the "live row **and** skeleton" clause is not
  vacuous; the viewport mutation is also caught by Gate 4 #30 and Gate 5 #29.

#### Verified unchanged
- **`src/lib/student-profile.ts` and `src/lib/student-profile-service.ts` are
  byte-identical.** No backend semantics, API response shape, ordering rule, cap
  or count changed — the fix is presentation-only. Classes and Finance still have
  no profile branch, `TABS` is still its six entries in order, and Overview and
  Reviews were not touched.
- **Localization.** All **thirty-two** strings the two tabs render resolve in
  Vietnamese, including `"completed": "đã hoàn thành"`; no key is missing and no
  thirteenth key was invented.
- **Theme and accent.** Every colour either tab uses is a token defined in **both**
  `:root` and `[data-theme="dark"]`; **neither tab contains a single hex literal**,
  so theme, accent, surface and density all reach them through tokens.

#### Recorded, not fixed
- **Heading level skip.** The card titles are `<h3>` under the profile's `<h1>`
  with no `<h2>` between. It is **not a regression** — those headings did not exist
  before Sprint 13, which added them — and this gate was told not to open an ARIA
  refactor, so it is recorded for a later sprint rather than churned here.
- **The comp's dynamic rate colours** (`attHist.pctColor`, `m.barColor`,
  `hwStudent.rateColor`) are resolved to one static token, which is the precedent
  Reviews' shipped `MetricCard` already set for `perf.attColor`. Inventing a
  threshold colour scale would be design this sprint may not do.

#### Not done here, and not claimed
- **The browser matrix is HUMAN REQUIRED.** There is still no browser automation
  in this repository, so the ten widths, the sidebar-expanded/collapsed and density
  permutations, both themes, both languages, pointer-versus-keyboard focus, and the
  live data/UI spot check against real backend values are **not claimed as PASS**.
  Sprint 13 needs a **Gate 6.1 human re-test** before closure.
- **Finance — Class Payment Slip Printing remains deferred and untouched.** No QR
  asset, bank information, print component, billing API, payment UI, Settings field
  or print stylesheet.

### Gate 6.1 — browser re-test (measured, not human; see the limits below)

#### How this was tested, and what that is worth
- **There is still no human browser QA in this record, and none is claimed.** What
  this gate adds is *measurement*: Chrome (already on the machine) was driven over
  the DevTools Protocol from a script using **Node built-ins only** — Node 24 ships
  a global `WebSocket`, so **no dependency was added** and `package.json` is
  untouched.
- **It measured a harness, not the running app.** The live app could not be driven:
  reading `.env.local` is blocked, so booting a server against its database and
  logging in as admin was not something to do unasked. Instead a harness page was
  built that **extracts the real rules out of `src/app/globals.css`** — the `:root`
  and `[data-theme="dark"]` token blocks, `.sp-split`, `.sp-tiles`, the
  `sp-page` container declaration and its collapse — reproduces the real shell
  (248px sidebar / 64px rail, `.app-main` 1400px cap and its three paddings) and
  the real tab markup, and carries the app's own
  `width=device-width, initial-scale=1`.
- **What that cannot tell you:** it has no real data, no React, no React Query, and
  **not the app's Geist font** (it falls back to a system stack), so text metrics
  differ somewhat from production. It says nothing about keyboard behaviour, the
  pointer-versus-keyboard focus ring, the live sidebar toggle, the other four
  profile tabs, the empty / Assigned-only / error states, or whether any of it
  *looks right* to a person. **Those remain HUMAN REQUIRED.**

#### What was measured
- **120 combinations**: 2 tabs x {en, vi} x {light, dark} plus two density variants
  (`--gap` 11px and 26px), each at all ten required widths — 1440, 1280, 1100, 860,
  767, 620, 430, 390, 360, 320.
- **Zero page-level horizontal overflow in all 120**, and zero elements crossing the
  viewport edge. The container behaves as the contract intends: it tracks the
  **container**, not the viewport — 1128px of container at a 1440px viewport,
  592px at 620px, 292px at 320px — and `.sp-split` collapses whenever the container
  is at or under 600px, which includes 860px and 767px viewports (rail present,
  container 576px and 483px). `.sp-tiles` resolves to 4 columns above the threshold
  and 2 below it, at every language, theme and density.

#### THE GATE 6 SEVERITY CLAIM WAS WRONG, AND IS CORRECTED HERE
- Gate 6 stated that the pre-fix inline `repeat(4,1fr)` made **the document scroll
  sideways**. A like-for-like control — the same harness rebuilt with the inline
  template and no `overflow-wrap`, measured the same way — shows **it did not**, at
  any of the ten widths, in either language. That claim was reasoning, not
  measurement, and it was overstated. The `globals.css` comment, the test comment,
  the README and the Gate 6 changelog entry have all been corrected in place.
- **What the defect actually was**, measured in Chrome at 320px on the Homework tab
  in English: `repeat(4,1fr)` produced tracks of **47 / 78 / 44 / 61px** — not four
  equal columns, because the `auto` minimum floored the `Completed` tile while its
  neighbours were squeezed — and the row's content overflowed its own box,
  **scrollWidth 260 against clientWidth 250**. At 430px the card's own scrollWidth
  exceeded its clientWidth. The spill landed in the card's 20px padding, so the
  page never gained a scrollbar.
- **The fix remains correct and is kept**, on the two grounds that survive
  measurement: **comp fidelity** — the design draws four *equal* tiles and now gets
  them (120/120/120/120 at 320px, 2-up) — and **containment** — grid scrollWidth
  now equals clientWidth at every width tested. It was not, as Gate 6 implied,
  repairing a page-breaking bug.

#### Verified visually (screenshots inspected)
- Both tabs at 320px in English/light, Vietnamese/dark: 2x2 tiles with equal
  widths and full labels; the six-month chart fits with readable labels; **the
  monthly point with no data renders the em dash and the design's minimum-height
  stub, never `0%`**; timeline rows stay inside their card with class names
  ellipsing; the longest Vietnamese badge (`Đã hoàn thành`) does not push its row;
  `đã hoàn thành` resolves under the ring; every dark-theme token resolves with
  legible contrast.

#### Unchanged
- **No source behaviour changed in this gate.** `src/app/globals.css` changed only
  inside a comment; `tests/student-attendance-ui.test.ts` only inside a comment. No
  component, read model, endpoint, dependency, schema, index or migration was
  touched, and the suite stays at **2766 / 2766**.

## Unreleased — Notifications (Sprint 12) — **shipped, human-verified, merged, production verified, CLOSED**

### Gate 1 — roadmap discovery
- The numbered priority list in `PROJECT_RULES.md` (`# Current Milestone`) runs
  **1. Students … 9. Settings** and was fully consumed by Sprint 11. It names no
  tenth module, so it establishes no ordering after Settings, and the string
  `Sprint 12` appeared nowhere in the repository.
- **Notifications was nevertheless the only module the repository designated for
  a sprint of its own**, in four independent places written across three sprints:
  `PROJECT_RULES.md` (`## Settings`), `README.md`, this file, and
  `RECURRENCE_DESIGN.md` — the last of which also recorded that retiring a lesson
  someone was notified about "needs a rule; none exists yet". Every other deferred
  item (Global Search, Excel export, the Homework submission writer, AI review
  generation, cross-device sync, timezone, report branding, organisation settings)
  is deferred **without** a sprint.
- Gate 1 therefore identified the module but **blocked**: no `## Notifications`
  section existed, so there was no product contract, and the only statement of
  what a notification *is* came from a single design-comp subtitle naming three
  sources and defining none of them. Inventing those rules is forbidden by
  `CLAUDE.md` and by the `## Missing UI Specification` rule.

### Gate 1.1 — contract banked
- **Sprint 12 is Notifications**, and the contract is now banked in
  `PROJECT_RULES.md` as a dedicated `## Notifications` section, before any code —
  the same order every prior sprint used.
- **Scope:** the existing header bell becomes interactive. Three notification
  types and no fourth — **unpaid tuition** (`Unpaid` / `Partially Paid` Billing),
  **upcoming makeup** (active, uncancelled, unpassed, within 7 calendar days
  inclusive) and **review due** (period complete, expected Review absent).
- **Notifications own no data.** No `Notification` model, collection, schema,
  index, migration or backfill; no persisted copy of any Billing, Lesson or Review
  value; and no notification interaction writes to any domain collection. The
  `Activity` model is explicitly **not** a notification source and is not
  repurposed. Source data is server-owned and derived at read time; only
  acknowledgement is stored, device-locally, in the two **already-reserved** keys
  `etlms.notifRead` and `etlms.notifDismissed`. **No third key, no rename, no
  cross-device sync and no `/api/notifications` route.**
- **Also banked:** read and dismiss as distinct acts (opening the panel marks
  nothing read); a deterministic stable derived id built from type, source
  identity and period — never an index, render order, UUID or presentation text;
  deterministic ordering with source identity as the final tie-breaker; a
  presentation-only cap of **20** items; deduplication on the stable id;
  navigation into existing screens only, creating nothing and inventing no route;
  and the live-view rule — a source that stops qualifying loses its notification,
  and a stale acknowledgement entry can never resurrect or invent one.
- **Nothing is ever sent.** No email, SMS, `mailto:`, browser push or push-service
  integration; no parent-facing or student-facing delivery; no reminder action in
  Finance, Reports or anywhere else. The bell is a read-only awareness layer.
- **The Sprint 11 Settings contract is unchanged.** Sprint 12 does **not** add the
  Notifications Settings card: Settings keeps three sections, nine settings, no
  Save/Apply and no new persistence. The design reference's Notifications card
  stays deferred and non-shipping.
- **One authorised test-contract inversion, and only one.**
  `tests/settings.test.ts` #15 asserted that the reserved keys were "read by
  nothing" — true of every sprint up to and including Sprint 11, and no longer the
  invariant once Sprint 12 gives them a reader. It is **inverted, not deleted**,
  and now pins what always mattered: both keys declared and unrenamed, exactly two
  notification keys, no Settings surface reading either, and — as the anti-vacuity
  guard — a **recursive walk of all of `src/`** requiring every reader to be the
  declaring module or Notifications code. The old form scanned four Settings
  files, so a reader placed anywhere else would have satisfied it while proving
  nothing; the walk cannot be escaped that way. Verified by mutation: a reader in
  `lib/dashboard.ts`, a third `notif*` key, and a renamed key each fail it.
- **Guards deliberately left unchanged:** no Notifications card in Settings, three
  Settings sections, the Finance reminder/send/notification ban, and the Reports
  notification ban.
- **No feature code, route, model, schema, index, migration, storage key or
  production write was introduced by this gate.** Gate 1.1 is contract and
  test-contract only; the positive assertion that a reader *exists* belongs to
  Gate 2, because at banking time it would assert something unbuilt.

### Gate 2 — the headless engine
- Derivation, ordering, deduplication, the stable id and the acknowledgement
  transitions ship as pure modules (`lib/notifications.ts`,
  `lib/notification-state.ts`, `lib/notification-ack-store.ts`) with no React,
  no fetch and no storage call inside the rules themselves. **No model,
  collection, index, migration or `/api/notifications` route was created**, as
  the contract requires.
- The contract left the **review-due** window unbounded; it is now bounded, so a
  long-dormant student cannot accumulate an unbounded backlog of due periods.

### Gate 3 — header integration
- The existing header bell became interactive. Source data is read in
  `(app)/layout.tsx` — the layout every authenticated route already renders — and
  handed down as props, so the panel needs **no API route and no client fetch**.
- Acknowledgement is client-only and device-local, in the two reserved keys and
  no third.

### Gate 4 — UI hardening
- **A right-anchored popover clipped off the left edge of every phone**, with no
  scroll able to reveal it. Below 767px the panel is now `position:fixed` with
  `left:20px;right:20px`, so it is inset 20px on both sides at every mobile width
  and cannot introduce horizontal overflow.
- Badge contrast was corrected to use `--primary-fg` rather than a hard-coded
  colour, so it follows every accent in both themes.

### Gate 5 — falsification audit
- Running the real modules against adversarial input found **two defects that
  could 500 every authenticated page**, because derivation runs in the shared
  layout: a `Student` with no `joined` and a `Billing` with no `month`. Both
  fields are typed `string` but neither is `required` in its Mongoose schema, so
  such documents are legal in the database today — **the domain types were a
  promise the storage layer does not keep.**
- Both now skip the record and fail closed rather than defaulting, and a
  well-formed record beside a malformed one is still reported.

### Gate 6 / 6.1 — human verification
- The human browser pass **PASSED** and returned two defects, both fixed at
  `b074656` without touching `src/lib`.
- **A pointer click left a stale keyboard focus ring.** `:focus-visible` is only
  re-evaluated when focus *changes*, so clicking an already-focused control fires
  no focus event and the keyboard ring stays lit. Fixed with the browser's own
  modality signal — `event.detail > 0` distinguishes a real pointer click from
  Enter/Space — releasing focus for the pointer and leaving the keyboard ring
  intact. No outline rule was added, removed or redefined.
- **Read and unread rows were visually identical once the panel was open.** The
  badge counts but says nothing about *which* rows are new. Added as an
  authorised inversion of the Gate 4/5 guard: an `--accent-soft` row background
  and a small `--accent` dot drawn on the already fixed-width icon tile, so no
  geometry changes. **Four** hover states, not two, because a single
  `:hover{background:var(--hover)}` would paint read and unread identically the
  moment the cursor crossed either; the hovered-unread value is computed from the
  same two tokens with `color-mix`, so every accent and both themes follow with
  nothing hard-coded and no new token.

### Gate 7 — merge and production deployment
- Validation re-run on the branch before merging: **2621 / 2621 tests**, lint 0
  errors (the same 8 pre-existing warnings), `tsc --noEmit` clean, production
  build green, `git diff --check` clean.
- Merged into `main` by **fast-forward** — `b542fd4` to `b074656` — preserving all
  six Sprint 12 commits. No squash, no rebase, no merge commit, no history
  rewrite. The Sprint 12 branch is retained.
- Deployed to **Vercel Production** (`teacher-lms-lake.vercel.app`) as
  `dpl_7UjsRvwXG2jJz1owZsEiPdpgH5wF`, READY.
- **The deployed artifact was proven identical to a local build of `b074656`**:
  all 41 static chunks and the stylesheet match by MD5, the single exception
  being Vercel's own injected toolbar snippet — which itself names that
  deployment id. This is a stronger identity proof than deployment metadata, and
  it is how the deployed SHA was established.
- **No production write of any kind.** No domain record was created or mutated
  for verification, and no DDL was performed — Notifications declare no index.
- The browser re-pass against Production was subsequently performed by the user
  and returned A–G all PASS — on bytes already proven identical to the ones the
  Gate 6 pass verified.

### Closure audit — PASS
- Audited against the **merged code on `main`**, not against the gate reports.
  The shipped implementation still matches the banked `## Notifications`
  contract in `PROJECT_RULES.md`.
- **Surface, audience and types:** the header bell is the whole surface — no
  `/notifications` route, no `/api/notifications`, no sidebar item, no
  Notifications Settings card, and nothing is ever sent. Exactly three types
  ship. A fourth `BillingStatus` is caught at **compile time** by
  `BILLING_STATUSES_ARE_CLASSIFIED`, verified by mutation: adding a `Waived`
  status fails `tsc --noEmit` at `notifications.ts`.
- **Derivation:** `Unpaid` and `Partially Paid` qualify and `Paid` does not;
  one Billing record yields at most one notification. Makeup is filtered to
  `type === "makeup" && status === "Upcoming"` within `today … today+7`
  inclusive, so +8 and the past are excluded and a retired lesson cannot appear
  — retire is a hard delete, so the record is simply not in the collection.
  Review due keeps its exact four-part bound: a completed month, the student
  already joined, a `Completed` lesson that month in a class whose roster holds
  the student, and no existing Review. Nothing was broadened.
- **Read-only:** derivation calls `getAll()`, which is `find().lean()` across
  the collections and writes nothing — notably it does **not** advance the
  lesson lifecycle. No notification interaction writes to any domain
  collection.
- **Identity, ordering, cap:** ids are `type:sourceId[:context]` — no index, no
  render order, no UUID, no presentation string. Type rank is tuition, makeup,
  review; `sortKey` orders within a type and the stable id is the final
  tie-breaker. Dedup is by id. The cap is 20 and presentation-only: `active` is
  returned untruncated, item 21 stays eligible, and `unreadCount` and
  `markableIds` both run over the whole undismissed set rather than the twenty
  drawn.
- **Read and dismiss stay distinct:** opening the panel marks nothing, opening
  one row marks only that row, *Mark all read* dismisses nothing, and a stale
  acknowledgement entry is inert — it can filter an active notification but can
  never bring one into existence.
- **Persistence containment:** no Notification model, collection, schema, index,
  migration or backfill; no server-side acknowledgement; and `storageKeys`
  still declares exactly two notification keys, unrenamed.
- **Refresh boundary unchanged and accepted:** no `setInterval`, `WebSocket`,
  `EventSource`, `refetchInterval`, `router.refresh` or client fetch anywhere in
  the Notifications code or the layout that derives it.
- **Focus fix stays local:** `releaseIfPointer` exists in exactly one file. No
  bare `:focus` was introduced, the shared `:focus-visible` treatment is
  untouched, and no global modality subsystem was added.
- **Responsive rule still owns its geometry:** the panel carries no inline
  `width`, `position`, `top`, `left` or `right`, so the stylesheet cannot lose to
  an inline declaration — the trap this repository has shipped before.
- **Cross-module containment:** the whole sprint touches 15 source and test
  files plus three documents. No API route, model, schema, migration,
  middleware, auth, JWT or cookie file, and **no dependency change**. Exactly
  **eight** test lines were deleted across the sprint, all of them the single
  authorised `settings.test.ts` #15 inversion — no other guard was weakened.
- **Residue:** one item found and fixed — a trailing blank line at the end of
  `notification-menu.tsx`, flagged by `git diff --check` over the merged range
  and out of step with every sibling file. Whitespace only, no behaviour
  change. No TODO, FIXME, HACK, XXX, WIP, `console.*`, `debugger`, `.only`,
  `.skip`, dead export, commented-out alternative, temporary flag, generated
  file, NUL byte or line-ending churn was found. Six exports that a naive scan
  calls unused are each used inside their own module, except
  `BILLING_STATUSES_ARE_CLASSIFIED`, whose purpose is to be referenced by
  nothing and checked by the compiler.
- **One recorded observation, not a defect:** a makeup moved to a different
  *time on the same day* keeps its stable id, because the id's context is the
  date. A move to another date correctly produces a new identity. Same-day
  moves are the same logical "makeup on this day", so a prior dismissal
  continuing to apply is the intended reading of the contract.

### Final verification at closure
- **2621 / 2621** tests, 409 suites, 0 failures, 0 skipped, 0 todo — unchanged
  from the Gate 7 baseline. Targeted suites all green: notifications 63,
  notification-state 49, notifications-ui 89, settings 122,
  settings-propagation 50, responsive-shell 78, responsive-components 36,
  finance 47/67/169, reports 76/40/119/137, reviews 91/42/79/130, composer 90,
  isolation 35, recurrence 59.
- lint 0 errors and the same 8 pre-existing warnings, `tsc --noEmit` clean,
  production build green, `git diff --check` clean.

### Human verification — authoritative
- **Gate 6 (initial):** PASS except two findings — a stuck pointer focus ring,
  and no per-row read/unread distinction.
- **Gate 6.1 (fixes):** pointer modality focus release, unread accent background
  plus dot, and a distinct unread hover treatment.
- **Human re-test:** R1 PASS, R2 PASS.
- **Production Gate 7 (A–G):** A PASS, B PASS, C PASS, D PASS, E PASS, F PASS,
  G PASS. B covers the four high-risk widths **320, 360, 390 and 430** — no left
  clipping, 20px clearance each side, no horizontal scroll, dismiss fully
  visible.

### Sprint 12 is CLOSED
All gates complete: contract banked, headless engine, header integration,
responsive and visual hardening, regression audit, human verification, human
re-test, merge to `main`, Production deployment, Production browser
verification and this closure audit. `main` is fast-forwarded and linear with no
squash, rebase, merge commit or force push, `sprint-12-notifications` is retained
at `b074656` and fully contained in `main`, and the working tree is clean.

## Unreleased — Settings (Sprint 11) — **shipped, human-verified, merged, CLOSED**

### Closure audit — **passed**
- Run against the **merged** code on `main`, not against the gate reports.
  Runtime commit `ceb1e8b`, closure documentation `6e69042`; every Sprint 11
  commit contained in `main`, `main == origin/main`, working tree clean and 0
  unpushed.
- **All Sprint 11 gates complete and all human re-tests recorded PASS.** Every
  issue raised at Gates 6, 6.1, 6.2 and 6.3 was fixed before closure, and no
  blocker remains open.
- **The shipped implementation matches the accepted contract**, re-verified in
  the current source: nine settings and no tenth; existing `etlms.*` keys with
  no key added or renamed; no Save/Apply, server action, Settings API, model,
  schema, index or migration; Workspace card read-only; VND the source currency
  with USD display-only over the untouched existing rate; `vi` the default with
  `en` on the source-string fallback; no auth, JWT or cookie change; and no
  dependency change since the sprint baseline.
- **No residue.** No TODO, FIXME, HACK, `console.*`, `debugger`, `it.only`/
  `.skip`, environment escape hatch or test-only bypass was introduced anywhere
  in the sprint diff, and no migration or backfill script was touched. The
  retired Gate 6.2 `data-settings-ready` gate survives only as prose explaining
  its removal and as negative assertions proving it is gone.
- **Containment re-verified at the system level.** Exactly one readiness
  boundary exists — one emitter in `app-shell.tsx`, one hiding rule, one
  descendant reveal rule. `ThemeScript` and the root layout are untouched since
  the baseline, so theme first paint is unchanged. Every `--control-gap` /
  `--control-gap-tight` consumer uses the token **only as `gap`** — never a
  width, height, padding or type size — and all seven clusters can wrap, six
  inline and `.act-row` through the mobile breakpoint, so mobile at Airy cannot
  overflow. Both shared field-hover rules exclude `:disabled`, both Settings
  hover rules exclude `[aria-pressed="true"]` so a selected control is never
  downgraded, and every accent state resolves through `--accent` /
  `--accent-soft` with no hard-coded colour.
- **Final gates on `main`:** lint **0 errors** with the same 8 pre-existing
  warnings, **2420 / 2420 tests**, production build green, `git diff --check`
  clean.

### Closure — merged to `main` at `ceb1e8b`
- **Sprint 11 is closed.** Contract banked in `PROJECT_RULES.md` before any code
  (`## Settings`); implemented across six commits on `sprint-11-settings`;
  human-verified against `ceb1e8b`; fast-forwarded into `main`.
- **Implementation history, preserved in full — no squash, no rebase, no force
  push, and the merge was a fast-forward so `main` gained no merge commit:**
  - `594f5ab` — core Settings page (and the authorised `reports-ui` test
    reversal, in the same commit that replaced the placeholder, as banked)
  - `0b2d859` — responsive / integration hardening
  - `99de52c` — test-quality repair (two vacuous assertions)
  - `60620e0` — human-verification defects
  - `f92a46b` — language / density / hover polish
  - `ceb1e8b` — app-wide preference consistency
- **Human verification PASS is authoritative**, against deployed `ceb1e8b`:
  **A** app-wide language hydration — no Vietnamese flash on the authenticated
  workspace with English persisted, sidebar/header/content reveal together, no
  layout jump, login unaffected. **B** density — Tight/Cozy/Airy visibly move the
  intended shared control clusters while control heights and typography hold, and
  header spacing stays fixed by design. **C** accent hover — shared
  input/textarea/select follow the current accent in both themes, the neutral
  black/grey hover is gone, disabled and error states remain correct. **D** focus
  — keyboard ring visible, pointer/touch leaves no stuck ring, selected state
  clear. **E** regression sweep — expected accent/density propagation only, no
  semantic status regression, no overflow or clipping, Finance/Reports meaning
  unchanged, Print/PDF still theme-neutral.
- **Final gates, on merged `main`:** lint **0 errors** (the same 8 pre-existing
  warnings, none new), **2420 / 2420 tests passing**, production build green,
  `git diff --check` clean. The 2420 figure is the 2235 audit baseline plus the
  Settings, propagation, form-control and readiness suites this sprint added; no
  pre-existing test was weakened or deleted.
- **Scope shipped:** the Settings page over the existing store; stored-preference
  validation; app-wide workspace language readiness at `AppShell`; shared density
  propagation to seven control clusters through tokens derived from `--gap`;
  shared accent-aware form-control hover; `:focus-visible` for the shared ring.
- **Nothing outside that scope changed.** The merged diff touches no API route,
  Mongoose model, schema, index, migration, auth/JWT/cookie path, Finance or
  Reports arithmetic, Review business logic, Billing semantics, PDF theme or
  print implementation, and **no dependency manifest**. The seven page files
  touched by density carry a one-line `gap` change each and nothing else.
- **No production data was created, edited or deleted**, and **no production DDL
  was declared or run** — Settings owns no data, by contract.
- **Notifications did NOT ship**, and no part of one was drawn. The application
  still has no notification source, model, menu, unread count or read state; the
  reserved `etlms.notifDismissed` / `etlms.notifRead` keys remain read by
  nothing. **Notifications requires its own sprint.**
- **Also still deferred / out of scope, unchanged:** cross-device preference sync,
  configurable timezone or application clock, report-branding, school or
  organisation settings, module-specific defaults, password / security /
  auth-provider settings, session management, and any tenth setting.

### Gate 7 — final merge readiness
- Final contract audit re-run against `PROJECT_RULES.md`: nine settings and no
  tenth; existing `localStorage` keys only, with no key added or renamed; no
  Save/Apply, no server action, no Settings API, model or schema; Workspace card
  read-only; VND remains the source currency with USD display-only and the
  existing fixed demo rate untouched; `vi` remains the default with `en` on the
  source-string fallback and no second dictionary; theme/accent/surface/density
  remain shared-store preferences; responsive and accessibility contracts hold.
  No FAIL.
- Focused suites re-run before merging — Settings, Settings propagation, form
  controls, responsive shell, responsive components, Finance UI, Reports UI,
  Reviews UI, Reports PDF, Review PDF, drawer dismiss and date-field state:
  **1044 / 1044 passing**.
- Post-merge gates re-run on `main` itself rather than trusted from the feature
  branch: lint, tests, build and `git diff --check` all green.

### Gate 6.3 — app-wide preference consistency (`ceb1e8b`)
- **The language-flash fix moved to the right boundary.** Gate 6.2 hid the
  Settings page until the store was readable, which fixed `/settings` and nothing
  else — the sidebar, header, page titles, descriptions, inputs and tabs all
  still painted Vietnamese first. The gate now lives on `AppShell` and publishes
  `data-workspace-ready` as a **server-emitted attribute**, because a value only
  React consults arrives after the browser has already painted. `visibility`
  rather than an unmount, so nothing shifts on reveal; no spinner, no cookie, no
  server-side language guess, `ThemeScript` untouched, and `/login` not gated.
  The page-level gate was **removed**, not kept alongside — the Settings entrance
  now reads the one boundary instead of owning a second.
- **Density reaches shared control clusters.** `--control-gap` and
  `--control-gap-tight` were hoisted onto `:root` as `calc()` over the existing
  `--gap`, so one derivation serves the Settings segments and seven app-wide
  clusters — the Students, Classes and Lessons filter pills and the Dashboard,
  Student-detail, Class-detail and Reviews action rows. Cozy still resolves to
  the design's own 8px and 6px, so the default workspace is pixel-identical and
  only airy and tight move. **The header was audited and deliberately excluded**,
  for reasons recorded in `header.tsx`: it cannot wrap and its intrinsic minimum
  is the document's own, no derived token resolves to its imported 14px at cozy,
  and it is shell chrome rather than page rhythm. The Reviews composer action
  rows were excepted too — Sprint 8 width-audited them against a fixed budget.
- **Form-control hover joined the accent system.** The shared bare-element rule
  and `.cs-trigger:hover` both resolved to `--muted-2` over the neutral
  `--hover` fill, which reads as flat black in the dark theme. Both now resolve
  through `--accent` / `--accent-soft`, so four accents times two themes are
  covered by tokens with no per-combination rule. A text field takes the accent
  **edge only and no fill** — a filled editable field reads as selected. Both
  gained `:not(:disabled)`, and an invalid field is now *strengthened*: the old
  `!important` grey used to override the drawers' inline error border on hover.
- **The shared ring became a keyboard ring.** `.ring:focus` → `.ring:focus-visible`.
  A `<button>` keeps focus after a click, so choosing an option with the mouse
  left the 3px ring stuck on it; a text input matches `:focus-visible` whenever
  it is focused however focus arrived, so no field lost anything. No
  `outline:none` was added and nothing is blurred in JavaScript.
- 23 tests added and the Gate 6.2 page-gate suite retargeted rather than kept.
  Each new guard was mutation-tested: reverting the ring, the hover token, the
  readiness attribute, one density cluster or the disabled guard each fails.

### Gate 1 — audit passed
- **The Settings state layer already existed before Sprint 11, and is production-used.**
  `SettingsProvider`, `createFormat`, the 761-key Vietnamese dictionary, the
  `[data-theme|data-accent|data-surface|data-spacing]` token sets and the
  `etlms.*` `localStorage` keys are read by **48 call sites** across every
  module. The Settings nav item already existed at `/settings`. What did **not**
  exist was the page: `/settings` rendered a four-line `ModulePlaceholder`.
- **No Settings backend exists or is needed.** No Settings API route, server
  action, Mongoose model, Zod schema, collection, index or cookie — verified, not
  assumed. Sprint 11 adds none of them.
- **Audit baseline, recorded so later gates are judged against what was there:**
  `main` at `b98b25a`, clean tree, `main == origin/main`, lint 0 errors,
  **2235/2235 tests passing**, production build green, `/settings` a placeholder.
- Three of the four appearance dimensions — accent, surface and density — were
  **fully styled but unreachable by any control**, as was the language switch.
  The header's theme toggle was the only preference a teacher could actually
  change.

### Contract — banked before any implementation
- **The Settings contract is agreed before any code**, as Billing's was in
  Sprint 9 and Reports' in Sprint 10, and is now written into
  `PROJECT_RULES.md` as a `## Settings` section. **No Settings implementation
  exists.**
- **Nine authorised settings and no others:** theme, accent, surface, density,
  interface language, date format, time format, currency and number format. A
  setting is authorised only where something in the shipped product already
  reads it — which is why no attendance, homework, finance, reports or class
  default appears here, and why Settings is not a home for arbitrary
  configuration.
- **Notifications are deferred in full.** The reference design carries a
  Notifications card and a bell dropdown, but the application has no notification
  source, builder, model, menu, unread count or read state, and the reserved
  `etlms.notifDismissed` / `etlms.notifRead` keys are read by nothing. Sprint 11
  builds no notification system and **draws no Notifications card at all — not
  even an inert one**. A "Mark all read" acting on nothing is a promise the app
  cannot keep. The unused keys stay untouched; Notifications gets its own sprint.
- **Currency is display-only and does not redefine Finance's source currency.**
  Stored tuition, fees, billing and every derived revenue figure stay **integer
  VND** in the database and in all arithmetic. `USD` changes rendering only,
  through the existing fixed demo conversion rate; no stored value is converted,
  rewritten or migrated, and no Finance logic, API or schema changes. Data-entry
  labels such as `Monthly fee (VND/month)` correctly keep saying VND.
- **Stored-value hardening is authorised and belongs to Settings.** Preferences
  read out of the browser are validated against the authorised enumerations and
  fall back to the existing defaults when invalid — no new key, no storage
  migration, no schema migration, no API, and no behavioural change for values
  that were already valid.
- **`vi` remains the default language and `English` becomes reachable**, using
  the existing source-string fallback. No second dictionary is added.
- **Device-local persistence, and no Save button.** The existing `localStorage`
  keys and the existing `SettingsProvider` setters are the whole persistence
  model. No database write, server action, Settings API route, Settings model,
  User preference field, cookie change, JWT change or auth-flow change — which
  also means **no production DDL and no new dependency**.
- **One source of truth.** Every control reads its selected state from
  `useSettings()`; the page keeps no `useState` copy of a preference and touches
  `localStorage` directly nowhere. The header theme toggle and the Settings theme
  control therefore stay synchronised by construction rather than by an effect.
- **The Workspace card is read-only** — account name, email, current currency and
  the application day. No name or email editing, avatar, roles, password change,
  auth-provider settings or session management. Identity reaches the client
  component from a server-owned boundary; client code does not fetch the session
  a second time.
- **One page, no tabs:** heading, Appearance, Language & Region, Workspace. No
  navigation change and no sidebar change — the nav item already exists.
- **Design fidelity anchors banked** from the reference design: `760px` content
  column; card padding `20px 22px` with `16px` bottom spacing on the existing
  `--card`/`--border`/`--r`/`--sh` shell; `24px`/`600`/`-.02em` heading; accent
  swatches four across at `10px` gap; the Surface+Density and regional sub-grids
  targeting `520px` and `560px`.
- **Mobile must not overflow horizontally**, and the responsive rules must not be
  ones that lose to an inline `grid-template-columns` — a dead-rule failure this
  repository has already shipped more than once, across Sprint 10 gates 6.1, 6.2
  and 7.2.
- **Presentation may change downstream; meaning may not.** Stored monetary
  values, Finance calculations, Reports selection and arithmetic, Reviews data,
  Attendance and Homework semantics, the Classes model, Student/Parent data and
  application-clock semantics are all preserved. No configurable timezone, no
  configurable app clock, no report-branding setting, no school/organisation
  setting, no module defaults.
- **One test reversal is authorised in advance.** `tests/reports-ui.test.ts`
  asserts the Settings route still contains `ModulePlaceholder`. The gate that
  replaces the page must invert that assertion in the same commit; that failure
  is expected and is **not** a regression.
- **Not implemented, not deployed.** This entry records a contract only.

## Unreleased — Reports (Sprint 10) — **shipped, Production verified, CLOSED**

### Contract — banked before any implementation
- **Gate 1 discovery passed.** At that point `/reports` was a four-line module
  placeholder; there was no Report model, stored report entity, Reports API
  route, DTO, export or Reports test suite anywhere in the repository, and
  production held no reports collection. Recorded so a later gate is judged
  against what was actually there.
- **The Reports contract was agreed before any code**, as Billing's was in
  Sprint 9, and is now written into `PROJECT_RULES.md` as a `## Reports`
  section. **No Reports implementation exists.**
- **Five authorised report types, and no others:** Monthly Revenue Report, Class
  Revenue Report, Student Payment Report, Attendance Summary, Homework Summary.
  Reports owns presentation and composition only — it calls the helper that owns
  each figure and duplicates no arithmetic.
- **`Performance Summary` is excluded** to avoid duplicating Sprint 8. A
  field-by-field audit found nothing it could own that the **Reviews-owned
  Monthly Progress Report** does not already own: the same ten ratings, the same
  average, the same attendance and homework figures, the same month, and the
  same preview/print/PDF. A sixth type would have been the same report twice,
  differing only in layout. An unused i18n string is not an authorisation.
- **Generated, never stored.** No Report model, id, status, lifecycle, saved
  history or cached document. Previewing, printing and exporting perform zero
  database writes. `Generated on` is ephemeral document metadata taken from the
  application day and creates no persisted timestamp — the rule Reviews already
  holds its own report to.
- **Month ownership stays with the owning domain, per report type:** revenue by
  `Lesson.date`, Student Payment by `Billing.month`, Attendance by the Lesson
  (never `AttendanceRecord.date`), Homework by the assignment's due date.
  Reports introduces no third interpretation of a month, `paidDate` never
  replaces `Billing.month`, and the reporting window is the server-owned twelve
  months ending at the application month — never the seed's `FINANCE_MONTHS`.
- **Billing and Revenue are never mixed in one report body.** They may both
  appear in the Reports selector as separate types, but a single sheet with one
  masthead and one table cannot say which definition a number belongs to.
  Sprint 9's semantics carry unchanged: no guessed partial amount, `unknownAmount`
  is a fee and not a payment, an incomplete collection rate stays a floor, and
  stored anomalies such as `c6` are reported exactly as stored.
- **Ghost handling stays owner-domain-specific**, and **Reports never invents a
  count**: it may surface a neutral hidden-record count a domain already supplies
  (Billing's `hiddenRecords`), and where a domain supplies none it shows none.
  No cross-domain ghost algorithm exists, because one filter applied across every
  domain would silently move figures in at least one of them.
- **Reports are teacher-facing analytical documents** — no salutation, recipient,
  address, signature, send action or notification. A missing Parent never blocks
  generation. **The Student Payment Report alone carries the missing-parent
  indication**, reusing Finance's existing `parentLinked` boolean and its
  `No linked parent` line; no parent name, phone, email or address is carried
  anywhere in Reports. `Student & Parents` gained one clarifying paragraph
  recording that the rule requires an indication where linkage is relevant, not
  that every named feature becomes parent-facing.
- **Export PDF and Print are authorised for Sprint 10.** PDF is client-side, A4
  portrait, Unicode-safe with a loud failure if the font cannot load, and is
  never persisted. Print gets its **own** isolated Reports scope — the Reviews
  print path is not borrowed, extended or altered, and the CSS block removed in
  Gate 4.4E is not restored.
- **Excel is deferred** to its own export gate: nothing is ported from
  `design-reference/lib/etlms-export.js`, no CSV is substituted, and **no
  disabled Excel control is drawn**. The action row therefore carries two
  controls where the design draws three — an accepted, recorded divergence.
  **CSV is out of scope.**
- **Responsive stacking below 768px is explicitly approved** as a minimal
  design-reference divergence: the design's fixed 300px options rail leaves
  roughly fifty pixels for the document on a phone. The rail stacks above the
  preview at full width, sticky is dropped where it would collide with the app
  header, and a wide table may scroll inside its own bounded container — the page
  never scrolls horizontally, and neither PDF nor Print may depend on that
  scroller. No other screen's responsive behaviour changes.
- **The contract commit implemented nothing** — no UI, no `/api/reports`, no read
  model, no DTO, no PDF or Print code, no tests, no schema change, no index, no
  production write and no DDL. Everything below was built against it afterwards.

### Implementation
- **Reports read model and `GET /api/reports`.** A pure composition module,
  `src/lib/reports.ts`, plus a server service and one route. Not one figure is
  computed there: revenue is `computeRevenue`, attendance is
  `studentAttendanceRate`, homework is `homeworkCompletion` and
  `studentHomeworkCompletion`, and Billing rows come from `buildBillingBranch`.
  Reports composes; the owning domain answers.
- **The Reports workspace** — the options rail, the scope controls and the live
  document sheet — with **all five authorised report types**. A scope a report
  does not use is disabled showing its sentinel rather than hidden, so the
  designed layout does not change because a filter does not apply.
- **The preview is derived; there is no Generate button.** A valid selection
  produces the document automatically and an incomplete one shows the design's
  own empty state.
- **Export PDF** — client-side, A4 portrait, Unicode font, loud failure if the
  font cannot load, nothing persisted and no server file URL — and **Print**, on
  its own isolated Reports scope that does not touch the Reviews print path. One
  content model feeds screen, Print and PDF, so a report cannot say one thing on
  paper and another on screen.
- **A stale-action guard.** `keepPreviousData` keeps the previous report on
  screen while the next loads, which is right for the screen and wrong for a
  file. Export and Print therefore wait for the current selection to resolve, and
  both handlers re-read the condition, so a keyboard or programmatic call cannot
  walk past a disabled button into a stale export or a stale print dialog.
- **Responsive stacking now keys on available Reports width, not the viewport.**
  The approved boundary is unchanged and merely restated in the terms it always
  meant: 767px of viewport beside a 64px rail is 667px of content, so a
  screen-only container query at 667px reproduces every previously approved case
  and additionally catches the ones a viewport number could not see — a 768px or
  860px viewport with the sidebar expanded. The container is declared inside
  `@media screen` so the verified printed document cannot be reached by it.

### Fixes found by human verification
- **Student Payment PDF layout** — metric card arrangement and accent divider
  corrected; table readability improved. Values and semantics unchanged.
- **Student Payment Print** — the Reports page title and subtitle no longer leak
  into the printed sheet, and the metric hierarchy and arrangement were
  corrected. No page chrome reaches the document.
- **Four responsive sidebar defects that pre-date Sprint 10 and were not
  introduced by Reports**: a dead tablet label selector, collapsed-state leakage
  into the mobile drawer, a no-op tablet expansion toggle, and an expand
  animation that snapped in one direction because an untransitioned `min-width`
  sat beside an animating `width`. Fixed here because Reports verification is
  what exposed them.
- **Reports/shell coordination** — the container query above, so Reports reacts
  to its own width in the same layout pass rather than lagging the sidebar's
  animation.

### Verification
- **Human browser verification PASS**: responsive Reports and sidebar
  coordination, mobile drawer, **Student Payment PDF PASS**, **Student Payment
  Print PASS**. No remaining visual blocker.
- **Zero production writes.** The Finance, Reviews and Homework integrity probes
  reproduce their accepted states before the merge, and again after Production
  deployment: Billing 84 / `b3e2fb7a…`, Reviews 33 / `c4418428…`, Homework 15 /
  `aef736e9…5741f`. No schema change, no index and no DDL in this sprint.
- **Production verified.** `main` fast-forwarded to `fb034be` and deployed; the
  Reports CSS and JavaScript chunks served by Production are **byte-identical**
  to those built locally from that commit.
- Engineering baseline: 2217 tests, 350 suites, 0 failures, typecheck clean,
  lint 0 errors / 8 pre-existing warnings, 51 routes.

### Known limitation, accepted
- **An all-`Assigned` month reports the Homework domain's own numeric zero.**
  `Assigned` is excluded from the completion measure entirely, so such a month
  has an empty denominator — but Homework publishes no denominator on its
  aggregate, and manufacturing one in Reports to turn that 0 into `No data`
  would be Reports correcting an owner domain on read. Per student the domain
  does say `null`, and those rows carry it. No misleading denominator copy is
  attached.

### Post-merge fix — Gate 7.1
- **Desktop rail-to-preview spacing was visually too large on Production.** Found
  after the merge, during Production verification.
- **The gap token was never the cause.** `.rp-grid` uses `gap:var(--gap)` — 16px —
  and still does. The defect was the shared `.report-sheet` rule's `margin:0 auto`
  centring a 760px document inside a preview track that takes ALL the remaining
  width: the gutter is half the spare room, so it grew with the viewport —
  16px of separation at 1100, 54px at 1280, 134px at 1440, and a 146px plateau
  once `.app-main`'s own 1400px cap stopped the track growing.
- **Fix: the Reports sheet is start-aligned in its track**
  (`.rp-sheet{margin-inline:0 auto}`), so the rail-to-document distance is the
  gap and nothing else at every desktop width, and the spare room falls outside
  the document where a page normally leaves it. Three executable lines.
- **Nothing else moved.** `margin-inline` only, so the shared rule keeps owning
  the vertical margin and the **Reviews** composer sheet stays centred. Scoped to
  `@media screen`, so the verified **PDF and Print** output cannot be reached.
  The 667px container threshold, the stacking rule, the 300px rail, the 760px cap
  and the sidebar behaviour are all untouched — and the fix is inert when stacked,
  because a track of at most 667px is already below the 760px cap.

### Post-merge fix — Gate 7.2
- **The workspace was left-biased on an ultra-wide screen.** Gate 7.1 was right to
  stop the sheet centring itself, but it left every spare pixel on ONE side. With
  the 248px desktop sidebar and `.app-main`'s 1400px cap the spare room ran 0px at
  1280, 52px at 1440, 212px at 1600 and a 260px plateau past 1720 — all of it to
  the right of the document. 1280 and 1440 were approved; 1600+ was not.
- **Fix: bound the preview track and let the grid place itself.** The track stops
  at the 760px the document was never going to exceed, so the two tracks add up to
  a real workspace — 300 + gap + 760 — and `justify-content:center` has something
  to centre. Free space falls OUTSIDE the pair rather than between them.
- **No threshold, and no breakpoint.** `justify-content` does nothing while the
  tracks fill their container and acts only once there is genuine spare room,
  which is exactly the condition meant. 1280 and 1366 are therefore untouched by
  construction rather than by a number somebody picked, and the density setting
  moves the whole thing for free.
- **The heading travels with it.** `.rp-page-head` takes the same bound and the
  same auto margins, because a title flush left above an indented workspace would
  be a new defect rather than a fix. The bound is stated once as
  `calc(300px + var(--gap) + 760px)`.
- **Gate 7.1 is kept, not reverted**: the sheet is still start-aligned, inert now
  that the track is bounded but still the guard if the cap ever moves. Screen-only,
  so PDF and Print are untouched; the 667px stacking threshold, the stacked rule,
  the rail width and the sidebar are all unchanged. Five executable lines.

### Final Production verification
- **Desktop workspace, human-verified on Production: 1280 PASS, 1440 PASS,
  1600+ PASS.** That closes the two post-merge fixes above.
- The final layout keeps the rail-to-report distance at `gap:var(--gap)` at every
  desktop width, centres the **whole** Reports workspace on an ultra-wide screen
  rather than centring the report sheet independently inside its track, preserves
  the tablet and mobile behaviour unchanged (the 667px container threshold and the
  stacked rule are byte-for-byte what Gate 6.4 shipped), and leaves **PDF and
  Print untouched** — every alignment rule is screen-scoped, and the Reports
  JavaScript bundles served by Production are byte-identical across both fixes.
- Everything verified earlier still stands: Reports smoke, responsive Reports and
  sidebar coordination, the mobile drawer, **Student Payment PDF**, **Student
  Payment Print**, the stale Export/Print guard, the three production integrity
  probes and the engineering baseline.

### Closure
- **Excel** remains deferred to its own export gate and did **not** ship; CSV
  stays out of scope; `Performance Summary` did **not** ship and the Monthly
  Progress Report stays Reviews-owned. Reports are generated and never stored.
- **Sprint 10 — Reports is closed.**

## Unreleased — Finance MVP (Sprint 9) — **Production deployed and verified**
- Billing contract, agreed before any code: the natural key is
  `(studentId, classId, month)` — 84/84 unique — and **not** `(studentId, month)`,
  because a student enrolled in two classes is legitimately billed twice in the
  same month. `Billing.fee` is a **historical snapshot**, not a cache of
  `Class.fee`: a class's fee has no history, so a bill has to carry the number it
  was raised for. That is a deliberate, documented exemption from CLAUDE.md's
  data-ownership rule rather than an oversight.
- **Two unrelated definitions of money, and PROJECT_RULES governs only one.**
  `billing` is tuition *asked for* — a flat 13,100,000đ a month — and `revenue`
  is money *earned by teaching*, lesson-derived and attendance-weighted (~25.5M a
  month). They have no join; a Billing record carries no `lessonId`. The comp
  already separates them, drawing a **dashed** "Lesson revenue · completed
  lessons · informational" tile beside the solid bill-derived ones, and the
  port enforces the separation in code names too: no bill-derived field, type or
  test is called `revenue`.
- `computeRevenue` rewritten to count **shares** rather than accumulate floats. A
  class-month is `fee × shares / regularScheduled`, rounded once, then split
  across regular / makeup / extra by largest remainder, so `Σ perClass === total`
  and `Σ byType === total` hold by construction. Verified against production:
  all six months reproduce their previously observed figures identically. The
  archived-student filter was removed as a real defect; it moved no production
  month, because the only Archived student is on no roster.
- `paidAmount?: number`, stored only on a `Partially Paid` bill. The nine legacy
  partials in production carry empty notes, so no amount is recoverable from
  them: their own cells read `Not recorded` and `Not determined`, never `0đ` and
  never an inferred 50%. The dead `calc.ts` `paidAmount` helper carrying that 50%
  rule was deleted along with the unused `Payment` type and `paymentSchema`.
  **Zero migration, zero backfill.**
- **Aggregates report confirmed money rather than refusing to report at all.**
  The first contract nulled a whole scope's collected and outstanding totals if
  any bill in it lacked a recorded amount. Production review overturned it: a
  month where 8,550,000đ had demonstrably been collected reported nothing,
  because one bill of 700,000đ was incomplete. A scope now carries
  `knownCollected`, `knownOutstanding`, `unknownAmount`, `unknownAmountBills`
  and `amountsComplete`, with
  `knownCollected + knownOutstanding + unknownAmount === billed` true by
  construction — `unknownAmount` being the *fee* of every unrecorded bill, which
  is neither a payment nor a debt. The proportion bar draws a third neutral
  segment for the gap; `x of y bills paid` counts bills settled in full, while a
  partial's money is already inside the collected figure. Ranking uses confirmed
  collected totals, so no class is exiled from the list for holding one
  incomplete bill. Still nothing inferred, and no stored document touched.
- **The collection rate is not rendered anywhere.** It was the money summary's
  fourth metric and earned its place least: a percentage of expected revenue is
  a report-card number rather than something a teacher acts on, and with one
  unrecorded partial it could not be stated plainly at all — it had to be shown
  as a floor ("At least 65%") with a sentence explaining the arithmetic beneath
  it. Two lines of qualification for a figure nobody uses, beside three they do.
  The summary is now a deliberate three across — **Collected, Outstanding and
  Partially paid**, the last a count of bills rather than an amount, because for
  the legacy records that amount is exactly what nobody wrote down (and it is
  drawn once: the duplicate tile that used to repeat the same count ten pixels
  below was removed, leaving Paid students, Unpaid students and Lesson revenue,
  with the odd dashed tile spanning the row rather than sitting beside a gap at
  620px) — plus the
  Unknown slice on a month that has one. `collectionRate` stays on the payload:
  it is correct, cheap and tested, and removing it from the domain to chase a UI
  decision would be churn in the service contract for no gain. Its copy
  ("At least {X}%", "Based on recorded payment amounts.", "of expected
  collected") is deleted from the helpers and the dictionary, because a label
  nothing renders is one a later edit rediscovers and reuses.
- **The month control takes its own full-width row below 620px.** The heading is
  a space-between row, so on a phone the title took the width it needed and the
  select kept its 150px floor in whatever was left — a desktop affordance shrunk
  rather than a mobile one, with the smallest tap target on the screen where the
  thumb reaches last. It is now a two-track grid, the select at `1fr` and the
  refresh button at `auto`, with the duplicated visible "Month" label hidden
  (the Select keeps the same `ariaLabel`). Layout only: same one Select, same
  server-supplied window, no browser clock. Desktop and tablet are untouched.
- Read service and API: `GET /api/finance?month=YYYY-MM` returns one month's
  billing and revenue branches plus the twelve-month window the selector offers.
  The window is the **server's** — no Finance file constructs a `Date`, reads a
  browser clock or derives a month. The read-model shaping lives in the pure
  `billing.ts`, not the service, so the ghost rule is provable without a database
  in the loop.
- `PATCH /api/finance/:billId` records a payment against one bill, rejects a
  future `paidDate`, and answers a ghost bill with the **same 404 a missing bill
  gets**, so the id space discloses nothing. It ships **without UI**: the comp
  has Record / Manage buttons but no payment form anywhere in it, and two of its
  three row actions cannot be honestly built without one. Implement the logic and
  the API, do not invent the UI.
- `/finance` screen, three tabs — **Overview**, **Revenue analytics**,
  **Payments** — replacing the module placeholder, plus the Class Detail
  **Revenue** card, which reads `/api/finance` sharing the same React Query key.
  Deliberately **not** `/api/dashboard`: that GET runs the lesson lifecycle and
  therefore writes, and opening a class page must not.
- Deviations from the comp, all agreed in advance: no **Method** column
  (`methodIcon` / `methodLabel` exist in the comp with no field behind them
  anywhere — model, production, rules or dictionary), no row actions, and no
  Overdue or Invoice concept. A class holding an incomplete bill is **ranked on
  the money it can prove and never on an assumed zero** — sorting it as 0 would
  put a class that has collected almost everything at the bottom of a list
  titled "highest-value" — and the row marks that figure as a floor rather than
  presenting it as a total.
- **Ghost bills — those whose student was deleted — are counted in every total
  and named in no list.** Both halves matter: a deletion must not move a closed
  month's figures, and a worklist of who owes money cannot contain somebody who
  is gone. No id, name, former parent or placeholder row reaches the client.
  "Live student" means the Student document **exists**, not that its status is
  Active: Trial, Paused and Archived students' bills are all payable.
- Gate 5.5 (human visual pass) changed **how that gap is presented, not what it
  means.** The comp's `+N more` was removed from all four surfaces: under an
  actionable list of students who owe money it read as a control — press it and
  see four more people to chase — and there are no more people to show. The fact
  is now a sentence, in the two places where a total is genuinely larger than the
  rows beneath it: "*{N} historical payment records no longer have student
  information.*" / "*Có {N} khoản thu lịch sử không còn thông tin học sinh.*",
  on the month's money summary and in a class's expanded student detail. It is a
  muted, inert caption — no handler, no cursor, no underline — and it carries a
  count and nothing else. Outstanding students, the Payments table and the
  Top-performing ranking card disclose nothing at all.
- Gate 5.5 also restacked the three panels a phone cannot hold in a row —
  Outstanding students, Top performing classes and Revenue by class — in
  Finance's **only** stylesheet: one block at the app's existing 620px
  breakpoint, styling only `.fin-` hooks, with every other width left as the
  comp's own inline values. Tablet and desktop are untouched by it. Exactly three
  regions scroll horizontally — the tab strip, the Payments table and the
  expanded per-student grid — and the page itself never does; no
  `overflow-x: hidden` conceals anything. Human verification **passed** at ≥1100,
  768–860, ≤620 and 375, on Preview at `206084f` and again on Production.
- **`c6` is rendered honestly rather than repaired.** The class stores
  `fee: 18,000,000` while its own six bills store `1,800,000`, exactly ten times
  smaller, and it is 62–71% of every month's reported revenue. Stored values are
  displayed exactly as stored; there is no normalisation in a formatter or
  anywhere else, and the remediation is a separate authorised change.
- **Rollout: merged to `main` and deployed to Vercel Production.** `main` was
  fast-forwarded to `206084f`, preserving all fifteen Sprint 9 commits with no
  squash and no history rewrite, and Vercel deployed it to **Production**
  (`teacher-lms-lake.vercel.app`) at exactly that SHA. Production was then driven
  **read-only** — a write-free login, the Finance screen, its stylesheet and
  bundle, and `GET /api/finance` for all twelve offered months. The served CSS
  carries the 620px Finance block; the served bundle carries the new copy and no
  longer contains the removed disclosure hook; every payload named only live
  students, leaked no ghost identity, and reported the expected 4 hidden records
  a month over the six billed months.
- **No production Billing document was created, edited or deleted at any point in
  Sprint 9**, rollout and verification included, and
  **`PATCH /api/finance/:billId` was never invoked against Production.** The
  baseline reproduces exactly either side of the deployment: `billings` at 84 /
  `b3e2fb7ae5dd0cc1baac3c4f62c7459bfa62292b839970a84703a8e02d9ca6ca`, statuses
  70 / 9 / 5, 24 ghost bills over 4 deleted students, 0 duplicate
  `(studentId, classId, month)` groups, 9 partials without an amount and 6
  historical future `paidDate` values. Reviews (33 /
  `c4418428f5d247b7c58caf046ce09c6e71f24dd30caab3bc86d4032a5fa8c4d5`) and
  Homework (15 /
  `aef736e9931fac3350c6b7a9a2d17834ca3f22566792f952183fc7ed9e85741f`) are
  untouched.
- **No DDL, and no Billing index — by decision.** The natural key is documented
  and observationally validated (0 duplicates in 84 documents), but no unique
  index was created and **none is declared in `models.ts`**: a declaration would
  make mongoose's default `autoIndex` build it on the deployment's first model
  use, which is production DDL and needs its own authorised migration gate. The
  production index inventory is unchanged at exactly `_id_`, `id_1`,
  `studentId_1`, `classId_1` and `month_1` — **0 indexes created, dropped or
  changed at deploy**. Deferred technical hardening, not a blocker.
- The Finance integrity probe's accepted baseline stays **`null`** deliberately.
  Sprint 9 shipped code capable of a Billing write but performed none, so the
  probe keeps reproducing the pre-implementation observation rather than
  "accepting" the collection merely because a deployment succeeded. A baseline is
  banked after an authorised, attributable write — not after a rollout.
- Still deferred, and not pretended otherwise: revenue for deleted or unenrolled
  students (rosters are current-only and no enrolment history exists to derive it
  from), the six historical future `paidDate` values (preserved; new writes
  reject a future date), the nine legacy partials without an amount, the
  `Student.balance` inconsistency on the Students surface, the Billing natural-key
  index, any monthly Billing generator (so a future month can legitimately return
  no bills), the payment UI, the Student Profile Finance tab, and Finance
  reports / export. Each waits on a design or on its own authorised change.
- **Rollout complete: merged to `main` and deployed to Vercel Production at
  `e3e757c`.** The human responsive pass — ≥1100, 768–860, ≤620 and 375 — was
  taken on the hosted **Preview** at that exact SHA, which `main` was then
  fast-forwarded to, so Production runs the same commit and the same bytes.
  Production was additionally read back **programmatically**: the served
  stylesheet carries the 620px Finance block and the new tile and header rules,
  the served bundle carries the current copy and none of the four removed
  affordances (`+N more`, `Insufficient data`, the collection rate, the
  duplicate Partially paid tile), and all twelve months' payloads satisfy
  `knownCollected + knownOutstanding + unknownAmount === billed` while naming
  only live students. The two kinds of evidence are recorded separately rather
  than one standing in for the other.
- **No production Billing document was created, edited or deleted at any point
  in Sprint 9** — implementation, four review rounds, rollout and verification
  included — and `PATCH /api/finance/:billId` was **never invoked against
  Production**. No DDL ran and no index changed: the inventory is still exactly
  `_id_`, `id_1`, `studentId_1`, `classId_1`, `month_1`, and mongoose's
  `autoIndex` was a no-op again because no Billing index is declared. The three
  baselines reproduce identically either side of the deployment. The Finance
  integrity probe's accepted baseline stays `null` deliberately: nothing was
  written, so there is nothing to accept.
- **Sprint 9 — Finance is closed.**

## Unreleased — Reviews MVP (Sprint 8) — **hosted Preview verified**
- Reviews domain and validation: a Review is one student's month — ten skill
  ratings (integers 1–5, ten canonical dimensions, no eleventh) and five text
  fields. No `classId`, no `lessonId`, no status, no timestamps, no stored
  average. The month is always the teacher's explicit statement; the server
  never substitutes the current one.
- Create is allowed for **Active, Trial and Paused** students only. This is a
  deliberate divergence from Attendance and Homework, neither of which consults
  student status: a review is an assessment authored *about* a person, and an
  Archived student has been filed away. The gate applies to Create alone — an
  Archived student's existing reviews stay visible and editable.
- Twelve selectable months, ending at the application month. A future month has
  not been taught yet; a month twelve or more back would be an invented record
  rather than a correction. A month already reviewed stays visible in the list,
  marked taken, rather than disappearing from it.
- At least one of comment / strengths / improvements / goals must be written.
  `parentNotes` does not satisfy it: a review carrying only a message to the
  family has recorded no assessment.
- Edits may touch the ten ratings and the five text fields and nothing else.
  `id`, `studentId` and `month` are structurally impossible to send — the patch
  is built from an allow-list, not filtered from the request. There is **no
  Delete**: no endpoint exists that could remove a review.
- Service and API: `GET /api/reviews`, `POST /api/reviews`,
  `PATCH /api/reviews/:id` and `GET /api/reviews/student/:studentId`, each behind
  the session. No `GET /api/reviews/:id` — that route would be the one place a
  ghost review could be looked up by id.
- Ghost reviews (whose student no longer exists) are preserved, never listed,
  never counted into a card, and refused with the **same** answer a missing
  review gets, so the id space discloses nothing.
- `/reviews` index: one card per reviewable student — including students with no
  review at all, which is the point of a screen whose primary action is to write
  one. Archived students are omitted, an absent assessment is never drawn as
  `0.0`, and the score shown is the latest review's alone.
- Write / Edit review: the ten rating rows and the five text fields, with the
  month a control on a create and immutable context on an edit. (Originally a
  drawer; replaced by the dedicated composer below, and the drawer removed.)
- Student Profile **Reviews** tab: the recovered empty state, the "Learning
  analytics" header, the newest-first monthly timeline with Quick view and Edit,
  and a strengths / focus areas card ranked from the latest review only.
  `?tab=Reviews` deep-links to it.
- Shared responsive remediation carried over from Gate 4.3: the header now
  states its own breakpoints (1100px and 768px) instead of borrowing the
  drawer's 620px, which is what caused a full desktop row to reappear at 621px.
  `html { overscroll-behavior: none }` and unconditional drawer containment
  replace the elastic viewport drag. No `overflow-x: hidden` conceals anything.
- Dirty-dismiss protection: Cancel, the X, the scrim and Escape all route through
  one guard in the shared drawer, so a mis-tapped scrim can no longer discard
  typed work. A pristine form closes silently, a reverted form is pristine again,
  and a successful save bypasses the prompt. The composer applies the same rule
  to its own three exits — Back, a Create month change and Cancel editing — with
  one confirmation between them, plus the browser's own prompt on refresh.
- Responsive action ownership in the composer: the Review actions live in exactly
  one of two regions, switched as a complementary pair at 620px, so no width can
  show both. This replaced per-button hide rules that never took effect — the
  buttons carry `display` as an inline style, which outranks any stylesheet rule
  that is not `!important`, so a Save and an Edit were being offered twice at
  once on a phone.
- Global Search remains **deferred** until the core modules are complete. Gate
  4.3 built the seam only: the header field, its icon button and ⌘K all call one
  `openSearch`, which forwards to an optional prop nothing supplies. There is no
  search endpoint and no palette.
- Sprint 8 translations: fifteen Reviews strings the earlier gates reported
  rather than added are now in `i18n-vi.json` — the three missing performance
  labels, the profile subtitle, the two client failure sentences, four
  `REVIEW_ERROR` sentences and the five Reviews schema messages. "Invalid input"
  is deliberately left untranslated: it is the generic parse fallback shared by
  every module's routes, not a Reviews string. That count is the FIRST batch
  only; the later composer, report and PDF gates added strings of their own on
  top of it. Across the whole branch `i18n-vi.json` gains **39 keys and loses
  2** — net 37 — the two removals being `Best skill` and `Weakest skill`,
  dropped when the teacher summary became tie-aware.
- `npm run reviews:integrity` — a read-only production check (count, digest,
  month histogram, resolvable vs ghost, duplicate `(studentId, month)` pairs).
  It runs **observationally**: no accepted baseline is banked, because no
  authorised production write has happened.
- **Dedicated Review composer** (`/reviews/new?studentId=…` and
  `/reviews/{reviewId}`): one full-page surface for Create, View and Edit, with
  the generated monthly report rendered live beside the form. The edit address
  names the review and never the student, so a URL cannot disagree with the
  record about whose it is.
- **View / Edit stages.** A saved review opens as something to read — the values,
  the report, no save control — and becomes editable only when the teacher says
  so. The stage is screen state: never persisted, never sent, never read back,
  and there is no `/edit` route. Reviews still have no lifecycle.
- **Month selector, with three jobs and one control.** Create chooses the month
  from the twelve-month window, View navigates between a student's reviews, and
  Edit disables the trigger entirely — a teacher editing June must not be able to
  pick May and lose the edit. A month already reviewed stays listed and marked
  taken rather than disappearing.
- **Cross-month isolation fix.** Both composer routes are keyed on the record
  they show and the component re-seeds on the record's identity, so navigating
  between two of a student's reviews can no longer leave the previous month's
  ratings in the form under the new month's header. The save target is read from
  the same object the form was seeded from.
- **Live report preview** — one `MonthlyReviewReport` derived from the ratings
  and words currently on screen, plus the server's per-month attendance and
  homework. Nothing about it is stored.
- **Print and Export PDF**, from every stage including an unsaved Create and a
  dirty Edit. Both act on the draft: neither saves, neither clears dirty state,
  and neither needs a save first. Print unwraps the report overlay through the
  app's print stylesheet (A4, 12mm margins, app chrome and interactive controls
  excluded); Export PDF draws the same report DTO with jsPDF over an embedded
  Unicode font so Vietnamese renders correctly, and downloads
  `monthly-review-{student-slug}-{YYYY-MM}.pdf` — a name that carries no Review
  id. Both are client-side and read-only: no API route, no cache write, no
  Review write. A failed font load surfaces an error rather than shipping a PDF
  with mangled names.
- **Skill-bar colour is per rating, everywhere.** A bar used to take the
  report's overall performance band, so ten skills printed in one colour and the
  colour said nothing. Each bar now takes `perfColor` of its own rating — the
  same function, on the same 1–5 scale, that the drawer's rating control already
  applies — so a Listening of 5 and a Writing of 2 are visibly different in the
  rating control, the live preview, the printed page and the downloaded file.
  The colour is derived **once**, on the report DTO; the sheet, the PDF document
  model and the jsPDF renderer each carry it without re-grading anything, and one
  token-resolution helper turns the CSS token into PDF ink. Whole ratings reach
  three of the four bands — 1 and 2 share the lowest by `perfColor`'s existing
  thresholds, and amber (2.2–2.99) is unreachable from an integer — which is
  stated rather than papered over with a second set of per-bar thresholds.
- **The teacher summary names every tied skill, and never invents a winner.**
  It used to answer with one "Best skill" and one "Weakest skill", each the head
  of a canonical ranking: given Listening, Speaking and Reading all at 4 and
  Writing and Grammar both at 3, it told a family that Listening was the best and
  Writing the weakest. Both claims were false and both were deterministic. The
  analytics helper now returns **every** skill at the highest rating and **every**
  skill at the lowest, in canonical display order, under **Strongest skill(s)**
  and **Focus area(s)** — the word "weakest" is gone from the product. When all
  ten ratings are equal it renders one neutral structured row (`Skill ratings` /
  `All skills · 3/5`) instead of claiming all ten are both the best and the worst;
  no sentence is generated for it. **Biggest improvement** is unchanged: one
  strictly positive delta against the previous review. The three surfaces —
  composer card, report sheet, exported PDF — render one shared line builder, so
  none of them can apply a different tie rule; in the file the value wraps rather
  than being cut off with an ellipsis. The Student Profile's Top 3 / Bottom 3
  card is unchanged: it is an explicitly ranked list, not a claim about a winner.
- **The exported PDF composes like the preview.** Skill bars and the radar share
  one horizontal band — bars left, radar right — inside the A4 margins, treated
  as a single block that moves to the next page whole rather than splitting the
  radar away from the bars. Strengths and Areas for improvement stay a paired
  row, the three summary tiles stay one row, and goals stays full width.
- **Print height budget, and an honest limit.** A short report was spilling onto
  a nearly empty second page: measured against the sheet's own metrics, a short
  report with a fuller comment came to 1031px inside a 1032px A4 box, and
  `break-inside: avoid` then threw an entire block plus the footer onto page two.
  The print-only rules give back the sheet's screen padding (`@page` already
  provides a margin) and tighten the gaps *between* blocks and bar rows, taking
  the same report to roughly 954px — about 20mm of headroom. No section is
  removed, no type scale changes, and long reports still paginate.
  **What the app cannot do:** the URL, date, page number and site name at the
  edges of a print preview are the **browser's own** headers and footers, drawn
  outside the page box. No stylesheet or script can remove or reposition them —
  only the person printing can, via the print dialog's "Headers and footers"
  option. Nothing in this codebase pretends otherwise or models those strings as
  report content; the app's responsibility is keeping the document itself inside
  a sensible A4 budget, which is what the numbers above are about.
- The preview overlay's **Close is icon-only** at every width it can appear at —
  the × with an `aria-label`, giving the report title back the width the word was
  taking. Print and Export PDF keep their labels, because those name a decision.
- **The teacher summary is a block of cards, not three lines of text.** It said
  the right thing and was still hard to read: three `label ……… value` rows with
  the value pushed right, which worked for "Reading · 5" and collapsed into a
  wall of names the moment a tie listed eight skills — worst on a phone, and on a
  sheet a family is meant to read. Each item now owns a card: the label and the
  rating on one line, the skill names wrapping beneath them with the card's full
  width. The report sheet lays the cards out in the grid idiom it already uses
  (`repeat(auto-fit,minmax(min(210px,100%),1fr))`), so they are a row on a page
  and on a desktop, two across on a tablet and one per row on a phone, with no
  breakpoint of their own; the composer's card stacks the same item at every
  width; the PDF draws the same cards side by side inside the A4 margins. The
  shared line builder now hands each surface the *parts* — label, the skill names
  as a list, the figure they share, and which of the app's existing colour tokens
  the item is keyed to — so no surface joins them into a string it would then
  have to shorten. **Nothing is ever truncated:** a card grows downward and the
  row takes the tallest card's height. The semantics are untouched — tie-aware
  strongest and focus sets, the all-equal neutral state, one strictly positive
  biggest improvement.
- **The exported PDF's radar reads as a chart again.** The fill was
  arithmetically the screen's 20% green over white and still looked like a solid
  shape, because what makes the on-screen version read as a chart is not the
  alpha value but that the rings and spokes stay visible *through* it — and an
  opaque fill, however pale, buries them. jsPDF cannot do CSS alpha here (a
  translucent fill needs a graphics state this renderer has no other use for) so
  the translucency is approximated two ways: a lighter tint (12% green over
  white) and an inverted draw order — the tint goes down first, then the web and
  spokes on top of it, then the outline, then the vertex dots. The outline keeps
  its full-strength green at 0.6mm, so the month's shape is if anything more
  legible; only the interior got quieter.
- **The printed footer sits at the bottom of a short page.** The sheet becomes a
  flex column with a minimum height in print and the footer takes
  `margin-top: auto`, so leftover space collects above it. Deliberately *not*
  `position: fixed`, which would repeat the footer on every page without
  reserving space and let page two draw content underneath it; nothing is taken
  out of flow, so nothing can overlap or clip, and a long report paginates
  exactly as before. The minimum is 250mm rather than the full 273mm box on
  purpose: a floor equal to the box is the blank-page-2 defect inverted — any
  user agent giving a millimetre less would push the sheet past one page by
  itself and strand the footer alone on page two.
- **Report hierarchy.** The section order was already the intended one and is
  unchanged (identity → the three figures → skills with bars and radar → teacher
  summary → comment → strengths and areas → goals → parent notes → footer), and a
  test now pins that order across all three surfaces. What changed is rhythm and
  separation: every block carries the same 22px gap instead of an unexplained
  20/22/24 mix, and each section title carries a one-pixel rule in the sheet's own
  `--border`, so a reader scanning a printed page finds section boundaries by
  something other than font size.
- **Section dividers, in every document.** The sheet ruled each section title and
  the exported file did not, so the same report had visible section boundaries on
  paper and none in the PDF. One presentation constant, `REPORT_SECTION`, now owns
  that decision for all three surfaces: a rule under every top-level section title
  — Skill ratings, Teacher summary, Teacher comment, Parent notes — in the report
  sheet's own `--border` token, resolved to CSS by the browser and to ink by the
  renderer's single token helper. No PDF-only line colour, and no second list of
  sections to keep in step: the document model's `heading` blocks already *are*
  the top-level boundaries. Internal labels (Strengths, Areas for improvement, the
  goals title) are not ruled in either document, matching the screen.
- **The printed report footer now actually reaches the bottom of a short page.**
  The previous attempt was a `min-height: 250mm` floor with `margin-top: auto` on
  the footer. The mechanism was right and the constant made it inert: 250mm is
  945px, and the audit measures a fuller short report at ~957px and the sparsest
  at ~797px — so for every report but the sparsest the floor sat *below* the
  content, there was no free space, `auto` resolved to zero, and the footer sat
  where the content ended. The cascade was never at fault: nothing in the printed
  DOM (`.review-overlay`, `.report-body`, `.report-scroll` — all auto-height,
  visible overflow) constrains the sheet. The floor now tracks the real page
  instead of guessing it: `min-height: calc(100vh - 4mm)`, because in paged media
  the viewport *is* the page area, so it adapts to whatever height the browser
  actually gives a page. The 4mm is a rounding guard — a floor equal to the page
  box is the blank-page-2 defect inverted.
- **Print spacing is a scale, not a squeeze.** The first budget pass flattened
  every gap to 11px, which made a section boundary barely wider than the rows
  inside a section and narrower than the gap under a heading; nothing read as
  separated from anything. There are three steps now — 16px between major
  sections, 8px from a heading to its content, 6–10px inside a group — and the
  *ordering* is what the tests pin, so the scale can be retuned but not flattened.
  The space came from a low-value reclaim rather than from the rhythm: the four
  student-meta cells were laid out three to a row by the sheet's auto-fit grid, so
  a printed page carried two rows for four short values; on A4 they fit in one,
  which returns more than the whole rhythm increase cost. No type scale changed,
  and a fuller short report still measures ~957px of the 1032px A4 box.
- The exported PDF's own gaps were normalised to one named rhythm at the same
  time (they had drifted to 3mm after the meta block and 6mm after the tiles), so
  the two documents now have a visibly equivalent hierarchy without being
  pixel-identical — which they cannot be, and should not try to be.
- **The report footer repeats on every printed page.** The exported PDF has
  always drawn its footer at the bottom of every page; print now does the same, so
  a two-page review is two finished pages rather than one page and an orphan.
  `.rp-foot` is `position: fixed` inside `@media print` only — a fixed element is
  laid out against the page area in paged media and painted on every page, which
  is the repeat, and which no in-flow technique gives without restructuring the
  document into a table. **The space is reserved, which is the half that matters:**
  `@page` carries a 21mm bottom margin against 12mm elsewhere, so the extra 9mm is
  the footer's and content cannot enter it on *any* page — something an in-flow
  `padding-bottom` cannot do, because padding applies only to a box's last
  fragment. The 9mm is measured, not guessed: the footer is a 1px rule, 6px of
  padding and one 11px line — 5.4mm — placed so ~10px of clear air sits between
  the last line of content and the rule. It is out of flow, so it cannot add a
  page of its own. The previous end-of-document strategy (a flex column with a
  `min-height` floor and `margin-top: auto`) is **removed**: two footer models
  competing for one element is how a document ends up with neither.
- **Print spacing now follows the file.** The downloaded PDF is the approved
  baseline, so print's rhythm is derived from the renderer's own scale rather than
  from whatever fitted: 20px between major sections (the file's 4.5mm is 17px),
  10px from a heading to its content (the file's 2.8mm is 10.6px), 6–10px inside a
  group. The previous 11 / 8 / 8 is what made print read as crowded beside the
  file — a major boundary was barely wider than the rows inside a section. Page
  count is no longer the first priority: a minimal short review fits one page with
  room to spare, a fuller one sits at the fold and may take two, and the repeated
  footer makes that a finished document rather than a spill.
- **The printed radar is sized against the file.** The PDF splits the skills row
  56/44 and draws a 52mm web; print's auto-fit grid split it 50/50 and capped the
  radar at 168px, whose web is 32mm — under two thirds — so beside the PDF it read
  as a decoration rather than a chart. Print now uses the same 56/44 split and a
  224px cap, giving a 42mm web. The cap is what it is because the ten axis labels
  are HTML text at their own size: larger, and they start crossing the bar
  column's rating numbers. The screen preview is untouched.
- **The exported PDF's radar web is visible.** All fifteen paths were always being
  emitted, in the right place and the right order — they were drawn in the
  *screen's* hairline tokens, and on white paper under the 12% green tint
  `--border-2` differs from what it crosses by **0.4 of relative luminance**. That
  is not faint, it is the same colour; channel by channel the ring was +12 red,
  −5 green, +8 blue against the fill, so inside the polygon the rings were if
  anything lighter than their background. The rings and spokes now take the sheet's
  own `--muted-2`, resolved through the same token helper every other PDF colour
  uses, at *finer* weights than before (0.18mm and 0.15mm against the invisible
  version's 0.25mm). The series outline stays dominant three ways over — thicker,
  more contrasty, and saturated where the web is neutral grey. Size, position,
  tint, labels and vertex dots are unchanged.
- **The repeated fixed print footer is revoked.** It was `position: fixed` with a
  9mm `@page` band reserving space for it on every page, and real Chrome/Edge
  verification failed it twice over. The band cost every page 34px of a 1032px
  column that was already close to the fold — most of the overflow that pushed
  Parent Notes and the footer onto a second page — and `fixed` did not place the
  footer where it was asked to either: it appeared at the *top* of page two, which
  a per-page fixed box cannot do. That is the behaviour of a box never lifted out
  of flow at all, five levels deep inside an overlay portalled to `<body>` in
  paged media. (Not a containing-block problem: nothing in the chain sets a
  transform, filter, perspective or `contain`, and the overlay's only animation is
  an opacity fade that print disables.)
- **The report footer is back in normal flow, and appears once.** `@page` is a
  balanced 12mm gutter again, the sheet is a flex column in print, and `.rp-foot`
  takes `margin-top: auto`: on a short report the free space collects above it and
  pushes it near the bottom of page one; on a long one there is none, `auto`
  resolves to zero, and the document paginates exactly as it would without any of
  this, with the footer after the final content on the final page. Nothing is
  positioned, so nothing can overlap or be hidden, and no page can be created by
  footer geometry alone.
- **The page floor tracks the real page, with two guards.** `min-height:
  min(calc(100vh - 6mm), 267mm)`. In paged media `100vh` *is* the page area, so
  the floor follows whatever the browser gives a page — an earlier attempt used a
  flat 250mm, which is 945px and therefore below nearly every real report, so it
  never engaged and the auto margin never had free space to absorb. The 6mm guard
  keeps the floor strictly under the page area, because a floor level with it is
  the blank-page-2 defect inverted. The 267mm cap is A4's content box less the
  same guard: if any engine ever resolved `100vh` against a screen viewport
  instead, the cap means that costs a footer sitting higher up the page rather
  than costing a page.
- **Print's major section gap is the file's 4.5mm stated exactly** — 17px at 96dpi
  rather than rounded up to 20px. That is the approved rhythm, not a compression
  away from it, and together with the reclaimed `@page` band it returns 61px to
  the column, which is what lets a short report keep Parent Notes and its footer
  on page one. The heading gap, the internal spacing, the 56/44 skills split and
  the print radar size are all unchanged.
- **The printed report footer follows the content, and that is the contract.**
  Three attempts to anchor it were each disproved in a real browser, and the last
  one is the instructive failure: a `min-height` floor on the sheet forces a
  minimum height *whatever the report contains*, so when the browser's real
  printable area is even slightly smaller — as it is whenever a user agent
  reserves part of the margin band for its own header and footer — the sheet
  overflows by a few millimetres and `break-inside: avoid` on `.rp-foot` turns
  that into the **whole footer alone on page two**. A guaranteed minimum height is
  a guaranteed minimum overflow. Every forcing mechanism is gone — no floor, no
  flex column, no auto margin, no `position: fixed`, no footer-only `@page` band —
  and the sheet is sized by its content, so there is nothing to overflow. The
  footer's only print rule is now the gap above its own divider.
- **The two documents are deliberately different, and it is written down.** The
  downloaded PDF is the family-facing generated document: deterministic A4, footer
  drawn in millimetres at the bottom of every page. Browser print is the browser's
  own rendering of the same report — same content, same hierarchy, same dividers
  and spacing — with natural pagination and the footer after the content.
  Reproducing the file's footer geometry in print cost an extra page three times;
  an extra page is worse than a footer that sits where the report ends.
- **Browser print no longer renders the app report footer at all.** Four
  architectures were each disproved by real-browser verification — a repeated
  `position: fixed` footer with a 9mm `@page` band; a flat `min-height: 250mm`
  floor, which sat below nearly every real report and so never engaged; a
  viewport-relative floor with `margin-top: auto`, which turned a few
  millimetres of overflow into a footer-only second page; and plain flow, which
  stopped forcing a page but left the footer wherever the content happened to
  end, which is not a footer. `.rp-foot` is now `display: none` inside
  `@media print`, and every print-only rule that positioned it, reserved space
  for it or floored the sheet is gone — the printed sheet sizes entirely from
  its content and paginates naturally. **This supersedes the two entries above.**
  The screen preview keeps its footer and the downloaded PDF keeps its own,
  drawn in millimetres at the bottom of every page: that file is the
  family-facing document, and browser print is a convenience output. The URL,
  date, page number and site name a browser draws at the page edges are
  user-agent chrome and are unaffected either way.
- **The composer gets a workspace sized for the document it previews.** Its right
  half is an A4 sheet, and it was being drawn at 74% of the printed width: at
  1920px the shell's 1400px cap and an even split gave a 668px preview pane
  holding a 604px sheet, whose 524px content column is nothing like the printed
  703px — so the preview wrapped its paragraphs somewhere the real report does
  not. The composer now lifts that cap to 1760px for itself (reached through
  `:has(> .rvc)`, so no other screen changes width) and splits 40/60 in the
  preview's favour, with a 400px floor under the editor. At 1920px the sheet
  reaches its own 760px maximum and its content column is **680px — 97% of the
  printed one**, up from 74%; at 1440px it goes from 500px to 613px. The editor's
  floor is what that pane already had at 1100px, so nothing narrows anywhere, and
  an ultrawide screen is capped rather than stretched. Tablet and phone are
  untouched: the split still collapses to one column below 1100px.
- **Student Profile Reviews analytics**: skill radar with previous-month
  comparison, score trend, score-distribution donut, skill heatmap, monthly
  learning journey and the strengths / focus-areas ranking — all derived on
  demand from reviews that already exist, none stored.
- The dead **Review drawer** was removed. It had had no routed consumer since the
  composer replaced it; the shared Drawer primitive, the shared review fields and
  the shared form helpers all stay.
- Still deferred and omitted whole rather than stubbed: **AI summary**,
  **achievement** and **concern** lines. No stored field carries them and no
  deterministic rule produces one, so none appears on any surface — including the
  printed and exported document.
- New dependency footprint: **none added**. `jspdf` was already a dependency and
  is now used, dynamically imported so only a session that exports pays for it.
  Two Roboto weights (Apache-2.0) ship as static assets in `public/fonts/` with
  their licence — jsPDF's built-in fonts are Latin-1 and cannot encode
  Vietnamese. No rasterizing capture library was added.
- **The `(studentId, month)` unique index now exists in production**, as
  `review_student_month_unique` on `etlms.reviews`, key `{studentId:1, month:1}`.
  It was created explicitly and by name in Gate 5.1, and `models.ts` declares the
  matching index as of Gate 5.2. **That order is the point, not an accident:**
  `dbConnect` leaves mongoose's `autoIndex` at its default, which is on, so a
  schema declaration is built implicitly the first time the model is used — in
  every process, including a deploy. Declaring first would therefore have been a
  deploy-time DDL nobody authorised, failing asynchronously on the connection if
  a duplicate pair existed. Against an index that already exists with an
  identical spec, the implicit build is a no-op. It also fixes the rollback
  order: revert the declaration and deploy that *before* dropping the index.
  The redundant `studentId_1` prefix index was deliberately **not** dropped —
  that is another production mutation with its own authorisation — and `month_1`
  must be kept, being a suffix the compound index cannot serve.
  The service's own `(studentId, month)` pre-check stays: the index is the
  concurrency guarantee for a two-tab race, the pre-check is the error path a
  teacher reads, and one does not replace the other.
- ~~**Production rollout has not been executed.**~~ *(True when written;
  **superseded** by the entry below, after Gate 5.3.)* Nothing is deployed and
  **no production Review has been created, edited or deleted** — the index was
  DDL and moved no document, which is why the collection's digest is identical
  either side of it. Rollout, deployment and production verification are still
  outstanding, and Sprint 8 is **not closed**.
- **Rollout: hosted Vercel Preview verified.** `sprint-8-reviews` was pushed and
  deployed as a **Vercel Preview** at
  `teacher-lms-git-sprint-8-reviews-azjxe.vercel.app`, running deployed SHA
  `c19629c`, and a human browser pass against it **passed** (Gate 5.3). Two
  things stay separate rather than being collapsed: the **deployment
  environment** was Preview, and the **database** it read was production Atlas.
  A Preview deployment reading production data is **not** a Vercel Production
  deployment, and nothing in this repository claims one has happened. The
  rollout is the closure proof for Gate 5.1/5.2's ordering: because
  `review_student_month_unique` already existed in production with an identical
  spec, mongoose's default `autoIndex` build on the deployment's first model use
  was a **no-op** — **0 indexes created, 0 dropped, 0 changed**, and no
  `studentId_1_month_1` duplicate. There was **no deployment-time DDL**, and
  **no Review document was created, edited or deleted** during rollout: both
  baselines reproduce exactly either side of it — `reviews` at 33 /
  `c4418428f5d247b7c58caf046ce09c6e71f24dd30caab3bc86d4032a5fa8c4d5`, 11 ghosts
  over 5 deleted students, 0 duplicate pairs; `homeworks` at 15 /
  `aef736e9931fac3350c6b7a9a2d17834ca3f22566792f952183fc7ed9e85741f`. The
  production index inventory is exactly `_id_`, `id_1`, `studentId_1`,
  `month_1` and `review_student_month_unique`. Closure audit **passed**.
  **Sprint 8 remains open until this `main` revision is deployed to Vercel
  Production and that deployment is verified.**

## Unreleased — Homework MVP (Sprint 7)
- Homework index: the assignment cards with their class colour, status badge,
  scope and assignee, due date and per-card Edit / Duplicate / Delete, plus a
  class filter and the loading / error / empty states.
- Assign and Edit drawer: title, description, class, scope (entire class or one
  student), student, due date and teacher notes. An edit sends only the four
  fields a teacher authored.
- Duplicate opens a new assignment prefilled with the teacher's own words and a
  blank due date, and writes nothing until it is saved. No outcome is copied — a
  duplicate is new work, born Assigned.
- Delete is offered only for homework that is still Assigned. Settled work is a
  historical record, and the API refuses it with no write at all, not merely by
  disabling a button.
- API: `GET /api/homework`, `POST /api/homework`, `PATCH /api/homework/:id` and
  `DELETE /api/homework/:id`, each behind the session. Requests are validated
  strictly: a payload naming a field the server owns is refused rather than
  quietly ignored.
- Homework is class-owned and never attached to a lesson, so setting, editing or
  deleting it never touches lesson generation or reconciliation.
- Only an Active class may be given new homework. Class-scoped work snapshots the
  roster ids that resolve to real students, in the class's own order; a class
  whose roster resolves to nobody may still be given class-scoped work.
- Homework completion now counts **Late as done** alongside Completed. Work
  submitted late was submitted; Missing is the opposite of done, and Assigned is
  excluded rather than counted as a failure. This restates existing months: June
  2026 reads 77% and July 2026 reads 56%.
- Stored outcomes for students whose documents no longer exist are preserved and
  still counted, and are never sent to a client. A student-scoped assignment whose
  student is gone is preserved and still counted, but is not listed — and what the
  index omits, the API refuses to edit or delete.
- Historical editing is permitted with no month lock and no warning, so changing a
  due date may move an assignment between months and change a closed month's
  reported completion. That is intended.
- Scope note: the design comp's KPI row and status-chip row are omitted. Every
  binding in both is computed, no literal copy survives for them, and "Assigned"
  exists nowhere in the design — a chip row that could not filter to Assigned
  would hide every pending assignment. Both are left out whole rather than
  approximated, and no placeholder or invented value stands in for them.
- No submission-recording surface in this MVP: there is no designed screen that
  records a student's outcome, so there is no endpoint that writes one.
- No homework timestamps, so no "last updated" is shown anywhere.
- Rolled out to the deployed application, and production verification of the
  shipped MVP is now complete. The read-only production check passed (Gate 5
  Phase 0). Then, against production data and each confirmed by hand in the hosted
  app: one controlled create through `POST /api/homework`, read back with its
  roster snapshot intact and no outcome synthesised; one controlled edit through
  `PATCH /api/homework/:id`, changing only title, description, due date and
  teacher notes, with ownership, status and recorded outcomes unchanged and the
  record count unmoved; Duplicate confirmed to open a prefilled create form with a
  blank due date and write nothing at all; and one delete through
  `DELETE /api/homework/:id` of that same assignment, still Assigned and
  therefore still pending. The pre-existing records were verified byte-identical
  after every write, and the delete returned the collection to its original
  15-record baseline — same ids, zero field differences, ghost outcomes preserved,
  and no test data left behind. The Sprint 7 closure audit has since passed.
- **Sprint 7 — Homework is closed.** The closure audit re-checked the accepted
  contract against the current code rather than against the gate reports: the
  Active-class create guard, the Assigned initial status, `lessonId = null`, Late
  counting as done with Assigned excluded, ghost outcome preservation, the
  Assigned-only delete and Duplicate’s sanitised prefill are each implemented and
  covered by tests. Production integrity, reporting, smoke-data removal and the
  engineering gates were all verified. Recording submission outcomes stays
  deferred, and no submission writer shipped.

## Unreleased — Attendance MVP (Sprint 6)
- Attendance index: this month's rate and status counts, attendance by class,
  today's lessons and the most recent past ones, each showing whether a register
  has been taken yet.
- Take attendance: the visible roster with Present / Late / Absent / Excused,
  optional per-student notes, "Mark all present", a live summary and an explicit
  Save.
- API: `GET /api/attendance`, `GET /api/attendance/:lessonId` and
  `POST /api/attendance/:lessonId`. Creating and updating a register are the same
  request.
- Eligibility: a Completed lesson of any type — including one in a closed month —
  plus a lesson dated today that is still Upcoming. Future and Cancelled lessons
  are refused by the API, not merely by hiding a button.
- Where no register is stored, every resolvable roster student reads as Present.
  Opening a register writes nothing at all; only an explicit Save does.
- Historical registers may be corrected through the same endpoint, with no month
  lock — so a correction may move a closed month's revenue and attendance rate.
  That is intended: a correction says the record was wrong.
- Stored entries for students whose documents no longer exist are preserved. A
  save writes only the students it was given, one key each, and leaves every other
  stored entry exactly as it was.
- A request naming a student outside the visible roster is rejected in full, with
  nothing written — never a partial save.
- Notes are optional and descriptive only; clearing one removes the stored note
  rather than keeping an empty value.
- The Lesson owns the date. The legacy `AttendanceRecord.date` mirror is never
  read, written or updated, and new records do not carry it.
- No attendance timestamps in the MVP, so no "last updated" is shown anywhere; a
  derived one would be a guess presented as a fact.
- Rolled out against the deployed application and validated in production: first
  register creation, repeated identical saves, editing an existing register,
  preservation of hidden entries, note write and clear, and invalid-student
  rejection — each with no collateral write and no reporting drift.

## Unreleased — Lesson & Class Lifecycle (Sprint 5.6.4B onward)
- Class lifecycle: added the `Ended` status alongside `Active` and `Archived`.
  Only `Active` generates lessons and holds weekly slots; `Active` and `Ended` are
  reconcilable. Ending a class clears its future from next month onward; archiving
  stays reversible and destroys nothing.
- Lesson lifecycle: a Regular `Upcoming` lesson whose date has passed is now
  resolved and stored — `Completed` on an Active class, `Cancelled` and not
  chargeable on an Archived one. Previously nothing advanced a lesson's status, so
  against a real clock revenue would have stayed at zero.
- Fixed: archiving a class no longer erases its revenue from closed months.
  Revenue is derived from lessons and never reads a class's current status.
- Fixed: Regular lesson generation is insert-only and forward-only. Editing a
  schedule can no longer back-fill lessons onto dates that have already passed.
- Reporting: archived classes are reported as two labelled sets — what a restore
  would recover, and what the archive has already settled.
- Business rules for both lifecycles recorded in `PROJECT_RULES.md`.
- Data: removed 32 fabricated historical Regular lessons created by the old
  back-fill defect. Reported revenue for June and July fell accordingly; no
  billing record changed.

## v0.5.6 - Recurrence Engine (Sprint 5.6)
- Reconciliation keyed on `(classId, date)`; the lesson id became an opaque key.
- Write-side reconciliation on schedule edits, with a pre-write audit that aborts
  the whole plan on any violation.
- Phase 0 migration: back-filled reschedule origins onto 11 legacy moves.
- Lesson retirement enabled, clearing the forked `c4` series.
- Duplicate detection and a read-only reconciliation dry run.

## v0.5.5 - Calendar UX and recurrence architecture (Sprint 5.5)
## v0.5.4 - Calendar UX refinement and classroom improvements (Sprint 5.4)
## v0.5.0 - Lesson schedule display and class scheduling UX (Sprint 5.3)

## v0.4.0 - Classes Module
- Class CRUD, weekly schedule editor, single-teacher conflict rule
- Regular lesson generation from the recurring schedule

## v0.3.0 - Parents Module
- Parent CRUD
- Student ↔ Parent relationship
- Localization improvements
- Parent delete cascade

## v0.2.0 - Students Module
- Student CRUD
- Student Detail
- Search & Filters
- Optional Parent support

## v0.1.0 - Foundation
- Authentication
- Dashboard
- MongoDB
- Deployment