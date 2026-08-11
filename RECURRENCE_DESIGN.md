# Recurrence Engine — Technical Design

**Status:** approved (2026-08-04); **revised 2026-08-06** after the Sprint 5.6.1 dry
run — see §1.6 for what was measured, ADR-002 for what it changed, and §5.9 for the
manual-edit protection added to §6 Phase 4.

Sprints **5.6.0 (prerequisites)** and **5.6.1 (report-only reconciliation)** are
delivered: the pure planner is `src/lib/recurrence.ts`, the dry run is
`scripts/recurrence-report.ts` (`npm run lessons:reconcile`), the scenario tests are
`tests/recurrence.test.ts` (`npm test`).

**§6 Phase 0 was applied and verified on 2026-08-10** (Sprint 5.6.4 Phase 0) — the
only database write this design has authorised so far, and a strictly additive one:
eleven origin triples, nothing else touched, every reported figure unmoved. See
`MIGRATION_PHASE0.md`. `legacyOriginFallback` went with it. **`RETIRE_ENABLED` is
still `false`: retirement is not implemented, and the 142 planned retirements and
the orphan lessons are all still in place.**

**Approved scope for Sprint 5.6** is §1–§8, ADR-001 and ADR-002. §9 (technical debt)
and §10 (future improvements) are explicitly **outside** it.

**Companion documents:** `LESSON_DUPLICATES.md` (the defect and the detection tool),
`PROJECT_RULES.md` (business rules — authoritative on conflict).

---

## 1. Current recurrence architecture

### 1.1 Lesson identity

A `Lesson` is a row in the `lessons` collection keyed by a stable string `id`. That
id is referenced by three other collections, none of which has a foreign key or a
cascade:

| Reference | Collection | Notes |
|---|---|---|
| `AttendanceRecord.lessonId` | `attendances` | unique index; 151 records |
| `Homework.lessonId` | `homeworks` | nullable, unused by current UI |
| `Lesson.fromId` | `lessons` | a Makeup points at the Cancelled Regular it replaces |

### 1.2 Current ID strategy

```
L-<classId>-<date>-<HHMM>       Regular   (src/lib/lessons.ts, regularId)
M-<originLessonId>              Makeup    (seed only)
X-<classId>-<date>              Extra     (seed only)
<ObjectId>                      Makeup / Extra created through the API
```

The Regular id embeds three pieces of *mutable* data: the class, the date, and the
slot's start time. **This is the defect.** The id is simultaneously used as:

- the primary key,
- the uniqueness constraint,
- **the reconciliation key** — the thing ensure looks up to decide "does this
  lesson already exist?"

The third role is the one that breaks, because two of the three embedded values can
change after the id is minted.

### 1.3 Generation flow

```
listLessons()                         ← the ONLY caller
  └─ ensureRegularLessons()
       ├─ read every class where status != "Archived"
       ├─ windowMonths()   = CURRENT_MONTH −1 .. +2   (constants.ts)
       ├─ for each class × month × slot × matching date:
       │     id = L-<classId>-<date>-<HHMM>
       │     bulkWrite: updateOne({ id }, { $setOnInsert: {...} }, { upsert: true })
       └─ swallow duplicate-key errors (concurrent reads race)
```

Two properties follow from this shape:

- **It is schedule → lessons only.** Nothing ever walks lessons → schedule to ask
  "does this lesson still have a slot backing it?"
- **`updateClass()` reconciles nothing.** It writes `Class.schedule` and returns.
  Lessons are corrected — or not — on the next read, by ensure.

### 1.4 Why changing HH:mm forks a series

The start time is *inside the reconciliation key*.

```
schedule = Tue 14:30              ensure computes  L-c4-2026-07-14-1430  → exists → skip
   ↓ teacher edits to 10:08
schedule = Tue 10:08              ensure computes  L-c4-2026-07-14-1008  → missing → INSERT
```

`L-c4-2026-07-14-1430` is never computed again, so it is never looked at. It is not
updated, not retired, not even read. Both series then extend forward on every
subsequent run, because ensure keeps filling its window from whichever schedule is
current while the old series sits untouched.

Confirmed in live data (`c4 "Emma Chen · 1-on-1"`, schedule now `Tue 10:08/45`):

```
series @ 14:30 : 35 lessons, 2026-02-03 .. 2026-09-29   (23 past, 12 future, 17 with attendance)
series @ 10:08 : 18 lessons, 2026-06-02 .. 2026-09-29
```

### 1.5 Why `$setOnInsert` causes orphan lessons

`$setOnInsert` writes only when the upsert inserts. This is deliberate and correct
for what it was designed to protect: a lesson that has been cancelled, rescheduled,
or hand-edited must survive being re-read, and ensure runs on *every* list read.

The cost is that ensure has exactly one verb — **create**. It has no verb for
"this lesson's slot changed" and no verb for "this lesson's slot is gone". A lesson
whose slot disappears therefore has no code path that can ever reach it again. It
is immortal by construction.

Two further consequences of the same design, both latent:

- **A duration-only edit produces no duplicate and no correction.** The id is
  unchanged, so `$setOnInsert` skips, and the lesson silently keeps the old
  duration — a wrong end time with nothing to signal it.
- **Status never advances.** `statusForDate()` is evaluated once, at insert, and
  stored. Nothing ever transitions a lesson from `Upcoming` to `Completed` as time
  passes. This is invisible today only because the app clock is frozen at
  `2026-07-10`. Against a real clock, every lesson would remain `Upcoming` forever
  and revenue — which counts only `Completed` — would stay at zero.

### 1.6 Measured state — Sprint 5.6.1 dry run, 2026-08-06

`npm run lessons:reconcile`, read-only, app clock `2026-07-10`, window
`2026-06 … 2026-09`. 12 classes, 1009 lessons, 151 attendance records.

| Verb | Count |
|---|---|
| KEEP | 257 |
| UPDATE | 0 |
| INSERT | 0 |
| RETIRE | 318 |
| SKIP (frozen) | 6 |

Reported alongside the plan but never part of it: **11** legacy reschedules awaiting
Phase 0, and **18** lessons whose class no longer exists.

**Why zero updates and zero inserts.** Ensure runs on every list read, so the correct
series already exists on every future window date of every Active class. Each desired
slot finds an exact match, and the stale series sits *beside* it rather than in its
place. An UPDATE only arises when a stale lesson is alone on its date with an
unsatisfied slot. The plan's entire write surface today is deletion.

**Agreement with `npm run lessons:duplicates`.** Of the detector's 223 "safely
removable" lessons, the planner retires **223** — and of its 106 protected candidates
it touches **zero**. No action is dated before the app clock. The remaining 95
retirements are ones the detector cannot see, and every one is explained:

| Cause | Count | Why the detector misses it |
|---|---|---|
| Archived class `B2`, lessons matching its (fossil) schedule | 82 | the detector ignores class status and marks them KEEP |
| Archived class `asd` (`6a683d44…`) | 12 | one lesson per date — below the two-or-more threshold |
| `c4` orphan on 2026-08-04 | 1 | its date-mate was rescheduled away, dissolving the group |

