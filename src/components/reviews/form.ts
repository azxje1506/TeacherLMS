/* The Review drawer's form values, as pure functions.
 *
 * WHY THIS IS NOT INLINE IN THE COMPONENT. The rules here are real ones, and
 * they are exactly the rules that could quietly break the approved contract: an
 * edit must send six fields and never a seventh, and it must never send the
 * student or the month even though the drawer is holding both in order to show
 * them. Rules that matter are rules worth testing, and a handler buried in a
 * component is reachable only by rendering it. Here they are ordinary functions
 * over ordinary values — the same reason src/components/homework/form.ts and
 * src/components/attendance/draft.ts exist.
 *
 * NO BUSINESS LOGIC. The average, the ranking, the eligibility rule and the
 * month window all live in src/lib/reviews.ts and are not restated here. This
 * file shapes what the form holds and what goes on the wire; it decides nothing.
 *
 * Every function returns a NEW object rather than mutating one.
 */

import { SKILL_KEYS } from "@/lib/reviews";
import type { ReviewMonthOption } from "@/lib/reviews";
import type { ReviewDetail } from "@/lib/reviews-service";
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

/** The rating a new review starts every skill at.
 *
 * A UI STARTING VALUE AND NOTHING MORE. Three is the middle of the 1–5 scale, so
 * the form opens at "no opinion expressed yet" rather than flattering or
 * damning a student by default, and the teacher moves each of the ten before
 * saving. It weakens no server rule: the schema still requires ten integers in
 * range, and a rating of 3 that reaches the database is a rating the teacher
 * left at 3.
 *
 * NOTHING IS DERIVED. Not from attendance, not from homework, not from a
 * previous review, not from the student's status, not from their class. A review
 * is the teacher's judgement of a month; a prefilled "suggestion" computed from
 * other data would be the system putting words in their mouth. */
export const DEFAULT_RATING = 3;

/** What the drawer's fields hold.
 *
 * `studentId` and `month` are carried so the drawer can SHOW them — an edit
 * displays the month as static context, and a create needs to submit it.
 * `toUpdateBody` is what decides they are never sent on an edit. */
export interface ReviewFormValues {
  studentId: string;
  month: string;
  skills: Record<string, number>;
  comment: string;
  strengths: string;
  improvements: string;
  goals: string;
  parentNotes: string;
}

/** The ten canonical skills, every one at the starting rating. A fresh object
 * every call, so no two forms can share one. */
export function defaultSkills(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) out[key] = DEFAULT_RATING;
  return out;
}

/** Exactly the ten canonical ratings, read out of whatever object was supplied.
 *
 * Built by walking SKILL_KEYS rather than by copying the source object, so an
 * eleventh key cannot survive and a missing one cannot silently vanish — it
 * falls back to the starting rating, which is a value the schema accepts and a
 * teacher can see and change. */
function canonicalSkills(skills: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) {
    const value = skills?.[key];
    out[key] = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_RATING;
  }
  return out;
}

/** A blank review for one student and one month. */
export function emptyValues(studentId: string, month: string): ReviewFormValues {
  return {
    studentId,
    month,
    skills: defaultSkills(),
    comment: "", strengths: "", improvements: "", goals: "", parentNotes: "",
  };
}

/** The form for an existing review. The source object is only read: its skills
 * are copied through `canonicalSkills`, so editing the form cannot reach back
 * into the cached DTO. */
export function valuesFrom(review: ReviewDetail): ReviewFormValues {
  return {
    studentId: review.studentId,
    month: review.month,
    skills: canonicalSkills(review.skills),
    comment: review.comment,
    strengths: review.strengths,
    improvements: review.improvements,
    goals: review.goals,
    parentNotes: review.parentNotes,
  };
}

/** The newest month this student may still be reviewed for, or "" when every
 * month in the window is already taken.
 *
 * The options arrive newest-first from the server, so the first untaken one is
 * the newest untaken one. NO ARITHMETIC HAPPENS HERE: the client never computes
 * a month, never reads a clock, and cannot invent a thirteenth month — it picks
 * one of the twelve the server offered, or none. */
export function firstAvailableMonth(months: readonly ReviewMonthOption[] | undefined): string {
  return months?.find((m) => !m.taken)?.month ?? "";
}

/** Is there any month left to write a review for? */
export function hasAvailableMonth(months: readonly ReviewMonthOption[] | undefined): boolean {
  return firstAvailableMonth(months) !== "";
}

/** The POST body — exactly the eight fields a create may carry.
 *
 * Built by naming them, never by spreading the form, so a field added to
 * `ReviewFormValues` later cannot reach the wire by accident. */
export function toCreateBody(values: ReviewFormValues): ReviewCreateBody {
  return {
    studentId: values.studentId,
    month: values.month,
    skills: canonicalSkills(values.skills),
    comment: values.comment,
    strengths: values.strengths,
    improvements: values.improvements,
    goals: values.goals,
    parentNotes: values.parentNotes,
  };
}

/** The PATCH body — exactly the six fields a teacher authored.
 *
 * THE OWNERSHIP FIELDS ARE NOT HERE, and cannot be added by editing a component:
 * the object is written out field by field, `studentId` and `month` are not among
 * them, and the server refuses any other key outright. The drawer holds both in
 * order to display them; this is the function that guarantees holding them and
 * sending them are different things. */
export function toUpdateBody(values: ReviewFormValues): ReviewUpdateBody {
  return {
    skills: canonicalSkills(values.skills),
    comment: values.comment,
    strengths: values.strengths,
    improvements: values.improvements,
    goals: values.goals,
    parentNotes: values.parentNotes,
  };
}
