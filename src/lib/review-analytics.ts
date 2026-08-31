/* Reviews — the pure analytics.
 *
 * Every chart the Gate 4.4A amendment brings into Sprint 8 is a function over
 * stored Review values, and every one of them lives here as exactly that: plain
 * data in, plain data out, no database, no clock, no React and no formatting.
 * The screens that draw these shapes decide how a number LOOKS; this module
 * decides what it IS.
 *
 * NO `server-only`, for the reason src/lib/reviews.ts has none: the decisions
 * are exercised by the test runner, which cannot resolve that module.
 *
 * THE APPLICATION MONTH IS AN ARGUMENT, never a wall clock. `new Date()` appears
 * nowhere below, and the trend windows take the month they are relative to from
 * their caller — so a test states the month it expects rather than tracking
 * CURRENT_MONTH, and this module never becomes a second source of app time.
 *
 * NOTHING IS DERIVED FROM ANOTHER DOMAIN. Attendance and Homework percentages
 * are real, approved metrics, but they are computed in src/lib/finance.ts beside
 * the aggregates they must agree with, and they are handed to a report already
 * calculated. They are not recomputed here, and no chart in this file consults
 * them: a radar, a trend, a distribution and a heatmap are made of ratings the
 * teacher wrote, and nothing else.
 *
 * NOTHING IS GENERATED. There is no achievement, no concern and no summary
 * prose anywhere in this module, deliberately — no stored field carries them and
 * no deterministic rule produces them, so inventing one would be the system
 * putting a judgement about a real child into a teacher's mouth.
 *
 * CANONICAL KEYS, NOT LABELS. The shapes below carry `key` and numbers; the UI
 * resolves a key to its display label through the existing SKILL_LABEL and
 * translates it there. The one exception is the teacher summary, which reuses
 * `rankSkills`'s own `SkillRating` shape rather than restating it — the gate
 * that approved this work asked for that function specifically.
 */

import { SKILL_KEYS, monthsAgo, rankSkills, reviewAverage } from "./reviews";
import type { SkillRating } from "./reviews";

/* ------------------------------------------------------------------ shared */

/** The minimum a chart needs of a review: which month, and the ten ratings.
 *
 * A STRUCTURAL SUBSET, so both a stored `Review` and the `ReviewDetail` the API
 * sends satisfy it without a conversion step, and so a chart can never reach a
 * field it has no business reading — there is no id here, no student, no prose. */
export interface ReviewSkillsSnapshot {
  month: string;
  skills: Record<string, number>;
}

/** A rating read defensively: anything that is not a finite number is absent
 * rather than zero. Validation guarantees ten integers on the way in; this
 * guards what is already stored, and `null` is what lets a heatmap leave a cell
 * empty instead of painting a 0 that nobody awarded. */
