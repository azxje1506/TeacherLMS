# Duplicate Regular Lessons — cause, constraints, and the migration to come

Written during Sprint 5.5.3. **Nothing described here has been fixed or migrated.**
This document exists so the migration can be written later without re-deriving any
of it.

Detection tool: `npm run lessons:duplicates` (add `-- --json` for machine output).
It is read-only — `find()` queries only — and safe against production.

---

## 1. Why duplicates happen

A class owns a recurring weekly schedule: an array of `{ day, start, duration }`
slots. Regular lessons are materialised from those slots by
`ensureRegularLessons()` in `src/lib/lessons.ts`, which runs on every lesson list
read and creates whatever is missing inside a rolling window
(`CURRENT_MONTH − LESSON_WINDOW_PREVIOUS_MONTHS … + LESSON_WINDOW_NEXT_MONTHS`).

The generated lesson's identity is:

```
L-<classId>-<date>-<HHMM>        // src/lib/lessons.ts — regularId()
```

**The slot's start time is part of the identity.** That is the whole bug.

A teacher edits a class from `Tuesday 14:30` to `Tuesday 10:08` and saves.
`updateClass()` writes the new schedule and reconciles no lessons — it has no
reason to know lessons exist. On the next read, ensure walks the window and, for
each Tuesday, computes the id `L-c4-<date>-1008`. Nothing exists at that id, so
it inserts. The old `L-c4-<date>-1430` lesson is not examined, not updated and
not removed, because nothing in ensure ever looks for lessons that *should no
longer exist*.

The recurring series has forked. Both halves keep extending forward every time
ensure runs, and the class now appears twice on every Tuesday, at two times.

Observed in the live data:

```
c4 "Emma Chen · 1-on-1", schedule = [{ day: 2, start: "10:08", duration: 45 }]

  series @ 14:30 : 35 lessons, 2026-02-03 .. 2026-09-29   (starts in the SEED window)
  series @ 10:08 : 18 lessons, 2026-06-02 .. 2026-09-29   (starts at the ENSURE window's lower bound)
```

The date spans identify which generator wrote which half: the seed
(`src/lib/generate.ts`) covers `2026-02 … 2026-07`, the runtime ensure covers
`2026-06 … 2026-09`. The `14:30` half reaches back to February, so it predates
the schedule edit.

### This is not a rendering bug

Verified end-to-end in Sprint 5.5.2 against the running app. For
`L-c4-2026-07-14-1430`, the Calendar card, the Calendar drawer and Lesson Details
all render `02:30 PM – 03:15 PM` from `lesson.start` + `lesson.duration` through
the single shared `timeRange()` formatter. Every surface agrees. There are simply
two lesson records on that date, and each renders its own time correctly.

### What is *not* a duplicate

Two things look like forks and are not:

- **A class that legitimately teaches several times on one day.** Class `asd`
  runs Monday at 07:00, 08:00 and 20:30. Three lessons on one date, all correct.
  The detector marks each `KEEP` because each matches a current slot.
- **A rescheduled lesson that landed on an occupied day.** The lesson's `date`
  changed but its id still encodes the date it was generated for, so the id and
  the date disagree. That is a teacher's decision and must never be proposed for
  deletion. The detector marks these `RESCHEDULED` and lists them separately.

---

## 2. Where `ensureRegularLessons` forks

`src/lib/lessons.ts`:

```ts
function regularId(classId: string, date: string, start: string): string {
  return `L-${classId}-${date}-${start.replace(":", "")}`;   // <-- start is in the identity
}

export async function ensureRegularLessons(): Promise<void> {
  const classes = await ClassModel.find({ status: { $ne: "Archived" } })…;
  for (const c of classes)
    for (const month of windowMonths())
      for (const slot of c.schedule ?? [])
        for (const date of datesForWeekday(month, slot.day)) {
          const id = regularId(c.id, date, slot.start);
          ops.push({ updateOne: {
            filter: { id },
            update: { $setOnInsert: { … } },   // <-- only ever inserts
            upsert: true,
          }});
        }
  await LessonModel.bulkWrite(ops, { ordered: false });
}
```

Two properties combine to cause the fork:

1. **`regularId` is time-derived.** Change `slot.start` and every date in the
   window maps to a new id.
2. **`$setOnInsert` is insert-only, by design.** The service is documented as
   never mutating an existing lesson, which is what protects cancelled,
   rescheduled and manually-edited lessons from being overwritten on every read.
   The same property means it can never *correct* a lesson either.

There is also no reverse pass: nothing enumerates the lessons a class already has
and asks whether the schedule still justifies them. Ensure only walks
schedule → lessons, never lessons → schedule.

A duration-only edit is the quiet variant of the same bug: the id does not change,
`$setOnInsert` skips, and the lesson silently keeps its old duration. No duplicate
appears — just a wrong end time. Not currently present in the data, same root
cause.

