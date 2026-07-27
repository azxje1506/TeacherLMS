/* Zod schemas — shared by Route Handlers (server validation) and React Hook Form
 * (client validation) so the two never drift. */

import { z } from "zod";

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

const slotSchema = z.object({
  day: z.coerce.number().int().min(0).max(6),
  start: z.string().min(1, "Every slot needs a start time"),
  duration: z.coerce.number().int().min(15).max(240),
});
export const classSchema = z.object({
  name: z.string().min(2, "Class name is required"),
  type: z.enum(["group", "one-on-one"]).default("group"),
  level: z.string().optional().default(""),
  fee: z.coerce.number().min(0, "Enter a valid fee"),
  classroom: z.string().optional().default(""),
  status: z.enum(["Active", "Archived"]).default("Active"),
  studentIds: z.array(z.string()).default([]),
  notes: z.string().optional().default(""),
  schedule: z.array(slotSchema).min(1, "Add at least one weekly time slot"),
});
export type ClassInput = z.infer<typeof classSchema>;

export const homeworkSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional().default(""),
  classId: z.string().min(1, "Select a class"),
  scope: z.enum(["class", "student"]).default("class"),
  studentId: z.string().nullable().optional().default(null),
  dueDate: z.string().min(1, "Pick a due date"),
});
export type HomeworkInput = z.infer<typeof homeworkSchema>;

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
