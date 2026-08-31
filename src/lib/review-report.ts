/* Reviews — the composer's read model and the monthly report it renders.
 *
 * TWO SHAPES AND ONE FUNCTION BETWEEN THEM.
 *
 *  - `ReviewComposerData` is everything the dedicated composer needs that a
 *    teacher cannot type: who the student is, who their parent is, which months
 *    may be written, and the Attendance and Homework figures for each of those
 *    months. The server builds it; the client never derives any of it.
 *  - `MonthlyReviewReport` is the document the preview draws — and the document
 *    Gate 4.4E's Print and PDF will draw, from this same type. One content model,
 *    so a report cannot say one thing on screen and another on paper.
 *  - `buildMonthlyReviewReportDraft` turns the first into the second using the
 *    form's CURRENT values, which is what makes a live preview possible before
 *    anything is saved.
 *
 * NEITHER SHAPE IS EVER PERSISTED. No Review document gains a field because this
 * file exists. The report is generated per render from stored Reviews plus
 * derived Attendance/Homework, and `generatedOn` describes the generated
 * document, never the record.
 *
 * NO LIFECYCLE. Sprint 8 Reviews have no Draft, no Published and no Final, so
 * there is no status anywhere below and no place to put one. The reference comp
 * carries publication language; it is replaced with neutral document metadata —
 * the review period, and the day the document was generated.
 *
 * NOTHING IS GENERATED OR GUESSED. No AI prose, no achievement, no concern. The
 * teacher summary is `buildTeacherSummary` — every strongest skill, every focus
 * area, and a strictly positive biggest improvement — and nothing else. The words
 * those become are `teacherSummaryLines`, below, so the card, the sheet and the
 * PDF cannot state the same summary three different ways.
 *
 * NO `server-only`, for the reason src/lib/reviews.ts has none: every decision
 * here is exercised by the test runner, which cannot resolve that module. No
 * clock either — the application month and the application date are arguments
 * that arrive on the context, so this module never becomes a second source of
 * app time.
 */

import {
  SKILL_KEYS, SKILL_LABEL, perfColor, perfLabel, reviewAverage, type SkillRating,
} from "./reviews";
import {
  buildTeacherSummary, previousReview, radarAxes,
  type ReviewRadar, type ReviewSkillsSnapshot, type TeacherSummary,
} from "./review-analytics";
import type { StudentAttendanceRate, StudentHomeworkCompletion } from "./finance";
import type { StudentStatus } from "./types";

/* ------------------------------------------------------- the composer model */

/** One month the composer may show, with everything that month implies.
 *
 * WHY THE METRICS RIDE ALONG. A create previews before it persists, so changing
 * the month has to change the Attendance and Homework figures the preview shows
 * — and those are facts about other domains that the client cannot compute. The
 * alternative was a request per month change; twelve months of two small metric
 * objects is about a kilobyte, and the service already reads the underlying
 * collections ONCE and maps over the months, so carrying all twelve costs one
 * round trip instead of one per keystroke on the month chips.
 *
 * `reviewId` IS THE STUDENT'S OWN REVIEW for that month, or null. It is what
 * lets Edit's month chips navigate between existing reviews. It is never used to
 * turn a Create into an Edit: a taken month in Create mode is disabled and
 * carries no destination.
 *
 * BOTH PERCENTAGES MAY BE `null`, AND THAT IS NOT ZERO — the denominator was
 * empty. Every consumer branches on it and renders "No data". */
export interface ReviewComposerMonth {
  month: string; // "YYYY-MM"
  /** Does this student already have a review for this month? */
  taken: boolean;
  /** That review's id when `taken`, else null. */
  reviewId: string | null;
  attendance: StudentAttendanceRate;
  homework: StudentHomeworkCompletion;
}

/** The student a review is about, as both the editor and the report show them. */
export interface ReviewComposerStudent {
  id: string;
  name: string;
  initials: string;
  color: string;
  avatar: string | null;
  gradeLabel: string;
  status: StudentStatus;
}