---

## 3. Why the lesson id cannot change

Three collections reference a lesson by its string id, and none of them has a
foreign-key constraint or a cascade:

| Reference | Where | Consequence of renumbering |
|---|---|---|
| `AttendanceRecord.lessonId` | `src/lib/models.ts`, unique index | Attendance is orphaned; the lesson shows no register. 151 records today. |
| `Homework.lessonId` | `src/lib/models.ts` | Homework detaches from its lesson. |
| `Lesson.fromId` | a Makeup points at the Cancelled Regular it replaces | The makeup's origin link dangles; `createMakeupLesson`'s invariants no longer hold. |

Billing does not reference a lesson id directly, but it is affected just as
badly by *deletion*. Per `PROJECT_RULES.md`:

> Per-lesson value = monthly fee ÷ number of **regular** lessons scheduled that
> month (fixed baseline that does NOT shrink when lessons are cancelled).

So the count of Regular lessons in a month is the denominator of revenue for that
month. Deleting a past Regular lesson silently rewrites historical revenue for
every student in that class. `computeRevenue` in `src/lib/finance.ts` recomputes
from the collection on every read — there is no stored snapshot to protect the
old figures.

**Therefore: a migration may not renumber ids, and may not delete or alter any
lesson dated before the app clock.**

---

## 4. What a future migration should do

Split into two independent pieces. The code change is safe and reversible; the
data change is neither and needs explicit sign-off.

### 4a. Code — give a Regular lesson a time-independent slot identity

- Add a stable `slotKey` to `ScheduleSlot`, generated when a slot is created and
  **preserved across edits** by the schedule editor (the editor currently
  identifies a slot by its position in a sorted array, which is not stable — this
  is the real work).
- Store that `slotKey` on the generated lesson.
- Reconcile on `(classId, date, slotKey)` instead of on the id: update `start` /
  `duration` in place when the slot moved, insert what is missing, retire what no
  longer has a slot.
- **Keep the id string exactly as it is** (see §3). The id becomes an opaque
  primary key rather than a derived value — new lessons can keep the same format.
- Scope every in-place update to lessons dated **on or after the app clock**, and
  skip any lesson that is `Cancelled` or carries `originalDate` (a deliberate
  reschedule must not be dragged back onto the schedule).
- Call the reconcile from `updateClass()` so the calendar is correct the moment a
  schedule is saved, not on the next read.
- Consider the cost: ensure runs on every list read. Turning it from insert-only
  into a reconcile makes a hot path more expensive and adds update contention
  between concurrent reads, which the current duplicate-key tolerance does not
  cover.

### 4b. Data — retire the orphans that already exist

Driven by `npm run lessons:duplicates -- --json`. Only lessons the report marks
`CANDIDATE` **with an empty `protections` array** may be touched. The report's
protections are exactly the §3 constraints, encoded:

- `past lesson (drives revenue for its month)` — before the app clock
- `has an attendance record`
- `cancelled (a makeup may reference it via fromId)`

Live counts at the time of writing:

```
Forked class+date groups .................. 312
Lessons marked CANDIDATE .................. 330
  ...of which PROTECTED (never delete) .... 106
  ...of which safely removable ............ 224
Lessons marked RESCHEDULED (never touch) .. 3

Per affected class:
  asda                (6a683d57376b4e471a458dd4)  candidates=140  removable=95
  B2                  (6a696a289322ca3ad755f039)  candidates=120  removable=82
  TEst                (6a683ce8376b4e471a458dce)  candidates=34   removable=23
  asd                 (6a683d64376b4e471a458dd6)  candidates=18   removable=12
  Emma Chen · 1-on-1  (c4)                        candidates=18   removable=12
```

Four of the five affected classes (`asda`, `B2`, `TEst`, `asd`) are throwaway
classes created while building the schedule editor. Deleting those classes and
their lessons outright removes ~92% of the candidates and leaves `c4` as the only
genuine reconciliation. That is likely the cheapest first move, and it is a
product decision, not a technical one.

Order of operations: ship 4a first. Running 4b while the generator still forks
means the orphans come back the next time someone edits a schedule.

---

## 5. Known gaps in the detection tool

- **It only reports dates holding two or more Regular lessons**, which is the
  brief's definition of a duplicate. An orphaned lesson that is *alone* on its
  date — because the class no longer teaches that weekday at all — is invisible
  to it. Measured against the live data: **366 orphaned Regular lessons exist,
  330 are reported, 36 are alone on their date and are not.** A migration must
  query for those separately.
- It does not inspect Homework references. `Homework.lessonId` is nullable and
  unused by the current UI, so no lesson in the data has one, but a future
  migration should add it to the protection checks.
- It classifies against the class's schedule *as it stands now*. If a schedule is
  edited twice, both older series appear as candidates, which is correct, but
  there is no way to tell from the data which edit came first.