**Orphan census.** The broad orphan count is **366**, matching the original
measurement exactly. **37** sit alone on their date (the doc previously said 36): 24
past, 13 future. The planner retires the 13 future ones and none of the 24 past ones.
The 37th is that `c4` lesson — a reschedule silently hid an orphan from the detector,
which is the clearest demonstration available of why the reverse pass is necessary.

**The archived share.** 176 of the 318 retirements — 55% — come from two Archived
classes rather than from any forked series. That finding is what ADR-002 responds to.

---

## 2. Business rules

The governing principle, from which every rule below is derived:

> **`Class.schedule` states the teacher's INTENT for the future.
> `Lesson` records the FACT of a single session.
> Intent may be revised. Fact, once it is in the past, is immutable.**

Every rule therefore has the same shape: *edit intent → reconcile future facts →
never touch past facts.*

"Future" means `date >= app clock` **and** `status === "Upcoming"`. A lesson that is
Completed or Cancelled is past in the sense that matters, whatever its date.

| Edit | What must happen |
|---|---|
| **Change start time** | Future lessons on that weekday are **updated in place** to the new start. Id, notes, classroom override and any homework link are preserved. Past lessons keep the old time. No second series. |
| **Change duration** | Same: future lessons updated in place. This case produces no duplicate today and is silently wrong — it must be covered explicitly. |
| **Change weekday** (Tue → Wed) | Future lessons on the old weekday are **retired**; future lessons on the new weekday are **inserted**. Not treated as a move: the dates differ, so identity is not carried across. |
| **Delete one weekday** | Future lessons on that weekday are retired. Past lessons remain — they were taught. |
| **Add one weekday** | Future lessons are inserted across the window. Nothing existing is touched. |
| **Delete entire class** | **Blocked** whenever the class has any past lesson, attendance record, or billing record. **Archive is the only supported way to retire a class that has taught anything.** Today `deleteClass` removes only the Class row and leaves every lesson behind, orphaned: they render `className: "—"` and drop out of revenue silently, because `computeRevenue` iterates classes and a lesson whose class is gone is never visited. Hard delete survives only for a class that has never taught — no lessons at all, or future Upcoming ones only. The guard prevents new orphans; it does nothing for the **18 that already exist** (§6, "Not in scope — lessons whose class was deleted"). |
| **Archive class** | Generation stops (already true) and **nothing else happens**. An Archived class is outside reconciliation entirely (§5.8, ADR-002): its lessons are never updated, inserted or retired. Retiring its future lessons is a separate one-shot transition action, deliberately **deferred out of Sprint 5.6** and sequenced behind §9.1 — archiving already erases the class's historical revenue, and bolting a second destructive effect onto a defective operation is the wrong order. Accepted consequence: lessons generated before the archive linger until they age out of the window. *(Revised 2026-08-06; previously this row retired future Upcoming lessons.)* |
| **Restore class** | Generation resumes and the read-side top-up refills the window from the current schedule. Past lessons are already there and are not re-derived. Because archiving now retires nothing, restore has nothing to undo — the round trip is lossless, where the previous rule made it lossy (notes, classroom overrides and homework links on future lessons did not survive it). |
| **Cancel one lesson** | The lesson stays `Cancelled` forever. The reconciler never resurrects it, never updates it, and never counts its slot as vacant. It remains excluded from revenue unless `chargeable`. |
| **Reschedule one lesson** | The lesson is **frozen against reconciliation** for good. Its stored origin (`originalDate` / `originalStart` / `originalDuration`) marks the slot it vacated as *satisfied*, so the reconciler does not regenerate a lesson on the original day. Editing the class schedule afterwards must not drag it back. |
| **Edit a lesson's notes** | The lesson carries **human-authored content** and is never retired and never replaced by an insert beside it. It **is** still corrected in place when the schedule moves, keeping its id and its notes: the goal is to preserve what the teacher wrote, not to freeze the lesson at its old time. `classroom` is not a signal — see §5.9. |
| **Create Extra lesson** | Never generated, never reconciled, never retired. `type !== "regular"` is excluded from the reconciler entirely. |
| **Create Makeup lesson** | Same. Additionally, the Cancelled Regular it references via `fromId` must never be deleted while the makeup exists. |

---

## 3. Source of truth

| Screen / module | Reads | Rule |
|---|---|---|
| **Calendar** | **Lesson** | Renders lesson records only. `Class` is read for presentation enrichment (name, colour, classroom, level) and for nothing else. Must never render `Class.schedule` on an event. |
| **Lesson List** | **Lesson** | Same. |
| **Lesson Drawer** | **Both** | `Lesson` for this session's date/time/status; `Class.schedule` for the "Recurring schedule" block; the lesson's own `originalDate` for a rescheduled one's origin. The two are labelled distinctly and must never be confused for one another. |
| **Class Details** | **Class.schedule** for the schedule card; **Lesson** for the (future) Upcoming Lessons section, which is a placeholder today. |
| **Attendance** | **Lesson** | Attendance always belongs to a Lesson, never a Class (`PROJECT_RULES`). Keyed by `lessonId`. |
| **Billing / Revenue** | **Both** | `Class.fee` for the monthly fee; `Lesson` for the count of regular lessons in the month (the per-lesson denominator) and for what was actually Completed. Never derived from `Class.schedule` — a month's true lesson count includes makeups and excludes nothing that was generated. |
| **Homework** | **Lesson** (optional `lessonId`) + **Class** | A homework item may hang off a lesson or off a class alone. |
| **Reports** | **Lesson** + Attendance + Billing | Never `Class.schedule`. A report describes what happened, not what was planned. |

**The invariant:** no screen may compute a *lesson's* time from `Class.schedule`,
and no screen may infer the *recurring schedule* from lesson records. Sprint 5.5.1
already enforced the first half by routing every lesson time through one
`timeRange(lesson, fmt)` formatter.

---

## 4. Lesson lifecycle

```
                        (generated from Class.schedule)
                                     │
                                     ▼
                              ┌─────────────┐
                              │  Upcoming   │  ← the ONLY reconcilable state
                              └─────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ▼                    ▼                    ▼
         ┌─────────────┐      ┌─────────────┐      ┌──────────────┐
         │  Completed  │      │  Cancelled  │      │ Rescheduled  │
         │   FROZEN    │      │   FROZEN    │      │  (modifier)  │
         └─────────────┘      └─────────────┘      └──────────────┘
                                                          │
                                          still Upcoming, but frozen
                                          against reconciliation
```

`Rescheduled` is **not a status** — it is a modifier carried by the origin fields on
top of `Upcoming`. It changes who may write to the lesson, not what the lesson is.

**Manually edited** is a modifier of the same family but a weaker one (§5.9): a lesson
carrying notes is still `Upcoming`, still reconcilable, and is still corrected in place
when the schedule moves. It withdraws exactly one verb — retire — because the note is
the teacher's and the timetable is not. A reschedule withdraws every verb; a note
withdraws only the destructive one.

### Why past lessons must never change automatically

Four reported figures are computed by re-reading the lesson collection on every
request. There is no stored snapshot of any of them, so any retroactive edit
silently rewrites history that has already been shown to a teacher or a parent:

