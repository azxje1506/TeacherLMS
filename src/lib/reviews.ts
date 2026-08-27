/* Reviews — the pure domain.
 *
 * A Review is one student's monthly performance record: ten skill ratings and
 * the teacher's words about them. Every rule Reviews embodies lives here as a
 * function over plain values — which students may be reviewed, which months may
 * be reviewed, what a review's average is, exactly what document a create
 * writes, and exactly which keys an edit may touch. Nothing here connects to a
 * database.
 *
 * NO `server-only`, for the same reason src/lib/homework.ts and
 * src/lib/attendance.ts have none: the pure decisions are exercised by the test
 * runner, which cannot resolve that module. Nothing here is imported by a client
 * component for its behaviour — the TYPES are shared with the client, which
 * costs nothing at runtime.
 *
 * THE APP MONTH IS AN ARGUMENT, never a wall clock. `isSelectableMonth` and
 * `reviewMonthOptions` take the application month from their caller, so a test
 * states the month it expects rather than tracking CURRENT_MONTH — and so this
 * module never becomes a second source of application time. `new Date()` appears
 * nowhere below.
 *
 * THE APP MONTH IS A BOUNDARY, NEVER A DEFAULT VALUE. A create still carries an
 * explicit `month` from the client; the planner reads that field and only that
 * field. Substituting the current month for a payload that omitted one would be
 * the server inventing which month a teacher meant.
 *
 * SPRINT 8 GATE 4.1 SCOPE. This module plans creates and edits; it performs
 * none of them. There is no service, no route and no UI behind it yet.
 */

import { SKILLS } from "./constants";
import type { Review, Student, StudentStatus } from "./types";

/* The coaching label and its colour band are NOT restated here. They are one
 * function each in src/lib/calc.ts, already used by the performance views, and
 * their thresholds (2.2 / 3.0 / 3.8 / 4.5) are stated in exactly that one place.
 * Re-exported so the Reviews module has a single import surface without a second
 * copy of the numbers existing anywhere. */
export { perfColor, perfLabel } from "./calc";

/* ------------------------------------------------------------- vocabulary */

/** The ten skill dimensions a review scores, in canonical order.
 *
 * DERIVED FROM `SKILLS`, never retyped: constants.ts owns the list and its
 * labels, so a dimension added or renamed there reaches validation, the planners
 * and the UI at once instead of drifting between them. */
export const SKILL_KEYS: readonly string[] = SKILLS.map(([key]) => key);

/** Skill key -> its display label, from the same canonical source. */
export const SKILL_LABEL: Readonly<Record<string, string>> = Object.fromEntries(SKILLS);

/** The inclusive rating band. Stated once, and read by both the schema that
 * validates a rating and any screen that draws the scale. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/** How many months a review may be written for, counted back from and including
 * the application month: the current month plus the previous eleven. */
export const REVIEW_MONTH_WINDOW = 12;

/** The only fields a teacher may change after a review exists. Ownership — which
 * student, which month — is fixed at creation, and there is nothing else on the
 * document: a review carries no status, no timestamps and no stored average. */
export const REVIEW_EDITABLE_FIELDS = [
  "skills", "comment", "strengths", "improvements", "goals", "parentNotes",
] as const;

export type ReviewEditableField = (typeof REVIEW_EDITABLE_FIELDS)[number];

/** The prose fields at least one of which must be written.
 *
 * `parentNotes` IS DELIBERATELY ABSENT. It is a message addressed to the parent,
 * not the teacher's account of the month, so a review carrying only parent notes
 * has recorded no assessment at all. */
export const REVIEW_PROSE_FIELDS = ["comment", "strengths", "improvements", "goals"] as const;

export type ReviewProseField = (typeof REVIEW_PROSE_FIELDS)[number];

/** Student statuses a NEW review may be written for.
 *
 * Trial and Paused students are being taught, or were until recently, and both
 * have a month worth reporting on. Archived is the one status that does not:
 * that student has been filed away. */
export const ELIGIBLE_REVIEW_STATUSES = ["Active", "Trial", "Paused"] as const satisfies
  readonly StudentStatus[];

