# Changelog

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