| Figure | Depends on | Effect of touching a past lesson |
|---|---|---|
| Monthly revenue | count of `type === "regular"` lessons in the month → the per-lesson denominator | Deleting one **raises** every other lesson's value in that month. Measured on `c4`: removing the 4 orphan July lessons moves per-lesson value from 187,500 to 375,000 VND. |
| Revenue per student | `Completed` status + attendance entries | A student marked Absent stops contributing; changing status changes their bill. |
| Teaching hours | sum of `duration` over `Completed` lessons | Changing a duration rewrites reported hours. |
| Attendance rate | `Completed` lessons joined to attendance records | Deleting a lesson orphans its attendance record, which then counts toward nothing. |

### Why future lessons may be reconciled

A future lesson is a *prediction* derived from intent. Nothing has been taught, no
attendance exists, no revenue has been recognised (only `Completed` counts), and no
parent has been shown it as fact. Correcting a prediction when the intent changes is
the entire purpose of the feature.

The one exception is a future lesson a human has deliberately positioned — a
reschedule, a cancellation, or a manual note. Those are facts about intent too, and
the reconciler must not overwrite them.

---

## 5. Reconciliation strategy

### 5.1 The key change

**Stop using the lesson id as the reconciliation key.** The id becomes an opaque
primary key: never parsed, never used to infer a date or a time, never recomputed.
Existing ids keep their current format so every reference in §1.1 survives.

Reconciliation keys on **`(classId, date)`** and compares *fields*, not ids.

### 5.2 The algorithm

Run per class, over each date in the generation window that is `>= app clock`:

1. **Desired set** — the `{start, duration}` pairs from `Class.schedule` whose `day`
   matches that date's weekday. Empty if the class no longer teaches that weekday.
   An Archived class never reaches this step at all — see §5.8.
2. **Actual set** — the Regular lessons already stored for that `(classId, date)`.
3. **Partition the actual set into frozen and reconcilable.** Frozen = anything not
   `Upcoming`, anything carrying a reschedule origin, anything with an attendance
   record, anything referenced by homework. The full list is §6 Phase 4. Frozen
   lessons are removed from consideration and **their slot is consumed** — see 5.6.
   A manually edited lesson is **not** frozen here; it is reconcilable, and is
   protected at step 7 instead (§5.9).
4. **Exact matches** — a reconcilable lesson whose `start` *and* `duration` equal a
   desired pair is already correct. Pair them off; neither side needs work.
5. **Update in place** — pair the leftovers on both sides, ordered by start time, and
   write the new `start` / `duration` onto the existing lesson. This is how a slot
   *edit* preserves the lesson's id, notes and homework link. When leftovers compete
   for the same slot, a **manually edited lesson is paired first** (§5.9): it is the
   one that cannot be deleted, so giving it the slot corrects it instead of stranding
   it.
6. **Insert** — any desired pair still unmatched becomes a new lesson.
7. **Retire** — any reconcilable lesson still unmatched has no slot backing it and is
   deleted — **unless it carries notes**, which is never deleted and is reported as
   stranded instead (§5.9).

Steps 5–7 are the three verbs ensure currently lacks.

### 5.3 How removed lessons are detected

Step 7 is the reverse pass that does not exist today: for each future date, anything
in the actual set that survived pairing has no slot in the desired set. That is the
detection. It requires reading the lessons for the window — ensure currently only
writes.

**Retire means hard delete.** Not `Cancelled`: cancellation is a business event that
shows in the UI, participates in revenue via `chargeable`, and can have a Makeup
attached via `fromId`. Not a soft-delete flag either — Sprint 5 explicitly locked the
lifecycle to three statuses with no `deleted` flag, and a flag would have to be
filtered by every read in the app. The API's `regular_not_deletable` guard **stays**;
the delete is available only inside the reconciler, which has already proved the
lesson is future, Upcoming, unattended and unmoved.

### 5.4 How rescheduled lessons are skipped

A lesson carrying `originalDate` is frozen (step 3). It is never updated, never
retired, and never re-paired.

**Critical dependency — discharged 2026-08-10.** This test only works for moves made
after Sprint 5.5 introduced the origin fields. The live database contained **11
legacy moves with no `originalDate`**, detectable only because the date embedded in
their id no longer matched their `date` field. Under the new design the id is opaque
and no longer consulted — so those 11 lessons would have been invisible as
reschedules and **retired as orphans**. The back-fill in §6 was therefore a hard
prerequisite, not a nicety; it has now been applied, all 11 carry stored origins,
and `legacyOriginFallback` has been removed from the live write path and the report
scripts. `reconcileContext` defaults it to `false`; the sole remaining opt-in is the
Phase 0 verification itself, which plans both ways in order to prove they agree.

### 5.5 How cancelled and completed lessons are skipped

Both fail the `status === "Upcoming"` test in step 3. A date filter alone is not
enough: a lesson can be Completed or Cancelled while still carrying a future date.
Status is checked as well as date, and either one disqualifies.

### 5.6 Slot consumption — the subtle case

A frozen lesson still **occupies** its slot. If a class teaches Tuesday 10:00 and
that Tuesday's lesson has been cancelled, the desired pair `10:00` must be treated as
already satisfied — otherwise step 6 inserts a fresh lesson and the cancellation
silently undoes itself on the next read.

The same applies to a rescheduled lesson, using the slot it *vacated*
(`originalDate` + `originalStart`), not the slot it now sits in. This is what today's
id-keyed lookup achieves accidentally: the id stays pinned to the original date, so
the slot reads as occupied. Under the new design it must be explicit.

### 5.7 Where reconciliation runs

Today ensure runs on **every** `listLessons` call. A reconcile is materially more
expensive than an insert-only upsert — it must read the window's lessons, and it
issues updates and deletes that can contend between concurrent requests (the current
duplicate-key tolerance does not cover update races).

Proposal: drive reconciliation from the **write** side — `updateClass` — where the
intent actually changes, and keep a cheap insert-only top-up on the read side to
extend the rolling window forward. This also fixes the user-visible lag where a
schedule edit is only corrected on the next list read. Archive, restore and delete
are **not** reconciliation triggers (§5.8).

### 5.8 What the reconciler deliberately does not reconcile

Three sets of lessons are outside the algorithm entirely. Not filtered late, not
skipped case by case — never presented to it. See ADR-002.

| Excluded | Why |
|---|---|
| **Lessons of an Archived class** | The class has no *intent* to compare against. Its schedule is a fossil, so a desired set of `[]` would make every future lesson an orphan by definition — turning one class-level decision into hundreds of per-lesson deletions, which is not reconciliation but a bulk delete wearing its clothes. Measured cost of including them: 55% of the plan (§1.6). |
| **Lessons whose class no longer exists** | Reconciliation *requires* a schedule; there is none. Any rule that could apply would have to be "delete everything", which would cross the past/future boundary the sprint promises never to cross — 6 of the 18 live instances are past and Completed. Reported, never planned. |
| **Makeup and Extra lessons** | Never generated, so never reconciled and never retired (§2). |

