# Recurrence Engine — Technical Design

**Status:** approved (2026-08-04) with adjustments; design only. Nothing in this
document has been implemented. No code was written, no database was modified, no
migration exists.

**Approved scope for Sprint 5.6** is §1–§8 and ADR-001. §9 (technical debt) and §10
(future improvements) are explicitly **outside** it.

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
| **Delete entire class** | **Blocked** whenever the class has any past lesson, attendance record, or billing record. **Archive is the only supported way to retire a class that has taught anything.** Today `deleteClass` removes only the Class row and leaves every lesson behind, orphaned: they render `className: "—"` and drop out of revenue silently, because `computeRevenue` iterates classes and a lesson whose class is gone is never visited. Hard delete survives only for a class that has never taught — no lessons at all, or future Upcoming ones only. |
| **Archive class** | Generation stops (already true). Future Upcoming Regular lessons are **retired** — they will not be taught. Past lessons remain untouched. *Archiving currently also erases the class's historical revenue; that is pre-existing behaviour and is **out of scope for Sprint 5.6** — see §9.1.* |
| **Restore class** | Future lessons are regenerated from the current schedule. Past lessons are already there and are not re-derived. |
| **Cancel one lesson** | The lesson stays `Cancelled` forever. The reconciler never resurrects it, never updates it, and never counts its slot as vacant. It remains excluded from revenue unless `chargeable`. |
| **Reschedule one lesson** | The lesson is **frozen against reconciliation** for good. Its stored origin (`originalDate` / `originalStart` / `originalDuration`) marks the slot it vacated as *satisfied*, so the reconciler does not regenerate a lesson on the original day. Editing the class schedule afterwards must not drag it back. |
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
   matches that date's weekday. Empty if the class no longer teaches that weekday,
   or is Archived.
2. **Actual set** — the Regular lessons already stored for that `(classId, date)`.
3. **Partition the actual set into frozen and reconcilable.** Frozen = anything not
   `Upcoming`, anything carrying a reschedule origin, anything with an attendance
   record. Frozen lessons are removed from consideration and **their slot is
   consumed** — see 5.6.
4. **Exact matches** — a reconcilable lesson whose `start` *and* `duration` equal a
   desired pair is already correct. Pair them off; neither side needs work.
5. **Update in place** — pair the leftovers on both sides, ordered by start time, and
   write the new `start` / `duration` onto the existing lesson. This is how a slot
   *edit* preserves the lesson's id, notes, classroom override and homework link.
6. **Insert** — any desired pair still unmatched becomes a new lesson.
7. **Retire** — any reconcilable lesson still unmatched has no slot backing it and is
   deleted.

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

**Critical dependency:** this test only works for moves made after Sprint 5.5
introduced the origin fields. The live database contains **11 legacy moves with no
`originalDate`**, detectable only because the date embedded in their id no longer
matches their `date` field. Under the new design the id is opaque and no longer
consulted — so those 11 lessons would be invisible as reschedules and **retired as
orphans**. The back-fill in §6 is therefore a hard prerequisite, not a nicety.

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

Proposal: drive reconciliation from the **write** side — `updateClass`, archive,
restore, delete — where the intent actually changes, and keep a cheap insert-only
top-up on the read side to extend the rolling window forward. This also fixes the
user-visible lag where a schedule edit is only corrected on the next list read.

---

## 6. Migration strategy

The reconciler, once shipped, retires future orphans by itself. A one-time migration
is therefore needed for **one** thing only — and that thing must run **first**.

### Phase 0 — back-fill legacy reschedule origins (**mandatory, blocking**)

Write `originalDate` / `originalStart` / `originalDuration` onto the 11 lessons whose
id-encoded date disagrees with their stored `date`. Additive: no existing field
changes, no id changes, no status changes.

**This must be deployed and verified before the reconciler ships.** Without it the
reconciler deletes 11 deliberately rescheduled lessons on its first run. This is the
single highest-risk ordering constraint in the whole plan.

### Phase 1 — snapshot

Full export of `lessons`, `attendances`, `billings`, `homeworks`. Non-negotiable: the
retire step is a hard delete with no undo.

### Phase 2 — baseline the reported figures

Record revenue, teaching hours and attendance rate for **every past month**, per
class and in total, before anything changes.

### Phase 3 — dry run

