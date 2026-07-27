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

## Required Fields

Required and optional fields are defined by PROJECT_RULES.md.

Visual required indicators (*) must always match those rules.

A field must never appear required while being optional.

Do not infer required fields from the imported design.

If the imported design, existing implementation, or validation schema conflicts with PROJECT_RULES.md,
STOP and ask for clarification before implementation.


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

## Business Rules

Business logic must never be duplicated in this file.

All domain rules belong exclusively in PROJECT_RULES.md.

If a conflict exists, PROJECT_RULES.md is the single source of truth.