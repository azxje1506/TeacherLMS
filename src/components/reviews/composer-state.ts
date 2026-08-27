/* The dedicated composer's state rules, as pure functions over plain values.
 *
 * WHY THIS FILE EXISTS, AND WHY IT EXISTS NOW. Gate 4.4D's human verification
 * found a cross-month data defect: a review's form baseline was established once
 * per component mount, while the route's id and the fetched context changed in
 * place underneath it. The rules that decide WHICH record a form is holding, and
 * WHICH record a save must address, were living inside JSX where no test could
 * reach them — so a mismatch between the two was invisible until it overwrote a
 * real month.
 *
 * They are ordinary functions here for exactly the reason
 * src/components/reviews/form.ts is: rules that can corrupt data are rules worth
 * testing, and a rule buried in a component is reachable only by rendering it.
 *
 * EVERY FUNCTION BELOW IS A READER. None of them mutates its argument, and the
 * values they return are fresh objects — never aliases into the React Query
 * cache, never aliases into another month's record. The tests deep-freeze their
 * fixtures, so an accidental write throws rather than silently corrupting the
 * next month a teacher opens.
 *
 * NO REACT, NO I18N, NO FORMATTING. The month options carry keys and states; the
 * screen turns those into sentences.
 */

import { emptyValues, type ReviewFormValues } from "@/components/reviews/form";
import { SKILL_KEYS } from "@/lib/reviews";
import type { ReviewComposerData } from "@/lib/review-report";

/* ------------------------------------------------------------------- stage */

/** What the composer is doing right now.
 *
 * THREE STAGES, NOT TWO, and the third is the point of the remediation. A saved
 * review is a historical record: it opens as something a teacher READS, and
 * becomes editable only when they say so. "create" has no view stage — there is
 * nothing saved to look at yet.
 *
 * THIS IS NOT A LIFECYCLE. It is local screen state and it is never persisted,
 * never sent, and never read back: a Review document still has no status field
 * and Sprint 8 still has no Draft, Published or Final. */
export type ComposerStage = "create" | "view" | "edit";

/** The stage a freshly-loaded composer opens in. A persisted review opens in
 * View; a create is editable immediately, because there is nothing else it
 * could usefully be. */
export function initialStage(mode: ReviewComposerData["mode"]): ComposerStage {
  return mode === "create" ? "create" : "view";
}

/** May the teacher change anything at this stage? */
export function isEditable(stage: ComposerStage): boolean {
  return stage !== "view";
}

/** May a dirty form exist at this stage? View is never dirty — nothing in it can
 * be changed — which is why leaving View never prompts. */
export function canBeDirty(stage: ComposerStage): boolean {
  return isEditable(stage);
}

/** The label key for the stage's primary action. Explicit per stage: a screen
 * that says "Save changes" while nothing can be changed is lying about what it
 * will do. */
export function primaryActionKey(stage: ComposerStage): string {
  return stage === "create" ? "Save review" : stage === "view" ? "Edit review" : "Save changes";
}

/* ---------------------------------------------------------------- identity */

/** WHICH RECORD this composer is holding — the string that must change when the
 * form has to be re-seeded, and must NOT change when the same record is merely
 * refetched.
 *
 * THIS IS THE FIX FOR THE CROSS-MONTH DEFECT. The composer seeds React Hook Form
 * from `defaultValues`, which is read once per mount. On a sibling navigation —
 * /reviews/A to /reviews/B — the route param and the fetched context change in
 * place, and when B was already in the query cache the swap happens with no
 * loading state to unmount anything. The form went on holding A's ten ratings
 * and five prose fields while the header, the month selector and the id used for
 * the save had all become B's, so saving wrote A's answers into B.
 *
 * Keying the mounted component on the route id closes the common path, but it is
 * one JSX attribute and nothing enforces it. This is the value the composer
 * ALSO watches: when it changes, the form is re-seeded from the record that
 * arrived, and the pristine baseline moves with it.
 *
 * A CREATE IS IDENTIFIED BY ITS STUDENT, because that is the only thing that
 * distinguishes one create from another. */