The first two must still be **reported**. `findOrphanedLessons` already lists the
classless ones in `npm run lessons:reconcile`; the Archived ones currently appear as
retirements, and when 5.6.2 removes them from the plan the report must gain a section
naming them and their lingering future lessons instead. Visibility is the thing that
was missing, and it costs nothing — but being visible is not the same as being in
scope.

The rule that falls out of all three: **the reconciler has exactly one input (the
class's schedule versus its lessons) and one trigger (a schedule edit).** Class
status is not a second, hidden input capable of mass deletion.

### 5.9 How manually edited lessons are protected

*Added and approved 2026-08-06 as a Phase 4 protection.*

**The principle.** A generated lesson is the reconciler's to correct. A lesson a
teacher has written on is not — but only its *content* is the teacher's. The schedule
is still the class's. So:

> **Preserve human-authored content; do not preserve the old schedule forever.**

**The signal: `notes`, and only `notes`.** A Regular lesson is *manually edited* when
it carries a non-empty `notes` value.

That field is unambiguous. `ensureRegularLessons` writes `notes: ""` at insert, and
the only path that writes anything else onto an existing Regular lesson is
`updateLesson` — a human action. A non-empty value therefore means a person typed it,
with no inference involved. Nothing else in the system stores a lesson's notes, and
retire is a hard delete with no undo, so the text is gone for good if the lesson goes.

**`classroom` is deliberately excluded.** Regular lessons do not support a true
classroom override today, and the stored value cannot distinguish generated data from
a human edit:

- `ensureRegularLessons` stamps `c.classroom` onto every lesson at insert via
  `$setOnInsert`. Rename the class's classroom afterwards and every lesson generated
  before the rename keeps the old string — untouched, and indistinguishable from a
  deliberate override.
- A genuine override is inert anyway: `classroomFor()` in `src/lib/lessons.ts`
  discards a Regular lesson's stored classroom at read time and renders the class's,
  so the value is not shown anywhere in the UI.

Protecting on that field would produce false positives — potentially every lesson
predating a single classroom rename — for data no one authored and no screen displays.
It is out of this rule for Sprint 5.6. If Regular lessons gain a real override later,
the rule can be revisited then.

**No new field is introduced.** An explicit edit stamp (an `editedAt` written by
`updateLesson`, mirroring `rescheduledAt`) was considered and **rejected for Sprint
5.6**: `notes` already answers the question exactly, and adding schema surface during
a data-integrity fix widens the blast radius of the one sprint that most needs a
narrow one — the same reasoning that keeps `scheduleVersion` out (§10.1).

#### What the protection does and does not do

It is a filter on **two verbs**, not on the candidate set:

| Verb | Applies to a lesson with notes? |
|---|---|
| **RETIRE** | **Never.** The lesson is not deleted, whatever its slot is doing. |
| **INSERT** as a replacement for it | **Never.** It claims its slot through ordinary matching (steps 4–5), so nothing is generated in its place. No extra consumption rule is needed — being reconcilable is what earns it the slot. If no slot survives at all, there is nothing to insert either. |
| **UPDATE in place** | **Yes — deliberately.** `start` and `duration` are corrected like any other lesson. |
| **KEEP** | Yes, when it already matches. |

An insert *can* still occur on the same date when the schedule has more slots than the
day has lessons. That is a genuinely new session, not a replacement, and it is correct.

This is what separates it from every other Phase 4 protection. Attendance, homework,
the reschedule origin and a non-`Upcoming` status all remove a lesson from
consideration entirely (§5.2 step 3). A manually edited lesson stays *in* the
reconcilable set and is corrected normally — it is simply never deleted.

The reason is that in-place update **is** the preservation mechanism. ADR-001 chose it
over delete-and-recreate precisely so that a slot edit keeps the lesson's id, its
notes and its homework link. Freezing the lesson would not protect the note; it would
protect the note's *time*, stranding one lesson at 14:30 while its siblings move to
10:08, with nothing in the UI to explain why. The verb that destroys the note is
retire, and that is the verb this rule blocks.

#### Pairing prefers the protected lesson

When leftovers compete for a slot in §5.2 step 5, a manually edited lesson is paired
first. Otherwise a day holding one plain and one noted lesson, with a single surviving
slot, could hand the slot to the plain lesson and leave the noted one unmatched — which
step 7 may not delete, so the day would end up with two lessons: one correct and one
stale. Preferring the protected lesson resolves it to one corrected lesson plus one
ordinary retirement, which is what the teacher expects to see.

#### Stranded lessons

If the slot disappears entirely — the class stops teaching that weekday — a noted
lesson can be neither corrected nor deleted. It stays where it is, and the report must
**list it as stranded** so a person can decide whether to move it, cancel it, or clear
the note and let it retire. That is the correct failure mode: visible, undeleted,
awaiting a human. It is the only case where this rule leaves a lesson out of step with
its class's schedule, and it is bounded by the number of lessons a teacher has
actually written on.

---

## 6. Migration strategy

The reconciler, once shipped, retires future orphans by itself. A one-time migration
is therefore needed for **one** thing only — and that thing must run **first**.

### Phase 0 — back-fill legacy reschedule origins (**mandatory, blocking**) — **APPLIED 2026-08-10**

Write `originalDate` / `originalStart` / `originalDuration` onto the 11 lessons whose
id-encoded date disagrees with their stored `date`. Additive: no existing field
changes, no id changes, no status changes.

**Still mandatory before any write phase — but for a different reason than when this
was written.** The original argument was that without it the reconciler deletes 11
deliberately rescheduled lessons on its first run. That is no longer true: the planner
shipped in 5.6.0 carries a `legacyOriginFallback` that reads the id when the stored
origin is absent, and the 5.6.1 dry run confirms all 11 are classified as frozen
reschedules, none retired. The hole is plugged.

What Phase 0 now buys is the thing ADR-001 actually set out to achieve: **it makes
that fallback removable.** Until the origins are stored, the reconciler still parses
the lesson id to make a safety decision — the exact coupling ADR-001 exists to
eliminate — and it can only recover `date` and `start` that way, never `duration`.
Phase 0 converts an inferred signal into stored data and lets the id go back to being
opaque.

Measured scope of the risk, 2026-08-06: of the 11, only **3** are load-bearing today
(future, in-window, on a non-Archived class: `c2`, `c3`, `TEst`). Five are dated
before the app clock and can never enter the plan; three belong to Archived classes,
which §5.8 removes from scope. The back-fill should still write all 11 — they are all
genuine moves and the write is additive — but §7 rates the risk accordingly.

### Phase 1 — snapshot

Full export of `lessons`, `attendances`, `billings`, `homeworks`. Non-negotiable: the
retire step is a hard delete with no undo.

### Phase 2 — baseline the reported figures

Record revenue, teaching hours and attendance rate for **every past month**, per
class and in total, before anything changes.

### Phase 3 — dry run

Run the reconciler in report-only mode. Diff its intended actions against
`npm run lessons:duplicates`. Investigate every disagreement — in particular, the
detector only reports dates holding **two or more** lessons, so orphans that sit
alone on their date are invisible to it and appear only in the reconciler's output.
They are legitimate retirements, but they must be recognised rather than discovered
in production.

**Done — 2026-08-06.** Full results in §1.6. The census is 37 alone-on-their-date
orphans, not the 36 originally stated, of which 13 are future and therefore
actionable; the other 24 are past and structurally out of scope. Agreement with the
detector is exact in both directions that matter: all 223 of its safely-removable
lessons are retired, none of its 106 protected ones are touched.

### Phase 4 — apply, scoped

Only lessons that are: `type === "regular"`, `date >= app clock`, `status ===
"Upcoming"`, no attendance record, no reschedule origin, no homework reference, and
belonging to a class that exists and is not Archived (§5.8).

One further protection applies to the **retire verb** rather than to the candidate
set: a lesson carrying `notes` is never deleted (§5.9). It remains eligible for
in-place update, because updating is how its notes are preserved.

Everything the goals list is protected by construction, not by care:

| Goal | Enforced by |
|---|---|
| never touch completed lessons | `status === "Upcoming"` filter |
| never touch attendance | attendance-record filter + no past lesson is in scope |
| never change historical revenue | `date >= app clock` — the denominator for past months cannot move |
| never change completed homework | homework-reference filter |
| never modify cancelled lessons | `status === "Upcoming"` filter |
| never modify rescheduled lessons | origin-field filter, made reliable by Phase 0 |
| **never destroy human-authored content** | **`notes` filter on the retire verb (§5.9)** |
| never mass-delete via class status | Archived classes are out of scope (§5.8, ADR-002) |

The list is the whole safety argument: a lesson is excluded unless it positively
proves it is safe to touch. Each entry protects a different thing a lesson can be —
a fact (`status`), a relationship (attendance, homework), a position (the origin
fields), or, now, **content a teacher authored on it**. Only the last of these permits
correction while forbidding deletion; the rest forbid both.

### Phase 5 — verify

Re-compute Phase 2's figures. **Every past month must be bit-identical.** Any
difference means a past lesson was touched: stop and restore.

### Not in scope — development test classes

Four of the five affected classes — `TEst`, `asd`, `asda`, `B2` — are **development
data**, created while building the schedule editor. They account for ~92% of all
orphan candidates.

**No migration is proposed for them, and none should be written.** They will be
removed manually. Nothing in Sprint 5.6 depends on their removal, and the migration
must not special-case them: it applies the same filters to every class, and whichever
of these still exist when it runs are handled by the ordinary rules like any other
class.

The only class in the live data needing genuine reconciliation is
`c4 "Emma Chen · 1-on-1"` — 12 future orphan lessons on the retired `14:30` slot.
Confirmed exactly by the 5.6.1 dry run: `c4` plans 12 RETIRE, 11 KEEP and 1 SKIP.

### Not in scope — Archived classes

§5.8 removes them from reconciliation, so the migration inherits nothing from them.
This is a **176-lesson reduction** in what 5.6.3 would otherwise hard-delete, 164 of
it on `B2` — a class the section above already says to delete by hand rather than
migrate. Whatever future lessons an Archived class still holds simply stay put.

Retiring them remains a reasonable thing to want. It is a separate one-shot action
belonging to the archive *transition*, it needs §9.1 settled first, and it needs a
restore story. None of that belongs in a data-integrity fix.

### Not in scope — lessons whose class was deleted

18 such lessons exist (`classId 6a683d50376b4e471a458dd2`), 12 future and Upcoming, 6
past and Completed. The reconciler cannot reach them by construction (§5.8) and
5.6.2's deletion guard only prevents *new* ones, so these need a decision of their
own — as a dedicated cleanup, not as reconciler output.

Two things must be established before anything is deleted, and neither is known yet:

- **whether any of the 6 past lessons carries an attendance record.** `attendances`
  has no cascade, so deleting one orphans its register permanently.
- **whether the class deletion was intentional.** If it was, the past lessons are
  history of teaching that genuinely happened and their revenue is *already* wrong —
  `computeRevenue` iterates classes, so a lesson whose class is gone is never visited
  (§2). That is the same "past figures move without anything being written" defect as
  §9.1, reached by a third route.

Recommended: keep reporting them indefinitely — the reconciler's report is the only
surface in the app that shows they exist — and treat the cleanup as a product
decision with its own sign-off.

---

## 7. Risks

### Data integrity

| Risk | Why | Mitigation |
|---|---|---|
| **Legacy reschedules deleted** | 11 lessons have no origin fields; an opaque id could not identify them | ~~Highest risk in the plan.~~ **Downgraded 2026-08-06.** The planner's `legacyOriginFallback` reads the id when the stored origin is missing; the 5.6.1 dry run confirms all 11 frozen, none retired. Only 3 are load-bearing at all (§6 Phase 0). Phase 0 stayed mandatory to *remove* that fallback, not to prevent deletion. **Closed 2026-08-10:** all 11 carry stored origins, the fallback is gone, and the plan did not move. |
| **Mass deletion via class status** | a desired set of `[]` makes every future lesson of an Archived class an orphan — 176 lessons, 55% of the measured plan | §5.8 / ADR-002: Archived classes are outside reconciliation. Class status is not an input to the algorithm. |
| **Historical revenue moves** | the per-lesson denominator is a live count of regular lessons per month | hard `date >= app clock` filter; Phase 2/5 before-and-after diff |
| **Orphaned attendance** | `attendances.lessonId` has no cascade | attendance-record filter; no past lesson in scope |
| **Broken makeup links** | `fromId` points at a Cancelled Regular | Cancelled lessons are never in scope |
| **Orphaned homework** | `homeworks.lessonId` is nullable, no cascade | homework-reference filter (currently vacuous — no lesson has one — but must exist) |
| **Teacher's notes destroyed** | a lesson's `notes` exist nowhere else and the retire verb is a hard delete | `notes` filter on the retire verb (§5.9). This protection did **not** exist in the originally approved design — the update path preserved notes, the retire path did not |
| **A noted lesson stranded on a dropped weekday** | it may be neither corrected (no slot) nor deleted (protected) | reported as stranded (§5.9), never silently left. Bounded by how many lessons a teacher has actually written on |
| **Cancellation resurrected** | a frozen lesson's slot read as vacant → re-inserted | slot consumption, §5.6 |
| **Hard delete is irreversible** | no soft-delete, by design | Phase 1 snapshot |

### Behavioural

| Risk | Why |
|---|---|
| **Reports and parent-facing figures shift** | any month whose lesson count changes republishes different numbers; only future months may move |
| **Notifications** (future sprint) | retiring a lesson someone was notified about needs a rule; none exists yet |
| **Archive semantics** | archiving erases historical revenue — pre-existing, **out of Sprint 5.6 scope**, tracked in §9.1. ADR-002 keeps Sprint 5.6 from adding a second destructive effect to the same operation before that is settled |
| **Archived classes keep stale future lessons** | the price of ADR-002: lessons generated before the archive stay on the Calendar and Lesson List until they age out of the window, and per §9.2 never advance past `Upcoming`. Presentational, not destructive — and reversible, which the alternative is not. Live instances are `B2` (166) and `asd` (12), both development data slated for manual deletion |
| **Status never advances** (§1.5) | against a real clock nothing becomes `Completed` and revenue stays zero — same engine, but **out of Sprint 5.6 scope**, tracked in §9.2 |
| **Calendar and drag-drop** | the reconciler writes `start`/`duration` on future lessons; a lesson could move under a teacher mid-drag. Reconciling on the write side (§5.7) narrows this window |

### Technical

| Risk | Why |
|---|---|
| **Lesson ids must not change** | three collections reference them with no cascade; the design keeps the format and stops parsing it |
| **API compatibility** | `GET /api/lessons` shape is unchanged; `DELETE` keeps its `regular_not_deletable` guard — the reconciler's delete is service-internal only |
| **Concurrency** | ensure runs on every read; adding updates and deletes introduces write contention the current duplicate-key tolerance does not cover |
| **Performance** | reconciliation must read the window's lessons, not just write; §5.7 moves the expensive path off the hot read |
| **Schedule editor has no stable slot identity** | `useFieldArray` identifies a slot by array position; `field.id` is regenerated per mount and never persisted. Any design requiring a persisted `slotKey` must fix the editor first — including its "Use same time" path, which rebuilds every row via `replace()`. **This is why the chosen design deliberately avoids needing one.** |

---

## 8. Sprint 5.6 breakdown

Sequenced so that each stage is independently shippable and reversible.

### 5.6.0 — Prerequisites — **delivered 2026-08-05, minus the back-fill**

Shipped as infrastructure only: the pure planner (`src/lib/recurrence.ts`), the
read-only dry run (`scripts/recurrence-report.ts`), and 24 scenario tests
(`tests/recurrence.test.ts`). The window / id / status helpers moved out of
`src/lib/lessons.ts` verbatim so the planner and the live generator cannot drift;
`ensureRegularLessons` is byte-for-byte unchanged.

**The Phase 0 back-fill was NOT performed** — it is a database write, and 5.6.0 was
scoped to zero writes. It is reported instead, by `findLegacyReschedules`, and the
planner's `legacyOriginFallback` makes the reconciler safe without it. It remains
mandatory before any write phase; see §6 Phase 0 for the revised justification.

### 5.6.1 — Report-only reconciliation — **delivered 2026-08-06**

As specified: the algorithm in §5 in **report-only mode**, emitting the updates,
inserts and retirements it *would* perform and executing none of them. No behaviour
change shipped.

Exit criterion — "its output is understood line by line, including the orphans that
sit alone on their date and the existing detector cannot see" — **met**. Results in
§1.6, diff against the detector in §6 Phase 3. The census correction (37 alone, 13 of
them actionable) and ADR-002 both came out of this run.

### 5.6.2 — Write reconciliation (~1 day)

Wire the reconciler into the write side: **`updateClass` only.** Archive and restore
are no longer reconciliation triggers (ADR-002) — archiving keeps its existing
behaviour of stopping generation and nothing more, which is already what the code
does, so this is a scope *reduction*. Block class deletion when history exists and
make Archive the supported path (§2). Keep the read-side top-up insert-only (§5.7).
Still report-only for the retire verb.

Implements §5.9 as its own change: `notes` blocks retire, permits update, and pairing
prefers the protected lesson. No new field, and `classroom` is not consulted.

### 5.6.3 — Migration (~1 day, gated on sign-off) — **prepared 2026-08-06, not applied**

Snapshot, baseline every past month's figures, dry run, apply, verify (§6 Phases
1–5). No special handling for the development test classes — they are removed
manually and are not a migration concern.

