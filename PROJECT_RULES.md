# Non-negotiable Rules

These rules override all implementation decisions.

- The imported Claude Design is the single source of truth.
- Never redesign existing UI.
- Never improve visual design unless explicitly requested.
- Never change spacing, typography, colors, icons or layout.
- Never replace existing components.
- Never rename routes, folders or components without permission.
- Never refactor working features.
- Never modify Login, Dashboard, Authentication or Database unless explicitly requested.
- If a requested feature requires changing existing working functionality, STOP and ask for confirmation first.

## Missing UI Specification

If the imported Claude Design does not contain a UI element
(e.g. pagination, sortable headers, bulk actions, filters, dialogs),

DO NOT invent one.

Implement the underlying business logic and API only.

Wait until a corresponding design exists before exposing new UI.

## Cross-module Screens

Some screens contain UI for multiple modules.

Only implement the parts owned by the current sprint.

Keep the full layout and navigation exactly as designed.

Future-module sections must render their designed placeholder state until their corresponding sprint.

Do not implement future business logic early.

# English Tutor LMS — Project Rules

Single Design Component: `English Tutor LMS.dc.html`. Keep everything in that one DC (state-driven routing, right-side drawer for create/edit, center dialog for confirms, toast helper). Do not split into child DCs. Implement functionality only. Do not reinterpret or redesign the imported UI. Pixel fidelity is required.

Today (app clock) = **2026-07-10**. Currency = **VND**, formatted `1,500,000đ`.

