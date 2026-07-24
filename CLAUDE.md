# Highest Priority

Before every task, read:

1. CLAUDE.md
2. PROJECT_RULES.md

Assume both documents may have changed since the previous task.

Never rely on previous memory.

## Data Ownership

Each entity owns its own data.

Do not duplicate values between entities.

Do not automatically derive one entity's stored data from another.

If related information is needed, reference the related entity instead of copying the value.

# English Tutor LMS — Project Rules

Single Design Component: `English Tutor LMS.dc.html`. Keep everything in that one DC (state-driven routing, right-side drawer for create/edit, center dialog for confirms, toast helper). Do not split into child DCs.

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


# TeacherLMS Development Rules

## Project Goal

Build a production-ready Teacher LMS based on the imported Claude Design.

The imported Claude Design is the single source of truth for UI.

All implementations must preserve the design exactly unless explicitly instructed otherwise.

---

# Golden Rules

DO NOT redesign existing UI.

DO NOT improve the visual design.

DO NOT modernize components.

DO NOT replace layouts.

DO NOT change spacing.

DO NOT change typography.

DO NOT change colors.

DO NOT change animations.

DO NOT change icons.

DO NOT change visual hierarchy.

Only implement missing functionality.

---

# Design System

Always reuse existing components.

Never duplicate components.

Never introduce another design language.

Never replace imported design with your own interpretation.

If a component already exists, extend it instead of rebuilding it.

---

# Styling Rules

Keep all spacing exactly as imported.

Keep all font sizes.

Keep all border radius.

Keep all shadows.

Keep all transitions.

Keep responsive behavior.

Never restyle existing screens.

---

# Architecture

Current stack:

- Next.js App Router
- React
- TypeScript
- MongoDB Atlas
- Mongoose
- React Query
- React Hook Form
- Zod
- Tailwind CSS
- shadcn/ui

Do not change stack.

Do not migrate frameworks.

Do not introduce Redux, Zustand or other state libraries unless explicitly requested.

---

# Backend Rules

Never change authentication flow.

Never modify JWT implementation.

Never change cookie behavior.

Never rename API routes.

Never rename database collections.

Never modify Mongo schemas unless implementing new features.

---

# Database Rules

Current database is production compatible.

Never reset database.

Never delete seed logic.

Never modify seeded admin account.

---

# UI Rules

Every screen must match the imported Claude Design.

Pixel fidelity is required.

No visual creativity.

No visual enhancements.

No "better UX" unless explicitly requested.

---

# Component Rules

Prefer composition over replacement.

Never rewrite existing components.

Never refactor working components without permission.

---

# Refactoring Rules

Do not perform large refactors.

Do not move files unless requested.

Do not rename folders.

Do not rename components.

Do not reorganize architecture.

---

# Sprint Rules

Implement ONE module at a time.

Do not implement multiple modules together.

Each sprint must compile successfully.

Each sprint must preserve existing functionality.

---

# Before Finishing

Always ensure:

✓ npm run lint passes

✓ npm run build passes

✓ No TypeScript errors

✓ Existing pages still work

✓ Authentication still works

✓ Dashboard still works

Never finish with failing build.

---

# If Unsure

Ask before changing architecture.

Ask before changing UI.

Ask before changing APIs.

Never assume.