/* ----------------------------------------------------------------- errors */

export type ReviewOpError =
  | "not_found"
  | "student_not_found"
  | "student_not_eligible"
  | "month_not_allowed"
  | "review_already_exists";

/** HTTP status + message per failure, so every Route Handler maps one the same
 * way. Plain data, no framework coupling — the shape is lifted from
 * HOMEWORK_ERROR (src/lib/homework.ts) so the modules answer the same question
 * with the same sentence. */
export const REVIEW_ERROR: Record<ReviewOpError, { status: number; message: string }> = {
  not_found: { status: 404, message: "Review not found" },
  student_not_found: { status: 404, message: "Student not found" },
  student_not_eligible: { status: 422, message: "An archived student can't be given a new review" },
  month_not_allowed: { status: 422, message: "Reviews can only be written for the last 12 months" },
  review_already_exists: { status: 409, message: "That student already has a review for this month" },
};

/* ------------------------------------------------------------ eligibility */

/** May this student be given a NEW review?
 *
 * MEMBERSHIP, so it fails closed: a status this build does not recognise is not
 * a permission, and neither is a missing student.
 *
 * THIS GATES CREATE ONLY. It is never asked of an edit — a review already
 * written is a historical record of a month that happened, and archiving the
 * student afterwards does not make that record uncorrectable. */
export function canReviewStudent(student: Pick<Student, "status"> | null | undefined): boolean {
  const status = student?.status;
  return status != null && (ELIGIBLE_REVIEW_STATUSES as readonly string[]).includes(status);
}

/* ------------------------------------------------------------------ prose */

/** Has the teacher written anything about this month?
 *
 * A GROUP RULE, not four required fields. Each individual prose field is
 * optional — a teacher who says everything in `comment` should not be forced to
 * repeat it under three more headings — but a review with no words at all is a
 * row of numbers, so at least one of the four must carry non-whitespace content.
 *
 * `parentNotes` is not consulted (see REVIEW_PROSE_FIELDS) — and the argument is
 * deliberately a whole payload rather than a four-field subset, so a caller
 * hands over the review it actually has and this function reads the four fields
 * it cares about. Anything else on the object is ignored, not refused. */
export function hasRequiredProse(
  value: Readonly<Record<string, unknown>> | null | undefined
): boolean {
  if (!value) return false;
  return REVIEW_PROSE_FIELDS.some((field) => String(value[field] ?? "").trim() !== "");
}

/* ------------------------------------------------------------------ month */

/** "YYYY-MM", with the month part constrained to 01..12. */
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month as a single comparable integer, or null when it is not a month.
 * Cross-year arithmetic falls out of this: December 2025 and January 2026 are
 * adjacent integers, so no special case is needed at a year boundary. */
function monthIndex(month: string | null | undefined): number | null {
  if (typeof month !== "string" || !ISO_MONTH.test(month)) return null;
  const year = Number(month.slice(0, 4));
  const oneBasedMonth = Number(month.slice(5, 7));
  return year * 12 + (oneBasedMonth - 1);
}

