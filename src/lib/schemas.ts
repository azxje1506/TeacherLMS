/* Zod schemas — shared by Route Handlers (server validation) and React Hook Form
 * (client validation) so the two never drift. */

import { z } from "zod";
import { minutesBetween, overlappingSlotIndexes } from "./calc";
import type { AttendanceStatus, ClassStatus } from "./types";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/* Relationship is a required Parent field with a fixed option set, both defined
 * by PROJECT_RULES.md (Parent). Kept as the single source for the form's Select
 * and the schema's membership check so the two never drift. */
export const RELATIONSHIP_OPTIONS = ["Mother", "Father", "Guardian", "Grandparent", "Other"] as const;

/* Required/optional follows PROJECT_RULES.md (Parent), NOT the design's `*`:
 * Full Name, Relationship and Phone are required; Email and Notes are optional.
 * Address is intentionally absent — it exists in neither the design nor the
 * business rules. `relationship` stays a plain string (empty until chosen) and
 * is constrained to RELATIONSHIP_OPTIONS by refine, so the form can hold "" for
 * the placeholder while an unselected value still fails validation. */
export const parentSchema = z.object({
  name: z.string().min(2, "Full name is required"),
  relationship: z
    .string()
    .refine((v) => (RELATIONSHIP_OPTIONS as readonly string[]).includes(v), "Select a relationship"),
  phone: z.string().regex(/\d{3}/, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email").or(z.literal("")).optional().default(""),
  notes: z.string().optional().default(""),
});
/** What the form holds while editing (email/notes defaults unapplied). */
export type ParentFormInput = z.input<typeof parentSchema>;
/** What validation produces and the API accepts. */
export type ParentInput = z.output<typeof parentSchema>;

/* Required/optional here follows the project specification, NOT the design's `*`
 * markers — a visual cue is not a business rule. `phone` is an independent
 * optional field: it is never copied or synced from the linked parent, and a
 * blank value stays blank. Read Parent.phone directly when you need it. */
export const studentSchema = z.object({
  first: z.string().min(1, "First name is required"),
  last: z.string().min(1, "Last name is required"),
  birthday: z.string().min(1, "Birthday is required"),
  school: z.string().optional().default(""),
  grade: z.coerce.number().int().min(0).max(12),
  parentId: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  status: z.enum(["Active", "Trial", "Paused", "Archived"]).default("Active"),
  notes: z.string().optional().default(""),
  avatar: z.string().nullable().optional().default(null),
});
/** What the form holds while editing (grade is still uncoerced, defaults unapplied). */
export type StudentFormInput = z.input<typeof studentSchema>;
/** What validation produces and the API accepts. */
export type StudentInput = z.output<typeof studentSchema>;

/** The profile's Notes card saves on its own, without the full form. */
export const studentNotesSchema = z.object({ notes: z.string().default("") });

/* The class lifecycle's fixed option set, kept here for the same reason
 * RELATIONSHIP_OPTIONS is: one source for the schema's enum and for every screen
 * that has to enumerate a status, so the two can never drift. `satisfies` ties it
 * to ClassStatus, so adding a status to the type without adding it here is a
 * compile error rather than a filter that silently hides records.
 *
 * Order is lifecycle order (teaching -> finished -> filed away), which is the
 * order the list's status chips read in. */
export const CLASS_STATUSES = ["Active", "Ended", "Archived"] as const satisfies readonly ClassStatus[];

/** Bounds a weekly slot's length must satisfy. One source for the stored shape
 * below and the drawer's From / To form schema. */
export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 240;

const slotSchema = z.object({
  day: z.coerce.number().int().min(0).max(6),
  start: z.string().min(1, "Every slot needs a start time"),
  duration: z.coerce.number().int().min(SLOT_MIN_MINUTES).max(SLOT_MAX_MINUTES),
});

/* A class may teach several lessons on one weekday, but never two at once. The
 * rule is written once and applied to both schedule arrays below — the stored
 * shape (start + duration) and the drawer's (From / To) — so the drawer warns
 * inline and the API stays the final authority. Reuses `overlaps` via
 * overlappingSlotIndexes, so back-to-back slots remain valid and exact
 * duplicates do not. */
const SAME_DAY_OVERLAP = "This lesson time overlaps another lesson on the same day.";

/** Minimal shape of the ctx zod hands a superRefine — kept structural so this
 * helper does not depend on a zod-internal type name. */
type IssueSink = { addIssue: (issue: { code: "custom"; message: string; path: (string | number)[] }) => void };

function flagSameDayOverlaps<T>(
  slots: T[],
  toSlot: (slot: T) => { day: number; start: string; duration: number },
  ctx: IssueSink
): void {
  for (const i of overlappingSlotIndexes(slots.map(toSlot))) {
    ctx.addIssue({ code: "custom", message: SAME_DAY_OVERLAP, path: [i, "start"] });
  }
}

export const classSchema = z.object({
  name: z.string().min(2, "Class name is required"),
  type: z.enum(["group", "one-on-one"]).default("group"),
  level: z.string().optional().default(""),
  fee: z.coerce.number().min(0, "Enter a valid fee"),
  classroom: z.string().optional().default(""),
  status: z.enum(CLASS_STATUSES).default("Active"),
  studentIds: z.array(z.string()).default([]),
  notes: z.string().optional().default(""),
  schedule: z
    .array(slotSchema)
    .min(1, "Add at least one weekly time slot")
    .superRefine((slots, ctx) => flagSameDayOverlaps(slots, (s) => s, ctx)),
});
/** What the form holds while editing (fee + slot day/duration still uncoerced,
 * defaults unapplied). */
export type ClassFormInput = z.input<typeof classSchema>;
/** What validation produces and the API accepts. */
export type ClassInput = z.output<typeof classSchema>;

/* The create/edit drawer schedules with From / To rather than a duration:
 * teachers think in end times. The stored model is unchanged — `start` plus a
 * `duration` in minutes — so the conversion lives here as a schema transform and
 * the payload the API receives is exactly the ClassInput it has always been. */
const formSlotSchema = z
  .object({
    day: z.coerce.number().int().min(0).max(6),
    start: z.string().min(1, "Every slot needs a start time"),
    end: z.string().min(1, "Every slot needs an end time"),
  })
  .superRefine((s, ctx) => {
    const mins = minutesBetween(s.start, s.end);
    if (!Number.isFinite(mins)) return; // an empty time is already reported above
    const reject = (message: string) => ctx.addIssue({ code: "custom", message, path: ["end"] });
    if (mins <= 0) reject("End time must be after start time.");
    else if (mins < SLOT_MIN_MINUTES) reject("A lesson must be at least 15 minutes.");
    else if (mins > SLOT_MAX_MINUTES) reject("A lesson can't be longer than 4 hours.");
  });

/** What the create/edit drawer validates against. Same fields as `classSchema`,
 * except each slot carries From / To; the transform emits a plain `ClassInput`. */
export const classFormSchema = classSchema
  .omit({ schedule: true })
  .extend({
    schedule: z
      .array(formSlotSchema)
      .min(1, "Add at least one weekly time slot")
      .superRefine((slots, ctx) =>
        flagSameDayOverlaps(
          slots,
          (s) => ({ day: s.day, start: s.start, duration: minutesBetween(s.start, s.end) }),
          ctx
        )
      ),
  })
  .transform(({ schedule, ...rest }): ClassInput => ({
    ...rest,
    schedule: schedule.map((s) => ({
      day: s.day,
      start: s.start,
      duration: minutesBetween(s.start, s.end),
    })),
  }));
/** What the drawer's fields hold while editing. */
export type ClassFormValues = z.input<typeof classFormSchema>;

/** The detail's Teacher notes card saves on its own, without the full form. */
export const classNotesSchema = z.object({ notes: z.string().default("") });

/* -------------------------------------------------------------- Homework */

/* These two schemas REPLACE the earlier `homeworkSchema`, which was written
 * ahead of the module, imported by nothing, and stated no rule about `studentId`
 * or about which fields an edit may carry. Two validation authorities for one
 * collection is exactly the duplicate utility the coding rules warn against, so
 * there is one create schema and one update schema and no third.
 *
 * SHAPE ONLY, at both ends. Whether a class is Active, whether a student exists,
 * and whether they are on that class's roster are questions about the database;
 * they are answered in the service, against the database, and Zod deliberately
 * does not pretend to answer them here.
 *
 * BOTH ARE STRICT. An unknown key is rejected rather than stripped. That is what
 * refuses a payload carrying `status`, `submissions`, `lessonId`, `createdAt` or
 * `id` — the fields the server owns — instead of quietly dropping them and
 * reporting success for a write that ignored half the request. The pure planners
 * enforce the same boundary a second time, on purpose: this one keeps a bad
 * request out, that one keeps a bad write in. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const HOMEWORK_SCOPES = ["class", "student"] as const;

/** POST /api/homework — everything a teacher supplies when setting homework.
 *
 * `studentId` is required when the scope is `student` and ignored otherwise: a
 * form that switches from student to class scope may still be holding the last
 * selection, which is a benign client state rather than an attack, and the create
 * planner stores `null` for it. What cannot be tolerated is the reverse — a
 * student-scoped assignment addressed to nobody — so only that is refused here.
 *
 * NO DUE-DATE LIFECYCLE. The format is checked and nothing else: a past due date
 * is permitted, because back-dating an assignment that was set last week is a
 * correction, not an error. */
export const homeworkCreateSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional().default(""),
    classId: z.string().min(1, "Select a class"),
    scope: z.enum(HOMEWORK_SCOPES).default("class"),
    studentId: z.string().nullable().optional().default(null),
    dueDate: z.string().regex(ISO_DATE, "Pick a due date"),
    teacherNotes: z.string().optional().default(""),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === "student" && !v.studentId) {
      ctx.addIssue({ code: "custom", path: ["studentId"], message: "Select a student" });
    }
  });