/** The parent the report is addressed to, or `null` when none resolves.
 *
 * `null` MEANS NO PARENT RESOLVES — either none is linked, or the linked id
 * matches no Parent document. PROJECT_RULES requires reviews to say so clearly,
 * and the report renders the em-dash placeholder rather than a blank line. */
export interface ReviewComposerParent {
  name: string;
  relationship: string;
}

/** Everything the dedicated composer needs, in one plain object, for both modes.
 *
 * ONE SHAPE FOR CREATE AND EDIT, so the two are the same product surface rather
 * than two forms that happen to look alike. `mode` is the only discriminator,
 * and the fields that differ say so themselves: `review.id` is null on a create,
 * and `month.immutable` is true on an edit.
 *
 * WHAT IS DELIBERATELY NOT HERE: a radar, a teacher summary and an average. All
 * three are derived from the ten ratings, and on this screen the ten ratings are
 * whatever the teacher has typed a moment ago — so a server-computed copy would
 * be stale the instant it arrived. They are computed from the DRAFT, by
 * `buildMonthlyReviewReportDraft`, which is the whole point of a live preview.
 * What the server sends is exactly what a form cannot produce. */
export interface ReviewComposerData {
  mode: "create" | "edit";
  student: ReviewComposerStudent;
  parent: ReviewComposerParent | null;
  /** True only when the linked Parent document actually resolves. */
  parentLinked: boolean;
  month: {
    /** Edit: the review's own month. Create: the newest month with no review
     * yet, or `null` when all twelve are taken and no create is possible. */
    current: string | null;
    /** Create: the twelve-month window, newest first. Edit: the same window,
     * from which the chips show the months that actually have a review. */
    options: ReviewComposerMonth[];
    /** True on an edit: a review's month is fixed at creation. */
    immutable: boolean;
  };
  review: {
    /** null on a create — there is no record yet. */
    id: string | null;
    skills: Record<string, number>;
    comment: string;
    strengths: string;
    improvements: string;
    goals: string;
    parentNotes: string;
    /** The persisted review's average, or 0 on a create. The PREVIEW never
     * reads this — it averages the draft — it is here so an edit can show what
     * was saved without a second request. */
    average: number;
  };
  /** Every review this student has, as month + ten ratings + the teacher's own
   * comment, in any order. It is what `previousReview` searches to find the
   * review preceding a draft month — which is how the comparison, and the
   * editor's "latest teacher note" context, follow a month change without a
   * second request. It carries no id and no student. */
  history: ReviewHistoryEntry[];
  /** The application month, so a client can bound a window without a clock. */
  appMonth: string;
  /** The application date, "YYYY-MM-DD" — the report's `generatedOn`. */
  appDate: string;
}

/** One earlier review, as the composer needs it.
 *
 * EXTENDS `ReviewSkillsSnapshot` rather than restating it, so every analytics
 * helper that takes a snapshot takes one of these unchanged. `comment` rides
 * along because the editor shows the previous month's note as context and that
 * note has to follow a month change; the other four prose fields are not here,
 * because nothing shows them.
 *
 * IT IS CONTEXT, NEVER A DEFAULT. Nothing copies a previous review's words into
 * a draft — a review is the teacher's account of THIS month. */
export interface ReviewHistoryEntry extends ReviewSkillsSnapshot {
  comment: string;
}

/* ----------------------------------------------------------- the draft model */

/** The part of a report that comes from the form rather than from the server.
 *
 * A STRUCTURAL SUBSET of the composer's form values, so `ReviewFormValues`
 * satisfies it without a conversion step and nothing has to be kept in step by
 * hand. `month` is here because a create's month is a form value until it is
 * saved. */
export interface ReviewReportDraft {
  month: string;
  skills: Record<string, number>;
  comment: string;
  strengths: string;
  improvements: string;
  goals: string;
  parentNotes: string;
}

/* ----------------------------------------------------------- the report DTO */