/** The "YYYY-MM" `delta` months away from `month` (negative goes back). */
function shiftMonth(month: string, delta: number): string | null {
  const index = monthIndex(month);
  if (index == null) return null;
  const shifted = index + delta;
  const year = Math.floor(shifted / 12);
  const oneBasedMonth = (shifted % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(oneBasedMonth).padStart(2, "0")}`;
}

/** May a review be written for this month, given the application month?
 *
 * THE WINDOW IS THE APPLICATION MONTH PLUS THE PREVIOUS ELEVEN — twelve months
 * ending at the present. Both edges are refusals, and they are refusals for
 * different reasons:
 *
 *  - a FUTURE month has not been taught yet, so there is nothing to report on;
 *  - a month twelve or more back is beyond the year the teacher works in, and
 *    writing a fresh review into it would be inventing a record rather than
 *    correcting one.
 *
 * `appMonth` is an argument. This module holds no clock of its own and never
 * reads one, so the caller — and a test — decides what "now" is. A malformed
 * month on either side fails closed. */
export function isSelectableMonth(month: string | null | undefined, appMonth: string): boolean {
  const monthsBack = monthsAgo(month, appMonth);
  return monthsBack != null && monthsBack >= 0 && monthsBack < REVIEW_MONTH_WINDOW;
}

/** How many months before `appMonth` this month falls — 0 for the application
 * month itself, positive going back, NEGATIVE for a future month. `null` when
 * either side is not a well-formed month.
 *
 * EXPORTED SO THE ARITHMETIC IS STATED ONCE. `isSelectableMonth` asks it whether
 * a month is inside the twelve-month create window; the analytics trend asks it
 * whether a review falls inside a six- or twelve-month chart window. Those are
 * different questions with different bounds, and the only thing they share is
 * "how far apart are these two months" — which is the part that must not be
 * written down twice. Cross-year arithmetic falls out of `monthIndex`, so
 * December 2025 is exactly one month before January 2026 with no special case.
 *
 * NO CLOCK. `appMonth` is an argument here as it is everywhere else in this
 * module. */
export function monthsAgo(month: string | null | undefined, appMonth: string): number | null {
  const target = monthIndex(month);
  const now = monthIndex(appMonth);
  if (target == null || now == null) return null;
  return now - target;
}

/** One month the Create form may offer. `taken` marks a month this student has
 * already been reviewed for: the option stays VISIBLE, because a teacher needs
 * to see that June is done rather than wonder where it went, and it is the
 * screen's job to render it as unavailable. */
export interface ReviewMonthOption {
  month: string; // "YYYY-MM"
  taken: boolean;
}

/** The newest month in `options` that has no review yet, or `null` when every
 * one of them is taken.
 *
 * STATED ONCE, HERE, because two callers need the same answer and a second copy
 * could disagree with the first: the Create composer's default month is chosen
 * on the SERVER (it ships in the composer read model), and the drawer chooses
 * its own on the client through `firstAvailableMonth`, which delegates to this.
 *
 * NO ARITHMETIC AND NO CLOCK. The options arrive newest-first from
 * `reviewMonthOptions`, so the first untaken entry IS the newest untaken one —
 * this picks one of the twelve that were offered, and can no more invent a
 * thirteenth month than the function that built the list. */
export function firstUntakenMonth(
  options: readonly ReviewMonthOption[] | null | undefined
): string | null {
  return options?.find((m) => !m.taken)?.month ?? null;
}

/** The twelve selectable months, newest first.
 *
 * DETERMINISTIC: same application month in, same twelve months out, in the same
 * order, with no clock consulted. `takenMonths` is the set of months this
 * student already has a review for — plain data the caller looked up, not a
 * query this module performs. */
export function reviewMonthOptions(
  appMonth: string,
  takenMonths: Iterable<string> = []
): ReviewMonthOption[] {
  if (monthIndex(appMonth) == null) return [];
  const taken = new Set(takenMonths);
  const options: ReviewMonthOption[] = [];
  for (let back = 0; back < REVIEW_MONTH_WINDOW; back++) {
    const month = shiftMonth(appMonth, -back);
    if (month == null) continue;
    options.push({ month, taken: taken.has(month) });
  }
  return options;
}

/* ----------------------------------------------------------------- skills */

/** A rating read defensively: anything that is not a finite number counts as 0
 * rather than poisoning an average with NaN. Validation guarantees ten integers
 * on the way in; this guards what is already stored. */
function ratingOf(skills: Record<string, number> | null | undefined, key: string): number {
  const value = skills?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Exactly the ten canonical ratings, in canonical order, as a FRESH object.
 *
 * This is the shape that reaches storage. An eleventh key cannot survive it, and
 * neither can an alias to a caller's object — the document a planner returns is
 * never a reference to something the caller can still mutate. */
function canonicalSkills(skills: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) out[key] = ratingOf(skills, key);
  return out;
}

/** The average of a review's ten ratings.
 *
 * EQUAL WEIGHTING, arithmetic mean, always over the ten canonical dimensions —
 * no skill counts for more than another, and the divisor is the vocabulary
 * rather than however many keys a document happens to carry.
 *
 * RAW. The value is returned as it computes, not rounded and not formatted: the
 * screen that shows one decimal decides that, and nothing stores it. An average
 * is derived from the skills it averages, so persisting it would be a second
 * copy of the same fact, free to drift from the first. */
export function reviewAverage(skills: Record<string, number> | null | undefined): number {
  let total = 0;
  for (const key of SKILL_KEYS) total += ratingOf(skills, key);
  return total / SKILL_KEYS.length;
}

/** One dimension with the rating it was given. */
export interface SkillRating {
  key: string;
  label: string;
  rating: number;
}

/** The strongest and the weakest dimensions of a review.
 *
 * STRENGTHS descend by rating, FOCUS ascends, and both break ties on the
 * canonical `SKILLS` order — so a review whose ratings are all equal still
 * produces the same two lists every time it is asked, rather than whatever order
 * the engine's sort happened to leave behind. */
export function rankSkills(
  skills: Record<string, number> | null | undefined,
  count = 3
): { strengths: SkillRating[]; focus: SkillRating[] } {
  const rated = SKILL_KEYS.map((key, index) => ({
    key, label: SKILL_LABEL[key] ?? key, rating: ratingOf(skills, key), index,
  }));
  const take = Math.max(0, Math.min(count, rated.length));

  const strengths = [...rated]
    .sort((a, b) => (b.rating - a.rating) || (a.index - b.index))
    .slice(0, take);
  const focus = [...rated]
    .sort((a, b) => (a.rating - b.rating) || (a.index - b.index))
    .slice(0, take);

  const strip = ({ key, label, rating }: SkillRating & { index: number }): SkillRating =>
    ({ key, label, rating });
  return { strengths: strengths.map(strip), focus: focus.map(strip) };
}

/* ------------------------------------------------------------- read model */

/** Newest first: greatest month wins, and reviews sharing a month fall back to
 * their id descending. The fallback exists only so the order is STATED rather
 * than left to a sort's internals — one student should not have two reviews for
 * one month, and the create planner refuses to make a second. */
function byNewest(a: Review, b: Review): number {
  if (a.month !== b.month) return a.month < b.month ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** The most recent review of a set, or null when there is none. */
export function latestReview(reviews: readonly Review[] | null | undefined): Review | null {
  if (!reviews || reviews.length === 0) return null;
  let best: Review | null = null;
  for (const review of reviews) {
    if (best == null || byNewest(review, best) < 0) best = review;
  }
  return best;
}

/** A student's reviews, newest month first.
 *
 * The input array is never sorted in place: the caller's order is theirs. When
 * `studentId` is given the result is that student's reviews only. */
export function buildReviewHistory(
  reviews: readonly Review[] | null | undefined,
  studentId?: string
): Review[] {
  const scoped = (reviews ?? []).filter((r) => studentId === undefined || r.studentId === studentId);
  return [...scoped].sort(byNewest);
}

/** One student's row on the Reviews index. Values only — the label, the colour
 * band and the one-decimal average are the screen's to render (see `perfLabel`
 * and `perfColor`, re-exported above). */
export interface ReviewCard {
  studentId: string;
  name: string;
  initials: string;
  color: string; // student's avatar tint
  avatar: string | null;
  gradeLabel: string;
  reviewCount: number;
  latestMonth: string | null;
  latestAverage: number | null;
  /** The id of the review `latestMonth` and `latestAverage` describe, or null
   * when this student has none.
   *
   * WHY AN ID IS SAFE HERE WHEN THE INDEX CARRIED NONE BEFORE. A card exists
   * only for a student who RESOLVES — `buildReviewCards` walks canonical
   * Student data and a review whose student is gone raises no card at all — and
   * the id is taken from that same student's own reviews. So this can never
   * disclose a ghost record: the one case that would have to be guarded against
   * is the case that produces no card to put an id on.
   *
   * It exists because a teacher looking at a student who already has reviews
   * needs somewhere to go other than "write another one". */
  latestReviewId: string | null;
  parentLinked: boolean;
}

/** The Reviews index: one card per reviewable student, in the order given.
 *
 * A CARD IS A STUDENT, NOT A REVIEW. The screen offers "write a review" for
 * every student who may be given one, so a student with no reviews at all still
 * gets a card — that is the whole point of the screen — and a review whose
 * student no longer exists gets nothing. A ghost review cannot conjure a card
 * with an invented name on it, which is the same rule Homework applies to an
 * assignment whose student is gone (PROJECT_RULES, Homework).
 *
 * ARCHIVED STUDENTS ARE EXCLUDED, by the same `canReviewStudent` test the create
 * planner uses, so the index cannot offer a button the API would refuse. Their
 * existing reviews are untouched and stay readable wherever history is shown.
 *
 * THE AVERAGE IS THE LATEST REVIEW'S, AND ONLY THAT. There is no lifetime or
 * rolling average anywhere: the design's card reads "avg / 5" beside the latest
 * month's label, and averaging months together would answer a question nobody
 * asked with a number nobody could reproduce.
 *
 * `parentLinked` MEANS A PARENT GENUINELY RESOLVES. A `parentId` holding text
 * that matches no Parent document is not a link — PROJECT_RULES requires reviews
 * to indicate clearly when a student has no linked parent, and a broken
 * reference is exactly that case. */
export function buildReviewCards(
  students: readonly Student[] | null | undefined,
  reviews: readonly Review[] | null | undefined,
  existingParentIds: ReadonlySet<string> | null | undefined
): ReviewCard[] {
  const byStudent = new Map<string, Review[]>();
  for (const review of reviews ?? []) {
    const bucket = byStudent.get(review.studentId);
    if (bucket) bucket.push(review);
    else byStudent.set(review.studentId, [review]);
  }

  const cards: ReviewCard[] = [];
  for (const student of students ?? []) {
    if (!canReviewStudent(student)) continue;
    const own = byStudent.get(student.id) ?? [];
    const latest = latestReview(own);
    cards.push({
      studentId: student.id,
      name: student.name,
      initials: student.initials,
      color: student.avatarColor,
      avatar: student.avatar,
      gradeLabel: student.gradeLabel,
      reviewCount: own.length,
      latestMonth: latest ? latest.month : null,
      latestAverage: latest ? reviewAverage(latest.skills) : null,
      /* The SAME review the month and the average come from, so a card cannot
       * offer to open one review while describing another. */
      latestReviewId: latest ? latest.id : null,
      parentLinked: isParentLinked(student, existingParentIds),
    });
  }
  return cards;
}

/** Does this student have a linked parent that actually resolves? The single
 * test behind `ReviewCard.parentLinked`, exported so a drawer asking the same
 * question asks it the same way. */
export function isParentLinked(
  student: Pick<Student, "parentId"> | null | undefined,
  existingParentIds: ReadonlySet<string> | null | undefined
): boolean {
  const parentId = student?.parentId;
  if (!parentId) return false;
  return existingParentIds?.has(parentId) === true;
}

/* ------------------------------------------------------------------ create */

/** What a teacher supplies when writing a review. Everything else on the
 * document is the server's to decide — and there is only one such field, the id. */
export interface ReviewCreateInput {
  studentId: string;
  month: string; // "YYYY-MM" — always explicit, never defaulted by the server
  skills: Record<string, number>;
  comment: string;
  strengths: string;
  improvements: string;
  goals: string;
  parentNotes: string;
}

export type ReviewCreatePlan =
  | { ok: true; doc: Review }
  | { ok: false; reason: ReviewOpError };

/** Plan the one document a create writes.
 *
 * ORDER MATTERS, and it is the order the questions depend on each other: the
 * student must exist before their status can be judged, the month must be a
 * month this build allows before it is worth asking whether it is already taken.
 * A caller that stops at the first failure therefore never reports "already
 * reviewed" for a student who was never there.
 *
 * UNIQUENESS IS CONSUMED, NOT ENFORCED. `reviewedMonths` is plain data the
 * caller read; this function compares against it and returns a plan or a
 * failure. Enforcing one-review-per-student-per-month in the database is a
 * separate decision with a separate authorisation (Gate 5), and no index is
 * declared anywhere in Sprint 8 Gate 4.1.
 *
 * THE ID IS AN ARGUMENT and the month comes from the input, which is what lets a
 * test assert the whole document — every field, exactly — with nothing moving.
 * `appMonth` is used for one thing only: deciding whether `input.month` is
 * inside the window. It is never written to the document.
 *
 * THE DOCUMENT HAS NINE FIELDS AND NO MORE. No status, because a review is not a
 * workflow. No timestamps, because nothing records when one was written and a
 * derived stamp would be a guess presented as a fact. No classId or lessonId,
 * because a review is about a student's month, not a session. No average,
 * because `reviewAverage` derives it from the skills on demand.
 *
 * Inputs are never mutated: the document is built fresh, and so is its skills
 * map. */
export function planReviewCreate(
  input: ReviewCreateInput,
  student: Pick<Student, "id" | "status"> | null | undefined,
  reviewedMonths: ReadonlySet<string> | null | undefined,
  generatedId: string,
  appMonth: string
): ReviewCreatePlan {
  if (!student) return { ok: false, reason: "student_not_found" };
  if (!canReviewStudent(student)) return { ok: false, reason: "student_not_eligible" };
  if (!isSelectableMonth(input.month, appMonth)) return { ok: false, reason: "month_not_allowed" };
  if (reviewedMonths?.has(input.month)) return { ok: false, reason: "review_already_exists" };

  return {
    ok: true,
    doc: {
      id: generatedId,
      studentId: student.id,
      month: input.month,
      skills: canonicalSkills(input.skills),
      comment: input.comment,
      strengths: input.strengths,
      improvements: input.improvements,
      goals: input.goals,
      parentNotes: input.parentNotes,
    },
  };
}

/* -------------------------------------------------------------------- edit */

/** A correction to a review. Partial: a key that is absent is a key that is not
 * being changed. */
export type ReviewPatch = Partial<Pick<Review, ReviewEditableField>>;

/** Plan the `$set` an edit writes — and nothing else.
 *
 * THIS IS THE IMMUTABILITY BOUNDARY, and it is an allow-list rather than a
 * deny-list so it fails closed: a key is emitted only because it appears in
 * REVIEW_EDITABLE_FIELDS, so `id`, `studentId` and `month` can never be produced
 * whatever a caller passes, and a field added to the model later is immutable
 * until someone deliberately lists it here. A review that names the wrong
 * student or the wrong month is a different review, not an edit of this one.
 *
 * THIS DOES NOT RELY ON THE UI OMITTING ANYTHING. The form not drawing a month
 * picker is a fact about a screen; this is a fact about the system.
 *
 * NO EDIT ELIGIBILITY IS CONSULTED. `canReviewStudent` gates writing a NEW
 * review; a review that already exists describes a month that already happened,
 * and archiving the student afterwards does not make that record uncorrectable.
 *
 * `skills` IS REBUILT, not passed through: an edit stores exactly the ten
 * canonical ratings, so an eleventh key cannot reach a `Mixed` field through a
 * patch, and the stored object is never an alias of the caller's.
 *
 * PARTIAL, AND `undefined` IS NOT A VALUE. An empty string IS supplied: clearing
 * the parent notes stores `""`, which is how every other top-level text field in
 * the app behaves. An empty patch plans an empty `$set`; deciding there is
 * nothing to write belongs to the caller that would have issued it. */
export function planReviewUpdate(patch: ReviewPatch | null | undefined): ReviewPatch {
  const set: ReviewPatch = {};
  if (!patch) return set;
  for (const key of REVIEW_EDITABLE_FIELDS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (key === "skills") set.skills = canonicalSkills(value as Record<string, number>);
    else set[key] = value as string;
  }
  return set;
}
