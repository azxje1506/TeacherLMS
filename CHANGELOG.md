# Changelog

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