/** One dimension as the REPORT states it: the rating, and the colour that
 * rating means.
 *
 * ---- WHY THE COLOUR IS ON THE DTO -----------------------------------------
 *
 * A skill bar used to be filled with the report's OVERALL band — one colour for
 * all ten, so the sheet "read as one document". Human/product decision reversed
 * that: a bar is a statement about ONE skill, and painting a 5 and a 2 the same
 * colour throws away the only thing the colour could have said. Each bar now
 * takes `perfColor` of its OWN rating — the identical mapping the drawer's
 * rating control applies to the same 1-5 scale, so a Listening of 5 is the same
 * colour in the control, in the preview, on paper and in the file.
 *
 * IT IS DERIVED HERE, ONCE, AND CARRIED. The report component computes nothing
 * and the PDF document model computes nothing; if either called `perfColor`
 * itself there would be two places for a threshold to drift. `perfColor` answers
 * with a CSS custom-property reference (`var(--green)`), which the sheet's
 * light-locked palette resolves on screen and the PDF renderer's single token
 * map resolves on paper. */
export interface ReportSkill extends SkillRating {
  /** `perfColor(rating)` — a CSS token reference, never a literal hex. */
  color: string;
}


/** The generated monthly report — the single content model behind the live
 * preview, and behind Gate 4.4E's Print and PDF.
 *
 * NO `status`, NO `publishedOn`, NO `concern`, NO `achievement`, NO AI summary.
 * There is no property for any of them, so no surface can render one.
 *
 * `attendance` and `homework` MAY BE null — when the draft month is not one the
 * server offered figures for. That is a different fact from "0%", and the view
 * renders "No data". */
export interface MonthlyReviewReport {
  student: ReviewComposerStudent;
  parent: ReviewComposerParent | null;
  /** The month this report covers, "YYYY-MM". */
  period: string;
  summary: {
    /** The draft's equal-weighted average, raw — the view rounds it. */
    overallScore: number;
    /** The app's existing performance word for that average. */
    performanceLabel: string;
    /** The app's existing performance colour band for that average. */
    performanceColor: string;
    attendance: StudentAttendanceRate | null;
    homework: StudentHomeworkCompletion | null;
  };
  /** The ten dimensions in canonical order, with the draft's ratings and the
   * colour each rating means. */
  skills: ReportSkill[];
  radar: ReviewRadar;
  teacherSummary: TeacherSummary;
  feedback: {
    comment: string;
    strengths: string;
    improvements: string;
    goals: string;
    parentNotes: string;
  };
  meta: {
    /** The application date the document was generated on, "YYYY-MM-DD".
     * A property of THE DOCUMENT. No Review stores it. */
    generatedOn: string;
  };
}

/* ------------------------------------------------------------- the function */

/** A rating read defensively: anything that is not a finite number counts as 0,
 * exactly as src/lib/reviews.ts reads one. */
function ratingOf(skills: Record<string, number> | null | undefined, key: string): number {
  const value = skills?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Exactly the ten canonical ratings, in canonical order, as a fresh object. */
function canonicalSkills(skills: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SKILL_KEYS) out[key] = ratingOf(skills, key);
  return out;
}

/** Build the report a preview draws, from the server's context and the form's
 * CURRENT values.
 *
 * NOTHING IS PERSISTED AND NOTHING IS FETCHED. This is a pure function: the same
 * context and the same draft produce the same report, every time, with no
 * database, no clock and no network. That is what lets a create preview itself
 * before it has ever been saved, and what lets a test assert the whole document.
 *
 * THE DRAFT OWNS THE RATINGS AND THE WORDS. Every number derived from the ten
 * ratings — the average, its label, its colour, the radar, the strongest and
 * weakest skill, the biggest improvement — is computed from `draft.skills` here,
 * not read from the context. Change a rating and all six move.
 *
 * THE SERVER OWNS ATTENDANCE AND HOMEWORK, and editing a review cannot move
 * either: they are looked up by month from the options the server sent. Changing
 * the draft MONTH changes them, because a different month genuinely has
 * different figures; changing a rating or a sentence does not.
 *
 * THE COMPARISON IS THE REVIEW BEFORE THIS MONTH, from the student's own
 * history. `previousReview` matches strictly earlier months, so an edit's own
 * persisted record cannot become its own comparison, and a skipped calendar
 * month still compares against the review that actually precedes it. */