function ratingOf(skills: Record<string, number> | null | undefined, key: string): number | null {
  const value = skills?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Oldest first. The reviews module's own history is NEWEST first, which is what
 * a timeline wants and the opposite of what a chart wants, so the order is
 * stated here rather than assumed — and the input array is never sorted in
 * place. Reviews sharing a month fall back to month equality only; the create
 * planner refuses a second review for one month, so no further tiebreak can
 * matter to a chart. */
function chronological<T extends { month: string }>(reviews: readonly T[] | null | undefined): T[] {
  return [...(reviews ?? [])].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/** The review immediately BEFORE `month` in this student's own chronology.
 *
 * PREVIOUS MEANS PREVIOUS REVIEW, NOT PREVIOUS CALENDAR MONTH. A teacher who
 * wrote March and then May has a comparison available in May; asking for April
 * would answer "no previous review" for a month that plainly has one, and the
 * design's own copy — "First review — no prior month" — reserves that answer for
 * a student's genuine first review. */
export function previousReview<T extends { month: string }>(
  reviews: readonly T[] | null | undefined,
  month: string
): T | null {
  const earlier = chronological(reviews).filter((r) => r.month < month);
  return earlier.length === 0 ? null : earlier[earlier.length - 1];
}

/* ------------------------------------------------------------------- radar */

/** One axis of the radar: a canonical skill key and its rating. */
export interface RadarAxis {
  key: string;
  rating: number | null;
}

/** The radar for one review, with its comparison if there is one. */
export interface ReviewRadar {
  month: string;
  /** The ten axes, in canonical SKILLS order. Always ten. */
  current: RadarAxis[];
  /** The previous review's ten axes, or `null` on a first review. */
  previous: { month: string; axes: RadarAxis[] } | null;
}

/** The ten ratings of one review, in canonical order. */
export function radarAxes(skills: Record<string, number> | null | undefined): RadarAxis[] {
  return SKILL_KEYS.map((key) => ({ key, rating: ratingOf(skills, key) }));
}

/** The radar for `selected`, compared against the review before it.
 *
 * `history` is the student's reviews in any order — this sorts its own copy. The
 * comparison is `previousReview`, so a skipped calendar month still compares
 * against the review that actually precedes it. */
export function buildReviewRadar(
  selected: ReviewSkillsSnapshot,
  history: readonly ReviewSkillsSnapshot[] | null | undefined
): ReviewRadar {
  const prior = previousReview(history, selected.month);
  return {
    month: selected.month,
    current: radarAxes(selected.skills),
    previous: prior ? { month: prior.month, axes: radarAxes(prior.skills) } : null,
  };
}

/* ------------------------------------------------------------------- trend */

/** One point on the overall-score trend. */
export interface TrendPoint {
  month: string;
  /** The review's own equal-weighted average, raw — the screen rounds it. */
  average: number;
}

/** One point per review, oldest first.
 *
 * NO INTERPOLATION AND NO ZERO-FILLING. A month with no review contributes no
 * point, so a gap in the line is a gap in the record — which is the truth. A
 * zero would read as a catastrophic month; a straight line between two real
 * points would be a score nobody awarded. */
export function reviewTrend(
  reviews: readonly ReviewSkillsSnapshot[] | null | undefined
): TrendPoint[] {
  return chronological(reviews).map((r) => ({ month: r.month, average: reviewAverage(r.skills) }));
}

/** The 6M and 12M ranges the design's own control offers. */
export const TREND_WINDOWS = [6, 12] as const;
export type TrendWindow = (typeof TREND_WINDOWS)[number];

/** The points falling inside the last `months` months, ending at `appMonth`.
 *
 * MEASURED FROM THE APPLICATION MONTH, NOT FROM THE NEWEST REVIEW. "The last six
 * months" is a statement about now; anchoring it to the newest review would make
 * a student last reviewed in January show a "6M" chart of the previous summer
 * and quietly relabel stale data as recent.
 *
 * The window is inclusive of `appMonth` and spans `months` months back, so 6M
 * over an application month of 2026-07 admits 2026-02 through 2026-07 — the same
 * shape `isSelectableMonth` uses for its own twelve. A FUTURE month is excluded:
 * `monthsAgo` returns a negative distance for one, and no review should have a
 * month ahead of the app clock anyway.
 *
 * Order is preserved; nothing is padded to length. */
export function trendWindowPoints(
  points: readonly TrendPoint[] | null | undefined,
  appMonth: string,
  months: number
): TrendPoint[] {
  return (points ?? []).filter((p) => {
    const back = monthsAgo(p.month, appMonth);
    return back != null && back >= 0 && back < months;
  });
}

/* ------------------------------------------------------------ distribution */

/** One bucket of the score distribution: a rating, and how many of the ten
 * skills were given it. */
export interface DistributionBucket {
  /** 1..5 — the rating itself, which is also the bucket. */
  rating: number;
  count: number;
  /** `count / 10` as a whole percent. */
  pct: number;
}

/** The five rating buckets, 1 through 5, for ONE review.
 *
 * THIS IS A DISTRIBUTION ACROSS TEN SKILLS, NOT ACROSS STUDENTS. The design's
 * own subtitle says so — "Across 10 skills this month" — so the donut answers
 * "how did this student's ten dimensions fall this month", never "where does
 * this student sit among their peers", which is a question this app does not ask
 * and has no data model for.
 *
 * FIVE BUCKETS, ONE PER RATING VALUE. Sprint 8 ratings are required integers in
 * 1..5, so the five values ARE the five buckets and no threshold has to be
 * invented to group them. The screen colours each with the app's existing
 * `perfColor(rating)` — which the rating control in the drawer already does on
 * this same scale — so no new palette or band appears either.
 *
 * ZERO-COUNT BUCKETS ARE KEPT. The shape is always five entries in ascending
 * rating order, so a caller can index it and a chart can decide for itself
 * whether to draw or omit an empty slice. `count` sums to ten and `pct` to 100
 * for any review carrying the ten canonical ratings. */
export function reviewDistribution(
  skills: Record<string, number> | null | undefined
): DistributionBucket[] {
  const counts = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  let rated = 0;
  for (const key of SKILL_KEYS) {
    const rating = ratingOf(skills, key);
    if (rating == null || !counts.has(rating)) continue;
    counts.set(rating, (counts.get(rating) ?? 0) + 1);
    rated++;
  }
  return [1, 2, 3, 4, 5].map((rating) => {
    const count = counts.get(rating) ?? 0;
    return { rating, count, pct: rated === 0 ? 0 : Math.round((count / rated) * 100) };
  });
}

/* ---------------------------------------------------------------- heatmap */

/** One skill's row across the review months. */
export interface HeatmapRow {
  key: string;
  /** One cell per month in `months`, same order. `null` where that review has
   * no rating stored for this skill — which the ten-required schema prevents,
   * so it can only mean a legacy document. */
  cells: (number | null)[];
}

/** The skill-trend heatmap. */
export interface ReviewHeatmap {
  /** The review months, oldest first. ONLY months that have a review. */
  months: string[];
  /** Ten rows, in canonical SKILLS order. */
  rows: HeatmapRow[];
}

/** Rows = the ten skills, columns = the months that have a review.
 *
 * A MONTH WITHOUT A REVIEW IS NOT A COLUMN. It is not a column of zeroes, not a
 * column of blanks and not an interpolated column — it is absent, because the
 * heatmap charts what was assessed and nothing was. That keeps the grid honest
 * at the cost of unequal spacing, which is the correct trade: a chart that
 * spaces months evenly by inventing them is lying about the record. */
export function buildReviewHeatmap(
  reviews: readonly ReviewSkillsSnapshot[] | null | undefined
): ReviewHeatmap {
  const ordered = chronological(reviews);
  return {
    months: ordered.map((r) => r.month),
    rows: SKILL_KEYS.map((key) => ({
      key,
      cells: ordered.map((r) => ratingOf(r.skills, key)),
    })),
  };
}

/* ------------------------------------------------------- skill deltas */

/** One skill's movement between two reviews. */
export interface SkillDelta {
  key: string;
  /** The previous review's rating. */
  from: number;
  /** The latest review's rating. */
  to: number;
  /** `to - from`. Positive is improvement. */
  delta: number;
}

/** The skill that improved most between the previous review and this one.
 *
 * STRICTLY POSITIVE. A month in which every skill held or fell has no biggest
 * improvement, and the answer is `null` — never the least-bad decline dressed up
 * as progress, which would be the report congratulating a student on getting
 * worse more slowly.
 *
 * Ties break on canonical SKILLS order, so the same pair of reviews always
 * produces the same answer. `null` when there is no previous review, when either
 * side is missing a rating, or when nothing rose. */
export function biggestImprovement(
  latest: Record<string, number> | null | undefined,
  previous: Record<string, number> | null | undefined
): SkillDelta | null {
  if (!latest || !previous) return null;
  let best: SkillDelta | null = null;
  for (const key of SKILL_KEYS) {
    const to = ratingOf(latest, key);
    const from = ratingOf(previous, key);
    if (to == null || from == null) continue;
    const delta = to - from;
    if (delta <= 0) continue;
    // Strictly greater, so an equal delta leaves the earlier canonical skill in
    // place — that is the tie-break, expressed as a comparison rather than a sort.
    if (best == null || delta > best.delta) best = { key, from, to, delta };
  }
  return best;
}

/* -------------------------------------------------------- teacher summary */

/** The deterministic half of the design's teacher-summary block.
 *
 * WHAT IS NOT HERE IS THE POINT. The design also shows a "concern" line and the
 * profile journey shows an "achievement" callout. Neither has a stored field and
 * neither has an approved rule, so neither is derived, guessed or generated —
 * there is no property on this type for a screen to render.
 *
 * ---- WHY THIS IS TWO ARRAYS RATHER THAN TWO SKILLS -------------------------
 *
 * It used to be `strongest: SkillRating | null` and `weakest: SkillRating | null`,
 * each the head of `rankSkills`. That is a deterministic answer to a question
 * the ratings often cannot answer. Given
 *
 *     Listening 4 · Speaking 4 · Reading 4 · Writing 3 · Grammar 3
 *
 * it printed "Best skill: Listening" and "Weakest skill: Writing" on a document
 * that goes home to a family — naming one of three equals as the winner, and one
 * of two equals as the problem, on the strength of nothing but the position of a
 * key in the SKILLS constant. The tie-break was stable and the sentence was
 * false. So the shape now carries EVERY skill holding the extreme rating, and a
 * surface that renders it cannot invent a single winner, because there is no
 * single value for it to render.
 */
export interface TeacherSummary {
  /** Every skill of the latest review holding the HIGHEST rating, in canonical
   * SKILLS order. Empty when there are no ratings — and empty when every skill
   * is equal, see `allEqual`. */
  strongest: SkillRating[];
  /** Every skill holding the LOWEST rating, in canonical SKILLS order. Empty on
   * the same two conditions.
   *
   * NOT "weakest". The teacher-facing word for the lowest-rated dimensions of a
   * real child is the one this app already uses on the profile card and in the
   * report's own feedback heading: focus, areas for improvement. */
  focusAreas: SkillRating[];
  /** Largest positive movement against the previous review, or `null`. */
  improvement: SkillDelta | null;
  /** True when all ten ratings hold the same value.
   *
   * THE NEUTRAL STATE. "Strongest: all ten" beside "Focus areas: all ten" is a
   * contradiction that adds no information, so both arrays are EMPTY here and
   * this flag is what a surface renders instead. Making it structural rather
   * than a rule each screen has to remember is what stops one surface from
   * getting it wrong. */
  allEqual: boolean;
  /** The rating they all hold, when `allEqual`; otherwise `null`. */
  equalRating: number | null;
}

/** Strongest, focus areas and biggest improvement — and nothing else.
 *
 * BOTH SETS REUSE `rankSkills`, the same ranking the profile's strengths and
 * focus-areas card already draws: it orders by rating and breaks ties on the
 * canonical SKILLS order, so filtering its own extreme value out of each list
 * keeps EVERY tied skill and keeps them in canonical display order. Canonical
 * order still decides how ties are DISPLAYED; it no longer decides which one is
 * true.
 *
 * `count` is the whole vocabulary, because "which skills are highest" can
 * legitimately answer with all ten — which is exactly the case `allEqual`
 * intercepts before it can be rendered as a distinction. */
export function buildTeacherSummary(
  latest: Record<string, number> | null | undefined,
  previous: Record<string, number> | null | undefined
): TeacherSummary {
  const empty: TeacherSummary = {
    strongest: [], focusAreas: [], improvement: null, allEqual: false, equalRating: null,
  };
  if (!latest) return empty;

  const { strengths, focus } = rankSkills(latest, SKILL_KEYS.length);
  if (strengths.length === 0) return empty;

  const maxRating = strengths[0].rating;
  const minRating = focus[0].rating;
  /* UNCHANGED, DELIBERATELY. The biggest improvement stays one strictly positive
   * delta with a canonical tie-break: it is a claim about MOVEMENT between two
   * months, where a tie is far rarer and where naming one skill states nothing
   * false about the others — none of them is being called the weak one. */
  const improvement = biggestImprovement(latest, previous);

  if (maxRating === minRating) {
    return { strongest: [], focusAreas: [], improvement, allEqual: true, equalRating: maxRating };
  }
  return {
    strongest: strengths.filter((s) => s.rating === maxRating),
    focusAreas: focus.filter((s) => s.rating === minRating),
    improvement,
    allEqual: false,
    equalRating: null,
  };
}

/* --------------------------------------------------------- the whole set */

/** Every chart for one selected review, assembled once.
 *
 * A SINGLE SHAPE SO THE SURFACES CANNOT DRIFT. The profile's analytics tab, the
 * dedicated review page and the PDF all read the same object, computed once from
 * the same history — which is the only structural guarantee that the radar on
 * one screen and the radar on another are the same radar.
 *
 * The Attendance and Homework percentages are NOT here. They come from
 * src/lib/finance.ts, are about other domains, and are attached by whoever
 * assembles the report — keeping this module made only of ratings. */
export interface ReviewAnalytics {
  month: string;
  /** The selected review's equal-weighted average, raw. */
  average: number;
  radar: ReviewRadar;
  distribution: DistributionBucket[];
  trend: TrendPoint[];
  heatmap: ReviewHeatmap;
  summary: TeacherSummary;
}

/** Build every chart for `selected` against the student's own history.
 *
 * `history` should be that one student's reviews; this function does not filter
 * by student, because it is never given more than one student's records — the
 * service selects them, and a pure function that re-checked ownership would be
 * restating a rule it cannot enforce. */
export function buildReviewAnalytics(
  selected: ReviewSkillsSnapshot,
  history: readonly ReviewSkillsSnapshot[] | null | undefined
): ReviewAnalytics {
  const prior = previousReview(history, selected.month);
  return {
    month: selected.month,
    average: reviewAverage(selected.skills),
    radar: buildReviewRadar(selected, history),
    distribution: reviewDistribution(selected.skills),
    trend: reviewTrend(history),
    heatmap: buildReviewHeatmap(history),
    summary: buildTeacherSummary(selected.skills, prior ? prior.skills : null),
  };
}