**Tooling delivered; no database has been written.** The snapshot and baseline are
`npm run lessons:snapshot` (§6 Phases 1–2, files only), the verification is
`src/lib/migration.ts` + `npm run lessons:migration-report` (deterministic — no
wall clock, every list sorted, one sha256 to compare runs), and the Phase 0 apply
is gated behind a snapshot whose lessons digest still matches the live collection.
`RETIRE_ENABLED` stays `false` and no destructive cleanup runs automatically. The
operating procedure, the rollback and the remaining blockers are
`MIGRATION_PHASE0.md`.

Measured 2026-08-06, all read-only: 11 legacy reschedules, all 11 verified as
genuine moves, 3 load-bearing; the plan is **identical** with the origins stored
and `legacyOriginFallback` off, which is what makes the fallback removable; 142
planned retirements, all 142 independently corroborated against the class
schedules, 1 of them alone on its date; zero write actions touching a protected
lesson.

### 5.6.4 Phase 0 — apply the migration — **delivered 2026-08-10**

Executed `MIGRATION_PHASE0.md` end to end against the live database: baseline
verification green, snapshot taken, cross-checked against the independent detector,
the back-fill applied to all **11** lessons, post-apply verification `PASS` with
**zero** collateral, and the Phase 2 baseline **bit-identical** before and after —
every month, not only the five past ones. `legacyOriginFallback` was then removed
as its own change, and the migration report proves it altered no decision: the plan
is byte-identical across all three runs (keep 257, update 0, insert 0, retire 142,
strand 0, skip 4).