export function buildMonthlyReviewReportDraft(
  context: ReviewComposerData,
  draft: ReviewReportDraft
): MonthlyReviewReport {
  const skills = canonicalSkills(draft.skills);
  const average = reviewAverage(skills);
  const prior = previousReview(context.history, draft.month);
  const monthContext = context.month.options.find((o) => o.month === draft.month) ?? null;

  return {
    student: context.student,
    parent: context.parent,
    period: draft.month,
    summary: {
      overallScore: average,
      performanceLabel: perfLabel(average),
      performanceColor: perfColor(average),
      attendance: monthContext ? monthContext.attendance : null,
      homework: monthContext ? monthContext.homework : null,
    },
    skills: SKILL_KEYS.map((key) => ({
      key,
      label: SKILL_LABEL[key] ?? key,
      rating: skills[key],
      /* THE BAR IS THE SKILL'S OWN BAND, not the report's. Same function, same
       * 1-5 scale, same thresholds as the rating control the teacher just used. */
      color: perfColor(skills[key]),
    })),
    radar: {
      month: draft.month,
      current: radarAxes(skills),
      previous: prior ? { month: prior.month, axes: radarAxes(prior.skills) } : null,
    },
    teacherSummary: buildTeacherSummary(skills, prior ? prior.skills : null),
    feedback: {
      comment: draft.comment,
      strengths: draft.strengths,
      improvements: draft.improvements,
      goals: draft.goals,
      parentNotes: draft.parentNotes,
    },
    meta: { generatedOn: context.appDate },
  };
}

/* ------------------------------------------------- the teacher summary, once */

/** One item of the teacher-summary block, resolved to words AND to the parts a
 * surface needs to lay it out.
 *
 * ---- WHY IT IS PARTS, NOT ONE STRING ---------------------------------------
 *
 * It used to carry only `value` — "Listening, Speaking, Reading · 5" — and every
 * surface drew it as one right-aligned run beside its label. With one strongest
 * skill that read fine. With eight tied at 4 it became a wall of text pressed
 * against a label, on a phone and on paper alike, and human verification called
 * the block unscannable.
 *
 * So the item is now the pieces: the `label`, the `items` it names, and the
 * `detail` they share. A surface can put the label above the names and the
 * figure in its own corner, wrap the names naturally, and give each item its own
 * card — without any of them re-deciding WHICH skills are named or what the
 * label says. `value` remains the one-line form, for anything that genuinely
 * wants a single string. */
export interface TeacherSummaryLine {
  kind: "strongest" | "focus" | "even" | "improvement" | "noPrior";
  label: string;
  /** The skill names this item is about, already translated, in canonical
   * SKILLS order. One entry for a single winner, several for a tie, and for the
   * two non-skill items the phrase they state. Never empty. */
  items: string[];
  /** The figure `items` share — "5", "3/5", "3 -> 5" — or null when the item is
   * a statement rather than a measurement. */
  detail: string | null;
  /** `items` and `detail` as one line. The same string this shape carried before
   * it grew parts, so a caller that wants one run still has one. */
  value: string;
  /** The one non-answer — "First review — no prior month" — is set quieter than
   * a real finding, on every surface. */
  muted: boolean;
  /** WHICH OF THE APP'S EXISTING TOKENS THIS ITEM IS KEYED TO. Green for a
   * strength and amber for a focus area are the same pair the profile card and
   * the report's own feedback headings already use; sky is movement, and muted
   * is the non-answer. Named rather than resolved, so each surface reaches for
   * it in its own colour space — a CSS custom property on screen, ink in the
   * PDF — without a second opinion about which item is which. */
  tone: "green" | "amber" | "sky" | "muted";
}

