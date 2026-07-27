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

## Lesson Types
Three types, each supports attendance (Present / Absent / Late / Excused). Attendance always belongs to a **Lesson**, never directly to a Class.
1. **Regular** — auto-generated from the class's recurring weekly schedule.
2. **Makeup** — Group classes only. Created to replace a **cancelled** regular lesson. Linked to the original class. Shows in calendar; counted in attendance + revenue.
3. **Extra** — One-on-One classes only. Additional session outside the regular schedule, any date/time. Belongs to the class. Shows in calendar; attendance tracked; counted in revenue. Can be rescheduled/cancelled independently.

Rules by class type:
- **Group**: fixed recurring schedule, students share it. No Extra lessons. Makeup allowed (only when a regular lesson is cancelled).
- **One-on-One**: flexible. Extra lessons allowed anytime. No Makeup concept needed (reschedule instead).

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