Scope held exactly: **`RETIRE_ENABLED` stays `false`**, retirement is unimplemented,
no orphan was cleaned up, no schema field was added and no business rule outside
Phase 0 was touched. Digests and counts are in `MIGRATION_PHASE0.md`.

### 5.6.4B — Enable + Regression (~1 day)

Flip the reconciler from report-only to enforcing. Blast radius is small because
5.6.3 has already cleared the backlog.

**Scenario tests** — every row of §2's table: change start / change duration / change
weekday / delete a weekday / add a weekday / archive / restore /
delete-with-history (must be blocked) / cancel / reschedule / extra / makeup. Plus
the two subtle cases that no §2 row states directly:

- a **cancelled** lesson's slot must not re-fill on the next read (§5.6);
- a **rescheduled** lesson must survive a subsequent schedule edit untouched;
- a lesson carrying **notes** must never be retired, **must still be corrected in
  place** when its slot moves, and must keep both its id and its note across that
  correction (§5.9);
- where a plain and a noted lesson compete for one surviving slot, the **noted one**
  takes it and the plain one retires (§5.2 step 5);
- a noted lesson whose weekday is dropped must be reported as **stranded**, not
  deleted and not silently left unreported.

These exist as of 5.6.0 in `tests/recurrence.test.ts` and run against the planner;
5.6.4 re-points them at the enforcing path. The archive case now asserts the opposite
of what it originally would have — an Archived class must produce **no actions at
all** (ADR-002).

**Regression** — revenue, teaching hours and attendance rate identical for every past
month; Calendar, Lesson List, drawer, Class Details and Dashboard unchanged for
untouched lessons; drag-and-drop reschedule still round-trips;
`npm run lessons:duplicates` reports zero forked groups.

---

## 9. Technical debt — explicitly NOT Sprint 5.6

Both items below live in the same engine as the fork defect and were surfaced by this
investigation. Neither is caused by it, neither blocks it, and neither is in scope.
They are recorded here so they are not rediscovered later as new bugs.