/** The teacher summary as the composer card, the report sheet and the PDF all
 * state it.
 *
 * ---- WHY THIS IS ONE FUNCTION ---------------------------------------------
 *
 * The three surfaces used to each read `teacherSummary` and compose their own
 * strings. They agreed only because three separate pieces of JSX happened to say
 * the same thing, and the tie-aware shape makes that far harder to keep up:
 * which label is singular, how tied skills are joined, what the all-equal state
 * says. So the words are decided ONCE, here, and the surfaces render them.
 *
 * ---- WHAT IT WILL NOT DO --------------------------------------------------
 *
 * It composes no prose. Every item is a label and the skills it names — there is
 * no sentence generated about a child anywhere in it, which is the same contract
 * the rest of this module keeps. The all-equal case is a structured item
 * (`Skill ratings` / `All skills` / `3/5`), not a generated sentence, for exactly
 * that reason.
 *
 * ---- TIES ------------------------------------------------------------------
 *
 * Every skill at the extreme rating is named, in canonical SKILLS order, with
 * the shared rating stated once as `detail`. The label follows the count, so a
 * single winner still reads "Strongest skill" and never announces a set of one. */
export function teacherSummaryLines(
  report: MonthlyReviewReport,
  t: (key: string) => string,
): TeacherSummaryLine[] {
  const { teacherSummary: summary, skills, radar } = report;
  const lines: TeacherSummaryLine[] = [];
  const line = (
    kind: TeacherSummaryLine["kind"],
    tone: TeacherSummaryLine["tone"],
    label: string,
    items: string[],
    detail: string | null,
    muted = false,
  ): TeacherSummaryLine => ({
    kind, label, items, detail, muted, tone,
    value: detail === null ? items.join(", ") : `${items.join(", ")} · ${detail}`,
  });

  if (summary.allEqual && summary.equalRating !== null) {
    /* THE NEUTRAL STATE. Ten equal ratings support no strongest and no focus
     * area, so the block states the one true thing instead of manufacturing a
     * distinction out of the canonical order. */
    lines.push(line("even", "muted", t("Skill ratings"),
      [t("All skills")], `${summary.equalRating}/5`));
  } else {
    if (summary.strongest.length > 0) {
      lines.push(line("strongest", "green",
        t(summary.strongest.length === 1 ? "Strongest skill" : "Strongest skills"),
        summary.strongest.map((s) => t(s.label)),
        String(summary.strongest[0].rating)));
    }
    if (summary.focusAreas.length > 0) {
      lines.push(line("focus", "amber",
        t(summary.focusAreas.length === 1 ? "Focus area" : "Focus areas"),
        summary.focusAreas.map((s) => t(s.label)),
        String(summary.focusAreas[0].rating)));
    }
  }

  /* UNCHANGED: one strictly positive movement, or the first-review statement. */
  if (summary.improvement) {
    const label = skills.find((s) => s.key === summary.improvement!.key)?.label
      ?? summary.improvement.key;
    lines.push(line("improvement", "sky", t("Biggest improvement"),
      [t(label)], `${summary.improvement.from} → ${summary.improvement.to}`));
  } else if (radar.previous === null) {
    lines.push(line("noPrior", "muted", t("Biggest improvement"),
      [t("First review — no prior month")], null, true));
  }

  return lines;
}

/* The analytics shapes a report carries are re-exported so a consumer has ONE
 * import surface for the report model — and so Gate 4.4E's Print and PDF reach
 * the same types this preview does rather than restating them. */
export type { TeacherSummary, ReviewRadar, ReviewSkillsSnapshot };

/* The two derived metrics a report carries, re-exported from the ONE module a
 * Reviews surface imports. They are computed in src/lib/finance.ts, beside the
 * aggregates they must agree with, and they arrive here already calculated —
 * this is a type re-export and nothing more. It exists so a Reviews component
 * has a single import surface for the report model, and so no client file has to
 * reach into another module's file to name the shape of a percentage. */
export type { StudentAttendanceRate, StudentHomeworkCompletion };

/** The review that precedes `month` in this student's own chronology, or null.
 *
 * A NAMED RE-EXPORT OF `previousReview`, typed to the composer's own history
 * entry, so the editor and the report ask the same question the same way and
 * neither reimplements "which month came before this one". PREVIOUS MEANS
 * PREVIOUS REVIEW, not previous calendar month. */
export function previousReviewOf(
  history: readonly ReviewHistoryEntry[] | null | undefined,
  month: string
): ReviewHistoryEntry | null {
  return previousReview(history, month);
}