export function composerIdentity(data: ReviewComposerData): string {
  return data.mode === "edit" && data.review.id !== null
    ? `review:${data.review.id}`
    : `student:${data.student.id}`;
}

/** The review a save must PATCH, or null when there is nothing to patch.
 *
 * READ FROM THE SAME OBJECT THE FORM WAS SEEDED FROM, never from a route param
 * held somewhere else — so "the values on screen" and "the record they will be
 * written to" cannot come from two different places and disagree. */
export function saveTargetId(data: ReviewComposerData): string | null {
  return data.mode === "edit" ? data.review.id : null;
}

/* ---------------------------------------------------------------- baseline */

/** Exactly the ten canonical ratings, as a FRESH object.
 *
 * Built by walking SKILL_KEYS rather than by copying, so the returned map can
 * never be an alias of the cached review's own `skills` — which is what stops a
 * form edit from reaching back into the React Query cache and, through it, into
 * whatever else is rendering from that cache. An eleventh key cannot survive
 * and a missing one falls back to a value the schema accepts. */
function canonicalSkills(skills: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) {
    const value = skills?.[key];
    out[key] = typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** The pristine baseline for whichever record this context describes.
 *
 * THE ONE PLACE A FORM IS SEEDED. Both the initial mount and every re-seed after
 * a record change call this, so "what does pristine mean here" has a single
 * answer per record instead of one answer at mount and another after a
 * navigation.
 *
 *  - EDIT: exactly the persisted values, so reverting an edit by hand makes the
 *    form pristine again and a month switch restores the destination's own words.
 *  - CREATE: the ten ratings at their neutral start, the server's default month,
 *    and blank prose — a form nobody has touched, so opening a create and
 *    leaving immediately prompts nothing.
 *
 * NOTHING IS SHARED WITH THE ARGUMENT. Every string is copied by value and the
 * skills map is rebuilt, so the returned object holds no reference into `data`. */
export function baselineValues(data: ReviewComposerData): ReviewFormValues {
  if (data.mode === "edit") {
    return {
      studentId: data.student.id,
      month: data.month.current ?? "",
      skills: canonicalSkills(data.review.skills),
      comment: data.review.comment,
      strengths: data.review.strengths,
      improvements: data.review.improvements,
      goals: data.review.goals,
      parentNotes: data.review.parentNotes,
    };
  }
  return emptyValues(data.student.id, data.month.current ?? "");
}

/* ---------------------------------------------------------- month selector */

/** What one month means in the selector, beyond its name.
 *
 *  - "current"  the month this composer is already showing;
 *  - "reviewed" a month this student has a review for;
 *  - "none"     a month with no review yet.
 *
 * The SCREEN turns these into words. Keeping them as states rather than strings
 * is what lets Create and the persisted route share one option builder while
 * saying different things about the same month — Create offers the empty months
 * and refuses the taken ones; the persisted route does the exact opposite. */
export type MonthOptionState = "current" | "reviewed" | "none";

export interface ComposerMonthOption {
  month: string;
  state: MonthOptionState;
  /** The review that holds this month, when one does. */
  reviewId: string | null;
  /** May this row be chosen at all, in this mode? */
  disabled: boolean;
}

/** The full month context — one twelve-month list at every stage.
 *
 * ONE LIST, THREE MEANINGS. Before the remediation Create offered twelve months
 * and the persisted route offered only the two or three that had reviews, so the
 * selector appeared to collapse the moment a review was saved. It is the same
 * window everywhere now; what changes is what the control is FOR:
 *
 *  - CREATE: it chooses which month the new review will belong to. The months
 *    with no review are offered; a taken month stays VISIBLE and refused,
 *    because a teacher needs to see that June is done rather than wonder where
 *    it went — and it never silently becomes an Edit.
 *  - VIEW: it is REVIEW NAVIGATION. Months that have a review are choosable and
 *    open that review; a month with none is visible and refused, because Sprint
 *    8 does not start a Create from inside a saved review.
 *  - EDIT: the month is ownership context and is fixed. Nothing is choosable —
 *    see `monthChoice`, which refuses every month while editing, and the screen,
 *    which disables the trigger outright. A teacher editing June must not be
 *    able to pick May and find themselves somewhere else with their work gone.
 *
 * A HISTORICAL MONTH OUTSIDE THE CREATE WINDOW is included whenever the server
 * sent it — which it does for the review being viewed — so a record older than
 * twelve months is reachable, readable and correctable rather than orphaned.
 * That widens no create eligibility: such a month is `reviewed`, never `none`.
 *
 * Order is the server's: newest first. */
export function monthOptions(data: ReviewComposerData, stage: ComposerStage): ComposerMonthOption[] {
  const creating = stage === "create";
  return data.month.options.map((o) => {
    const isCurrent = o.month === data.month.current;
    const state: MonthOptionState = isCurrent && !creating ? "current" : o.taken ? "reviewed" : "none";
    return {
      month: o.month,
      state,
      reviewId: o.reviewId,
      /* Create refuses what is taken; View refuses what is empty; Edit refuses
       * everything, because its month cannot move at all. The month already on
       * screen is not marked disabled in View — choosing it again is simply a
       * no-op, which is kinder than a row that looks broken. */
      disabled: stage === "edit" ? true : creating ? o.taken : !o.taken,
    };
  });
}

/** What choosing a month in the selector should DO. */
export type MonthChoice =
  /** Create: start a fresh draft for this month. See `monthChoice`. */
  | { kind: "select"; month: string }
  /** View: go to the review that holds this month. */
  | { kind: "navigate"; reviewId: string }
  /** Already there, refused, editing, or nothing to go to. */
  | { kind: "none" };

/** Decide what a month click means, without doing it.
 *
 * SEPARATED FROM THE HANDLER so the decision can be asserted directly, and the
 * three rules that matter are all structural rather than a matter of which
 * control happens to be rendered:
 *
 *  - EDIT ANSWERS "none" FOR EVERY MONTH. The trigger is disabled too, but this
 *    is the guarantee: while editing, no month click can navigate anywhere or
 *    move this review's month. A teacher correcting June cannot pick May and
 *    lose their work to a page they did not mean to open.
 *  - VIEW NEVER ANSWERS "select" — which would move a saved review's month, the
 *    one thing an edit may never do.
 *  - CREATE NEVER ANSWERS "navigate" — which would turn a create into an edit
 *    behind the teacher's back.
 *
 * A month with no review, chosen in View, is `none` rather than a create:
 * Sprint 8 does not start a Create from inside a saved review. */
export function monthChoice(
  data: ReviewComposerData,
  month: string,
  stage: ComposerStage
): MonthChoice {
  if (stage === "edit") return { kind: "none" };
  const option = monthOptions(data, stage).find((o) => o.month === month);
  if (!option || option.disabled) return { kind: "none" };
  if (stage === "create") return { kind: "select", month: option.month };
  if (option.state === "current") return { kind: "none" };
  return option.reviewId === null ? { kind: "none" } : { kind: "navigate", reviewId: option.reviewId };
}

/** May the month control be operated at all, at this stage?
 *
 * False while editing: the month is ownership context there, so the trigger is
 * disabled rather than opening a list of destinations the teacher must not take.
 * To browse another month they Save changes or Cancel editing first, which
 * returns them to View — where the control becomes navigational again. */
export function monthSelectorEnabled(stage: ComposerStage): boolean {
  return stage !== "edit";
}

/** The month the SELECTOR displays.
 *
 * On the persisted route this is the loaded review's month and nothing else —
 * deliberately not a piece of local state that a click could move ahead of the
 * navigation. A teacher who picks another month and then answers "Keep editing"
 * must find the selector still showing the month they are actually on; binding
 * the trigger to the record makes that true by construction rather than by
 * remembering to undo it.
 *
 * In Create the month IS a form value, so the form is what the screen reads. */
export function selectedMonth(
  data: ReviewComposerData,
  draftMonth: string,
  stage: ComposerStage
): string {
  return stage === "create" ? draftMonth : data.month.current ?? "";
}