## Tuition & Revenue
- All tuition fees are entered in **VND** and displayed as a **Monthly Fee (VND/month)**.
- Revenue is calculated **monthly**.
- A lesson contributes to a month based on the month it is **actually completed** (rescheduled/makeup/extra lessons land in the month they're taught, by their date).
- **Completed** lessons contribute to revenue (Regular, Makeup, Extra).
- **Cancelled** lessons are excluded **unless marked chargeable**.
- **Uncompleted / upcoming** lessons are excluded.
- Per-lesson value = monthly fee ÷ number of **regular** lessons scheduled that month (fixed baseline that does NOT shrink when lessons are cancelled). Attendance reduces the amount (Absent students don't count); Extra lessons add on top of the monthly fee.
- Revenue Dashboard should show: Revenue by Class, by Student, by Month, by Lesson Type.

## Student & Parents
A Student may temporarily have no Parent assigned.

Parent assignment is optional during Student creation.

However, features that require parent communication
(finance, reports, notifications, reviews)
must clearly indicate when a Student has no linked Parent.

## Parent

Required

- Full Name
- Relationship
- Phone Number

Optional

- Email
- Notes

Relationship options

- Mother
- Father
- Guardian
- Grandparent
- Other

Rules
- One Parent may have multiple Students.
- A Student may have zero or one linked Parent.
- Parent is the source of truth.
- New features must reference Parent by parentId instead of introducing additional duplicated fields.
- Existing legacy fields may remain until a dedicated refactoring sprint.
- Student references Parent by ID only.
- Deleting a Parent must never delete Students.
- Students become Unassigned if their linked Parent is removed.

## Class

Required
- Name
- Monthly Tuition Fee
- Weekly Schedule

Optional
- Level
- Classroom
- Notes

## Class Status

Every Class has a status: **Active**, **Ended** or **Archived**. Status governs future scheduling only — it never changes what a class has already taught.

- **Active** — teaching now. Generates Regular lessons and holds its weekly slots against other classes.
- **Ended** — the teaching is over. Generation stops, the weekly slots are released, and the not-yet-taught Regular lessons the class still held are cleared once, on the transition, from next month onward. The current month is deliberately left alone so that month's revenue baseline does not move. Everything already taught is untouched.
- **Archived** — filed away, and reversible. Generation stops and the weekly slots are released, but existing lessons stay exactly where they are. The class can be restored at any time.

Ended and Archived are never interchangeable: **Ended is a statement about the teaching, Archived is a statement about the working list.**

**Changing a class's status settles its due lessons first.** Applicable lessons are resolved while the old status is still in effect, and only then does the status change. This is what makes Archive → Restore deterministic (see Lesson Lifecycle).

**Restore** returns a class to Active and resumes forward scheduling. It never reverses a lesson that was already settled: a lesson Cancelled while the class was Archived stays Cancelled, because that session did not take place. Lessons that had not yet fallen due are unaffected and resume as scheduled. Lessons are never re-created for dates that passed while the class was Archived.

Revenue is derived from lessons, never from a class's current status. Ending or archiving a class does not change any month's reported revenue.

## Lesson Types
Three types, each supports attendance (Present / Absent / Late / Excused). Attendance always belongs to a **Lesson**, never directly to a Class.
1. **Regular** — auto-generated from the class's recurring weekly schedule.
2. **Makeup** — Group classes only. Created to replace a **cancelled** regular lesson. Linked to the original class. Shows in calendar; counted in attendance + revenue.
3. **Extra** — One-on-One classes only. Additional session outside the regular schedule, any date/time. Belongs to the class. Shows in calendar; attendance tracked; counted in revenue. Can be rescheduled/cancelled independently.

Rules by class type:
- **Group**: fixed recurring schedule, students share it. No Extra lessons. Makeup allowed (only when a regular lesson is cancelled).
- **One-on-One**: flexible. Extra lessons allowed anytime. No Makeup concept needed (reschedule instead).

## Lesson Lifecycle

A lesson's status is **Upcoming**, **Completed** or **Cancelled**.

**Delivery.** A scheduled lesson is considered delivered once its scheduled date has passed. Delivery does not require an attendance record; where none exists, every enrolled student is treated as present. Attendance refines the amount, it does not gate delivery. Cancelling is the only way to withhold revenue from a scheduled lesson (see Tuition & Revenue).

**Resolution.** When a Regular lesson's date passes, its outcome is settled once and stored:

- class **Active** → **Completed**
- class **Archived** → **Cancelled**, not chargeable
- class **Ended**, unrecognised, or no longer present → nothing is written

**Eligibility.** Only Regular lessons that are still Upcoming and whose date is before the app clock are ever resolved.

- A lesson dated exactly on the app clock is not past; it stays Upcoming.
- Future lessons are untouched.
- **Makeup** and **Extra** lessons are outside this transition entirely.
- Existing Completed and Cancelled lessons are never reprocessed or reclassified. An existing chargeable Cancelled lesson keeps its chargeable status.

**What resolution may change.** The lesson's status, plus `chargeable` when cancelling — nothing else. Date, time, duration, classroom, notes, links and reschedule origin are never touched. No lesson is created or deleted, so a month's Regular lesson count — the per-lesson revenue baseline — never moves.

**Repeatable.** Resolution is idempotent. A lesson is settled once and is no longer eligible afterwards, so running it again changes nothing.

**Rescheduling does not change status.** Moving a lesson moves the lesson; the rules above settle it afterwards, according to the class's status at the time it is settled.

**Generation is forward-only.** Regular lessons are only ever created for the app clock's date or later. Nothing is generated into the past, so a date that passed while a class was Archived is never back-filled.

Two items are deliberately **not** settled by these rules and remain open decisions:

- Moving an already Completed, or chargeable Cancelled, lesson across a month boundary shifts a closed month's reported figures.
- Historical lesson records known to be inaccurate are intentionally outside this mechanism, which only ever touches Upcoming lessons. Their cleanup is a separate decision.

Engine detail and rationale: `RECURRENCE_DESIGN.md`.

## Calendar
Events display a lesson-type badge: **Regular / Makeup / Extra**, plus attendance status indicator for past lessons. Clicking a lesson opens the drawer (never navigates away). Drag-and-drop reschedules.

# Current Milestone

Stable production foundation completed.

Working:

- Login
- Dashboard
- MongoDB
- JWT
- Vercel Deployment

These must NEVER be broken.

---

Current Priority

1. Students

After Students:

2. Parents

3. Classes

4. Attendance

5. Homework

6. Reviews

7. Finance

8. Reports

9. Settings

Never skip priorities.

Never implement future modules early.

---

Definition of Done

A module is complete only when:

- UI matches Claude Design
- CRUD works
- Validation works
- Mobile works
- Production build succeeds

# Deployment Rules

Target platform:

- Vercel
- MongoDB Atlas

Do not introduce any other backend platform.

Do not introduce Render, Railway or Firebase.

Do not require Docker.

Do not require local services other than MongoDB Atlas.

# Coding Rules

Prefer extending existing code.

Avoid creating duplicate utilities.

Avoid duplicate components.

Prefer composition over replacement.

Keep code simple.

Avoid unnecessary abstractions.

Avoid large refactors.

# Testing Checklist

Every completed module must be manually verified:

- Desktop
- Mobile
- Dark Mode
- Refresh page
- Authentication
- CRUD
- Validation

Do not mark complete until all checks pass.

# Build Requirements

Before finishing any task, always ensure:

- npm run lint passes
- npm run build passes
- No TypeScript errors
- Existing pages still work
- Existing API routes still work
- Login still works
- Dashboard still works

Never finish with a failing build.