### 9.1 Archived classes erase historical revenue — recommend **Sprint 5.5.3**

`computeRevenue` (`src/lib/finance.ts`) opens with:

```
for (const c of classes) {
  if (c.status === "Archived") continue;
```

Archiving a class therefore removes it from **every** month's revenue, including
months already closed, already reported, and already shown to a parent. The same
class's teaching hours and attendance rate are unaffected, because those iterate
lessons rather than classes — so archiving makes the three figures disagree with one
another.

This contradicts the "past is immutable" principle in §4 as directly as the fork
defect does, but by a completely different route: nothing is written, a filter simply
stops reading. That is why it cannot be fixed by the reconciler and needs its own
sprint.

The likely shape of the fix — to be designed, not assumed here — is that `Archived`
should suppress *future* participation only, and historical months should continue to
count a class that was Active while those lessons were taught. That requires deciding
what "was Active at the time" means, since class status is a single mutable field
with no history.

**Recommended as Sprint 5.5.3.** *(Note: the 5.5.3 label was already used for the
Lesson List pagination + duplicate-detection sprint. Renumber if that collision
matters — the sequencing intent is "before 5.6, independent of it".)*

### 9.2 Lesson status never advances with time — not scheduled

`statusForDate()` is evaluated once, at insert, and stored. Nothing in the codebase
transitions a lesson from `Upcoming` to `Completed` as its date passes: `cancelLesson`
writes `Cancelled`, `updateLesson` touches only notes and classroom, and the
reconciler designed here deliberately never writes status.

This is invisible today solely because the app clock is frozen at `2026-07-10`
(`TODAY_ISO`). Against a real clock every lesson would remain `Upcoming` for ever,
and since revenue counts only `Completed` lessons, **reported revenue would stay at
zero permanently**.

Deliberately excluded from Sprint 5.6: a status transition is a write to lessons
crossing from future into past, which is precisely the boundary Sprint 5.6 promises
never to cross. Mixing the two would make the "no past lesson is ever written"
guarantee untestable. It needs its own design — most likely a scheduled job or a
read-time derivation, which are materially different choices.

---

## 10. Future improvements

Optional, additive, and **not part of Sprint 5.6**. Each layers on top of the
approved design without altering it.

### 10.1 `scheduleVersion`

**The idea.** Add a monotonic `scheduleVersion` to `Klass`, incremented whenever
`Class.schedule` changes. Stamp the value that produced a lesson onto that lesson as
`generatedFromScheduleVersion`. Optionally keep a small append-only log of revisions
(`version`, `changedAt`, the schedule as it then stood).

**Why it is worth having later:**

- **Debugging.** Reconstructing what happened to `c4` in Sprint 5.5.2 required
  forensics: comparing the seed's schedule against the database's, measuring each
  series' date span against the seed and ensure windows, and counting which lessons
  carried a `chargeable` field to tell the two generators apart. With a version stamp
  that entire investigation is one query — *which schedule revision produced this
  lesson?* — answered exactly rather than inferred.
- **Reconciliation visibility.** The reconciler could report *why* it is acting:
  "these 12 lessons were generated from version 1; the class is on version 2." That
  turns the report-only output of 5.6.1 from a list of intended writes into an
  explanation. It also gives a cheap fast path — a class whose window lessons all
  carry the current version needs no field-by-field comparison at all.
- **Future migrations.** A migration could target "lessons generated from version
  < N" precisely. The approved design infers orphan-ness by comparing each lesson
  against the schedule *as it stands now*, which is lossy: if a schedule is edited
  twice, both stale series look identical and there is no way to tell which edit came
  first (already noted as a known gap in `LESSON_DUPLICATES.md` §5).

**Why it is deliberately excluded from 5.6:**

- It requires schema changes to two collections plus a back-fill, and every existing
  lesson would carry an unknown version — so the first migration using it still needs
  the value-comparison fallback the approved design already provides.
- The approved design is **correct without it**. Version would be an accelerator and
  an audit trail, never the decision input; reconciliation still compares desired
  against actual fields.
- Adding schema surface during a data-integrity fix widens the blast radius of the
  one sprint that most needs a narrow one.

**How it stays compatible.** Purely additive metadata. The §5 algorithm is unchanged
byte for byte; the version is written as a side effect and not read. A later sprint
may promote it to a fast-path check, and only then does any logic depend on it. It
touches neither lesson identity nor the id.

### 10.2 `slotKey` on `ScheduleSlot`

Carried over from ADR-001's rejected alternative A. A persisted per-slot identity
would resolve the one weakness in the approved algorithm — the leftover-pairing
heuristic in §5.2 step 5, which is at its weakest for a class teaching several times
on one weekday. It is deferred because the schedule editor has no stable slot
identity today (`useFieldArray` keys by array position; `field.id` is regenerated per
mount and never persisted; the "Use same time" path rebuilds every row through
`replace()`), and fixing that is a delicate change that should not sit on the critical
path of a data-integrity fix.

`scheduleVersion` and `slotKey` are independent; either can be adopted without the
other.

---

## ADR-001 — Reconcile on `(classId, date)` with in-place update; the lesson id becomes opaque

**Status:** proposed
**Date:** 2026-08-04
**Context:** editing a class's recurring schedule forks the lesson series, leaving an
orphan series that never retires. 366 orphaned Regular lessons exist across 5 classes.

### Decision

1. The Regular lesson id keeps its current format but becomes an **opaque primary
   key** — never parsed, never used to infer a date or time, never used as the
   reconciliation key.
2. Reconciliation keys on **`(classId, date)`** and compares `start`/`duration` as
   fields.
3. Slot edits **update the existing lesson in place**, preserving its id and
   everything that references it.
4. The reconciler gains three verbs it lacks today — update, insert, retire — all
   confined to lessons that are future, `Upcoming`, unattended and unmoved.
5. Reconciliation is driven primarily from the **write** side; the read side keeps a
   cheap insert-only window top-up.

### Alternatives considered

**A. Add a persisted `slotKey` to `ScheduleSlot` and key on it.**
Unambiguous, and the natural answer for a class teaching several times on one day.
Rejected as the *first* step: it requires the schedule editor to preserve keys across
every edit path, and that editor identifies slots by array position with no persisted
identity — its "Use same time" mode rebuilds every row via `replace()`. It also needs
a schema change and a back-fill for existing classes. That is a large, delicate change
sitting on the critical path of a data-integrity fix. It remains a sound **Phase 2**
enhancement once the bleeding has stopped. *(This revises the recommendation in
`LESSON_DUPLICATES.md` §4a, which proposed `slotKey` first; the editor's lack of
stable slot identity makes the value-based approach the safer starting point.)*

**B. Retire and re-create instead of updating in place.**
Simpler — no pairing heuristic. Rejected because it changes a future lesson's id on
every schedule edit, discarding per-lesson notes and classroom overrides and breaking
any homework link, for no gain.

**C. Keep the time-derived id and delete the old series on schedule change.**
Rejected: it leaves the id doing double duty as data and key, so the next mutable
value embedded in an id reintroduces the same class of bug. It also cannot express a
duration-only edit, which does not change the id at all.