Run the reconciler in report-only mode. Diff its intended actions against
`npm run lessons:duplicates`. Investigate every disagreement — in particular, the
detector only reports dates holding **two or more** lessons, so the **36 orphans that
sit alone on their date** are invisible to it and will appear only in the
reconciler's output. They are legitimate retirements, but they must be recognised
rather than discovered in production.

### Phase 4 — apply, scoped

Only lessons that are: `type === "regular"`, `date >= app clock`, `status ===
"Upcoming"`, no attendance record, no reschedule origin, no homework reference.

Everything the goals list is protected by construction, not by care:

| Goal | Enforced by |
|---|---|
| never touch completed lessons | `status === "Upcoming"` filter |
| never touch attendance | attendance-record filter + no past lesson is in scope |
| never change historical revenue | `date >= app clock` — the denominator for past months cannot move |
| never change completed homework | homework-reference filter |
| never modify cancelled lessons | `status === "Upcoming"` filter |
| never modify rescheduled lessons | origin-field filter, made reliable by Phase 0 |

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

---

## 7. Risks

### Data integrity

| Risk | Why | Mitigation |
|---|---|---|
| **Legacy reschedules deleted** | 11 lessons have no origin fields; the opaque id can no longer identify them | Phase 0 back-fill, deployed and verified first. **Highest risk in the plan.** |
| **Historical revenue moves** | the per-lesson denominator is a live count of regular lessons per month | hard `date >= app clock` filter; Phase 2/5 before-and-after diff |
| **Orphaned attendance** | `attendances.lessonId` has no cascade | attendance-record filter; no past lesson in scope |
| **Broken makeup links** | `fromId` points at a Cancelled Regular | Cancelled lessons are never in scope |
| **Orphaned homework** | `homeworks.lessonId` is nullable, no cascade | homework-reference filter (currently vacuous — no lesson has one — but must exist) |
| **Cancellation resurrected** | a frozen lesson's slot read as vacant → re-inserted | slot consumption, §5.6 |
| **Hard delete is irreversible** | no soft-delete, by design | Phase 1 snapshot |

### Behavioural

| Risk | Why |
|---|---|
| **Reports and parent-facing figures shift** | any month whose lesson count changes republishes different numbers; only future months may move |
| **Notifications** (future sprint) | retiring a lesson someone was notified about needs a rule; none exists yet |
| **Archive semantics** | archiving erases historical revenue — pre-existing, **out of Sprint 5.6 scope**, tracked in §9.1 |
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

### 5.6.0 — Prerequisites (blocking, ~0.5 day)

Back-fill legacy reschedule origins (§6 Phase 0). Additive write: no deletions, no id
changes, no status changes. **Verify all 11 lessons carry an origin before anything
else merges.** Nothing in 5.6.1+ may land until this is deployed and confirmed.

### 5.6.1 — Report-only reconciliation (~2–3 days)

The algorithm in §5, behind a flag, in **report-only mode**: it emits the updates,
inserts and retirements it *would* perform and executes none of them. Reuses the
existing detector's output shape so the two can be diffed. No behaviour change ships.

Exit criterion: its output is understood line by line — including the **36 orphans
that sit alone on their date**, which the existing detector cannot see (§6 Phase 3).

### 5.6.2 — Write reconciliation (~1 day)

Wire the reconciler into the write side: `updateClass`, archive, restore. Block class
deletion when history exists and make Archive the supported path (§2). Keep the
read-side top-up insert-only (§5.7). Still report-only for the retire verb.

### 5.6.3 — Migration (~1 day, gated on sign-off)

Snapshot, baseline every past month's figures, dry run, apply, verify (§6 Phases
1–5). No special handling for the development test classes — they are removed
manually and are not a migration concern.

### 5.6.4 — Enable + Regression (~1 day)

Flip the reconciler from report-only to enforcing. Blast radius is small because
5.6.3 has already cleared the backlog.

**Scenario tests** — every row of §2's table: change start / change duration / change
weekday / delete a weekday / add a weekday / archive / restore /
delete-with-history (must be blocked) / cancel / reschedule / extra / makeup. Plus
the two subtle cases that no §2 row states directly:

- a **cancelled** lesson's slot must not re-fill on the next read (§5.6);
- a **rescheduled** lesson must survive a subsequent schedule edit untouched.

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
