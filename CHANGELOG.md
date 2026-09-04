# Changelog

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
  lessons · informational" tile beside three solid bill-derived ones, and the
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
  them: they stay `null` and render **`No data`**, never `0đ` and never an
  inferred 50%. The dead `calc.ts` `paidAmount` helper carrying that 50% rule was
  deleted along with the unused `Payment` type and `paymentSchema`. **Zero
  migration, zero backfill.**
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
  Overdue or Invoice concept. A class whose collected total is unknown is **not
  ranked and not given a zero** — it is listed after the ranking, saying
  `No data`, because sorting it as 0 would put a class that has collected almost
  everything at the bottom of a list titled "highest-value".
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
- **Rollout is complete; Sprint 9 remains open until a human browser pass
  against the Vercel Production deployment is recorded.** The responsive pass on
  record was taken against the **Preview** deployment at `206084f`. Production
  now serves that same SHA — the closure commit on top of it is documentation
  only — and was verified here **programmatically**: the served stylesheet
  carries the 620px Finance block, the served bundle carries the new copy and no
  longer contains the removed disclosure hook, and every month's payload named
  only live students. That is strong evidence and it is not the visual pass, so
  neither is reported as the other.

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