**D. Do nothing; clean up the data periodically.**
Rejected: the fork recurs on every schedule edit, so the cleanup is unbounded and
manual.

### Why this is safer than the current engine

- **It can see what it created.** The current engine only walks schedule → lessons
  and has no verb but *create*, so a lesson whose slot disappears is unreachable
  forever. Adding the reverse pass is what makes orphans impossible rather than
  merely detectable.
- **It removes mutable data from the key.** Ids stop encoding facts that change, so
  editing a schedule can no longer mint a parallel identity space.
- **It fails closed.** Every protection is a filter on the candidate set — status,
  date, attendance, origin, homework — not a rule someone has to remember. A lesson
  is excluded unless it positively proves it is safe to touch.
- **Past figures cannot move.** The `date >= app clock` filter makes retroactive
  revenue, teaching-hours and attendance changes structurally impossible, and
  Phase 2/5 verifies it empirically rather than by argument.
- **It needs no schema change and no editor change to be correct**, which keeps the
  fix off the critical path of the most delicate component in the module.

### Consequences

- Ensure becomes a read-then-write operation; the expensive path moves to the write
  side to keep list reads cheap.
- A hard delete with no undo enters the codebase, guarded and service-internal, which
  makes the Phase 1 snapshot mandatory.
- The leftover-pairing rule in §5.2 step 5 is a heuristic. It decides only *which
  surviving id* carries which time when a day's slots change — the resulting set of
  lessons is identical either way — so the stakes are low, but it should be
  documented where it lives rather than inferred.
- `slotKey` (alternative A) remains open as a follow-up for classes teaching several
  times on one weekday, where the pairing heuristic is at its weakest — see §10.2.
- Reconciliation carries no record of *which* schedule revision produced a lesson, so
  two successive schedule edits leave indistinguishable stale series. Accepted for
  now; `scheduleVersion` (§10.1) is the additive remedy when it starts to hurt.
- Archive becomes the only supported way to retire a class with history (§2), which
  makes §9.1 — archiving erasing that class's historical revenue — more visible, not
  less. Sequencing §9.1 before Sprint 5.6 is therefore preferable, though not a
  blocking dependency: the two changes touch different code and different data.

---

## ADR-002 — A class without live intent is outside reconciliation

**Status:** proposed
**Date:** 2026-08-06
**Supersedes:** the `Archive class` row of §2 and the "or is Archived" clause of §5.2
step 1, both as originally written.
**Context:** the Sprint 5.6.1 dry run (§1.6). 176 of 318 planned retirements — 55% —
came from two Archived classes rather than from any forked series, and a further 18
lessons belong to a class that no longer exists at all.

### Decision

1. **Archived classes are not reconciled.** They are excluded before the algorithm
   begins, not filtered inside it. No update, no insert, no retire.
2. **Lessons whose class was deleted are not reconciled**, for the same structural
   reason: there is no schedule to compare against.
3. Both remain **reported** by `npm run lessons:reconcile`.
4. Retiring an Archived class's future lessons, if it is wanted, is a one-shot action
   belonging to the archive *transition* — a separate sprint, sequenced behind §9.1.
5. Consequently the only reconciliation trigger on the write side is `updateClass`.

### Rationale

**A fossil schedule is not intent.** The algorithm's whole premise (§2) is *edit
intent → reconcile future facts*. An Archived class has withdrawn its intent; its
schedule records what it used to do. Feeding that to a comparison whose job is to find
disagreements produces a desired set of `[]`, at which point every future lesson is an
orphan **by definition rather than by evidence**. The output looks like reconciliation
and is really a bulk delete — one class-level decision, taken once by a human, re-expressed
as 176 independent per-lesson deletions each carrying its own hard delete.

**It fails open, in a design that is supposed to fail closed.** Every other protection
in §6 Phase 4 is a filter that *excludes* a lesson unless it proves itself safe.
Class status worked the other way: a single field flipping on one document put every
future lesson of that class into the delete set. That is precisely the shape of bug
this sprint exists to remove, and it would have entered through the fix.

**The report becomes readable.** 318 retirements fall to 142. `c4`'s 12 genuine
orphans go from 3.8% of the plan to 8.5%, and everything remaining shares one cause —
a forked series — so a reviewer checks one kind of thing. 5.6.1's exit criterion is
"the output is understood line by line"; 55% of it being a single decision repeated
made that harder for no gain.

**The migration shrinks and stays uniform.** 176 hard deletes leave 5.6.3, 164 of them
on `B2`, which §6 already excludes from migration as development data. The migration
then touches only lessons orphaned by a schedule edit — one cause, one justification,
one rollback story.

**Archive stops being lossy.** The retired rule deleted future lessons on archive and
regenerated them on restore, discarding per-lesson notes, classroom overrides and
homework links in between — the very things ADR-001's in-place update exists to
preserve. Users read Archive as reversible because it is a status, not a deletion.
Making it destroy data contradicts that, and it does so on the operation §2 now
mandates as the *only* way to retire a class with history.

**Maintenance.** The reconciler keeps one input and one trigger. Nobody reading it
later has to hold "…except when status is Archived, in which case it deletes
everything" in their head, and no future status value can acquire delete semantics by
accident.

### What this costs

Future Upcoming lessons generated before a class was archived stay where they are.
They keep appearing on the Calendar and Lesson List until they age out of the rolling
window, and per §9.2 they never advance past `Upcoming`, so they linger as permanently
"upcoming" past sessions. That is a real wart. It is presentational, it is reversible,
and it is bounded — generation already stops at archive, so the set never grows. The
two live instances are `B2` (166 lessons) and `asd` (12), both development data due to
be deleted by hand, so today's practical cost is zero.

The alternative — deleting them — is unbounded in the sense that matters: it cannot be
undone.

### Alternatives considered

**A. Keep the original rule (archive retires future lessons during reconciliation).**
Rejected: the reasons above, chiefly that it lets class status mass-delete through a
code path designed to fail closed.

**B. Retire on the archive transition, inside Sprint 5.6.2.** The likely eventual
answer, and not rejected on merit — deferred. It is a destructive class-level
operation with a 166-lesson blast radius on one class, it is entangled with §9.1, and
it needs a restore story. None of that is needed to fix the fork defect, which is what
Sprint 5.6 is for.

**C. Hide an Archived class's future lessons at read time instead of deleting them.**
Rejected for Sprint 5.6: it is a UI behaviour change (PROJECT_RULES requires a design
before new UI behaviour), and it puts a status filter on every read — the same cost
§5.3 rejected soft-delete flags for. Worth revisiting alongside option B.

### Consequences

- §5.8 states the exclusion; §5.2 step 1 no longer mentions Archived.
- 5.6.2 shrinks: `updateClass` is the only write-side trigger.
- 5.6.4's archive scenario test asserts *no actions*, the opposite of the original.
- The 18 classless lessons need their own decision, with two facts established first
  (§6, "Not in scope — lessons whose class was deleted").
- §9.1 becomes more clearly the next thing to settle: archive's semantics are now
  known to be wrong in one direction (revenue) and deliberately incomplete in another
  (future lessons).