export type HomeworkCreateBody = z.output<typeof homeworkCreateSchema>;

/** PATCH /api/homework/:id — a correction to the fields a teacher authored.
 *
 * PARTIAL: an absent key is a key that is not being changed. An empty string IS
 * a value — clearing the teacher's notes stores "" — so `.optional()` marks
 * "omitted", never "blank".
 *
 * The class, scope, assignee, status and submissions of an assignment are fixed
 * at creation and are not listed here, so `.strict()` refuses a request naming
 * any of them rather than silently ignoring it. */
export const homeworkUpdateSchema = z
  .object({
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().optional(),
    dueDate: z.string().regex(ISO_DATE, "Pick a due date").optional(),
    teacherNotes: z.string().optional(),
  })
  .strict();
export type HomeworkUpdateBody = z.output<typeof homeworkUpdateSchema>;

export const reviewSchema = z.object({
  studentId: z.string().min(1, "Select a student"),
  month: z.string().min(1),
  skills: z.record(z.string(), z.number().min(1).max(5)),
  comment: z.string().optional().default(""),
  strengths: z.string().optional().default(""),
  improvements: z.string().optional().default(""),
  goals: z.string().optional().default(""),
  parentNotes: z.string().optional().default(""),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const paymentSchema = z.object({
  status: z.enum(["Paid", "Partially Paid", "Unpaid"]),
  paidDate: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

/* ------------------------------------------------------------------ Lessons */

/* Regular lessons are generated from a class schedule and are never created,
 * generically posted or hard-deleted through the API. The only creation paths
 * are the two ad-hoc types below; every other change is a single-responsibility
 * action endpoint. Required/optional follows PROJECT_RULES.md (Lesson Types). */

/** PATCH /api/lessons/:id — editable lesson fields only. Never used to drive a
 * business operation (cancel/reschedule/makeup have their own endpoints). Both
 * fields are optional so a partial patch only touches what it sends. */
export const lessonUpdateSchema = z.object({
  notes: z.string().optional(),
  classroom: z.string().optional(),
});
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;

/** POST /api/lessons/:id/reschedule — move a lesson to a new date (and optionally
 * a new time/duration). Drag-and-drop on the calendar sends just the date. */
export const lessonRescheduleSchema = z.object({
  date: z.string().min(1, "Pick a date"),
  start: z.string().optional(),
  duration: z.coerce.number().int().min(15).max(240).optional(),
});
export type LessonRescheduleInput = z.infer<typeof lessonRescheduleSchema>;

/** POST /api/lessons/:id/cancel — cancel a lesson, optionally still chargeable
 * (see the tuition rules: a cancelled lesson is excluded from revenue unless
 * marked chargeable). */
export const lessonCancelSchema = z.object({
  chargeable: z.boolean().optional().default(false),
});
export type LessonCancelInput = z.infer<typeof lessonCancelSchema>;

/** POST /api/lessons/extra — an Extra session on a one-on-one class (enforced in
 * the service against the class type). */
export const extraLessonSchema = z.object({
  classId: z.string().min(1, "Select a class"),
  date: z.string().min(1, "Pick a date"),
  start: z.string().min(1, "Pick a start time"),
  duration: z.coerce.number().int().min(15).max(240),
  classroom: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});
export type ExtraLessonInput = z.infer<typeof extraLessonSchema>;

/** POST /api/lessons/:id/makeup — a Makeup that replaces a cancelled Regular
 * lesson on a group class (both constraints enforced in the service). Time and
 * duration default to the original lesson's when omitted. */
export const makeupLessonSchema = z.object({
  date: z.string().min(1, "Pick a date"),
  start: z.string().optional(),
  duration: z.coerce.number().int().min(15).max(240).optional(),
  classroom: z.string().optional(),
  notes: z.string().optional().default(""),
});
export type MakeupLessonInput = z.infer<typeof makeupLessonSchema>;

/* --------------------------------------------------------------- Attendance */

/* THE runtime list of attendance statuses, kept here for the same reason
 * CLASS_STATUSES is: one source for the save schema's enum and for every screen
 * that enumerates a status, so a second, drifting copy cannot appear.
 *
 * Order is VALIDATION order, not display order. The register's segmented control
 * reads Present / Late / Absent / Excused — the order the imported design draws
 * the summary tiles in — and that order lives with the UI. A validation list has
 * no visual meaning, so the two are deliberately allowed to differ rather than
 * one being bent to the other. */
export const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Excused"] as const satisfies readonly AttendanceStatus[];

/* `satisfies` above proves every listed value IS an AttendanceStatus. It does NOT
 * prove the reverse — that every AttendanceStatus is listed — and the reverse is
 * the dangerous direction: a fifth status added to the type but not to this list
 * would be rejected at the API as invalid input, silently, with the form offering
 * no way to send it.
 *
 * So the gap is closed here. `UncoveredAttendanceStatus` is `never` while the list
 * is complete, which makes the annotation below `true` and the assignment legal.
 * Add a status to the type without adding it here and the type resolves to
 * `never`, `true` no longer satisfies it, and TypeScript fails the build with this
 * line pointing at the omission. Exported so it is a fact about the module rather
 * than an unused local. */
export type UncoveredAttendanceStatus = Exclude<AttendanceStatus, (typeof ATTENDANCE_STATUSES)[number]>;
export const ATTENDANCE_STATUSES_ARE_EXHAUSTIVE: UncoveredAttendanceStatus extends never ? true : never = true;

/** One student's mark. `note` follows the project's existing optional-text
 * convention, so an omitted note arrives as "" rather than undefined and the
 * service has one shape to reason about.
 *
 * NO max length and NO trimming. Both would be invented rules: PROJECT_RULES sets
 * neither, the design's input sets neither, and a silently truncated or trimmed
 * note is a teacher's words being edited by the system. Unicode passes through
 * untouched — these notes are written in Vietnamese. */
export const attendanceEntrySchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().optional().default(""),
});
export type AttendanceEntryInput = z.output<typeof attendanceEntrySchema>;

/** POST /api/attendance/:lessonId — the visible register, keyed by Student id.
 *
 * SHAPE ONLY. Whether a key is actually on this lesson's roster is a question
 * about the database, not about the payload, so it is answered in the service
 * (`planAttendanceWrite` rejects the whole request on an unknown id). Zod checks
 * that keys are non-empty strings and that each value is a well-formed entry; it
 * deliberately does not try to be a membership test it cannot perform. */
export const attendanceSaveSchema = z.object({
  entries: z.record(z.string().min(1, "Invalid student"), attendanceEntrySchema),
});
export type AttendanceSaveInput = z.output<typeof attendanceSaveSchema>;
