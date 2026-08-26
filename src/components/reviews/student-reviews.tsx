"use client";

/* The Student Profile's Reviews tab — the comp's "TAB: REVIEWS (performance)"
 * section, reduced to exactly the blocks Sprint 8 owns.
 *
 * WHAT IS HERE, AND WHY THE REST IS NOT. The comp's performance tab is a whole
 * analytics screen: three summary cards, a skill radar, a score trend, a
 * distribution donut, a skill heatmap, a monthly learning journey, an AI
 * summary and an achievement line. Every one of those reads data this sprint
 * does not own — attendance rates, homework completion, cross-month aggregates,
 * generated prose — so they are OMITTED WHOLE rather than drawn as disabled
 * shells that would suggest they already work. What remains is the part built
 * out of Reviews alone, in the comp's own markup:
 *
 *   - the "Learning analytics" header with its latest-review subtitle and the
 *     Write review action;
 *   - the "Monthly reviews" timeline, newest first, with Quick view and Edit;
 *   - the "Strengths & focus areas" card, from the LATEST review only.
 *
 * ONE ENDPOINT. `GET /api/reviews/student/:id`, through the Gate 4.3 client.
 * Nothing here reaches Dashboard, Attendance, Homework, Finance, Classes or
 * Lessons — not for a number, not for a label, not for a colour.
 *
 * THE SCREEN DERIVES NOTHING. Each review's average is the server's
 * (`ReviewDetail.average`); the label and colour come from the one guarded
 * `reviewScore`; the strengths and focus areas come from the domain's own
 * `rankSkills` over the skills the payload already carries. No aggregate is
 * recomputed here and no historical average is averaged again.
 *
 * NO SECOND FORM. Create and Edit both open the Gate 4.3 `ReviewDrawer` — the
 * same fields, the same validation, the same dirty-dismiss guard, the same
 * bodies on the wire. This file decides which mode it opens in and nothing else.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ReviewDrawer } from "@/components/reviews/review-drawer";
import { reviewScore } from "@/components/reviews/reviews-ui";
import { ScoreDonut, ScoreTrend, SkillHeatmap, SkillRadar } from "@/components/reviews/charts";
import { hasAvailableMonth } from "@/components/reviews/form";
import { TREND_WINDOWS, trendWindowPoints, type TrendWindow } from "@/lib/review-analytics";
import {
  createReview, fetchStudentReviews, reviewKeys, updateReview, ReviewApiError,
} from "@/components/reviews/api";
import { rankSkills } from "@/lib/reviews";
import type { ReviewDetail } from "@/lib/reviews-service";
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

const iconWrite = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const iconCheck = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const iconFocus = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M12 4v2" /><circle cx="12" cy="10" r="0.5" /></svg>
);

/* The comp's card surface for this tab: the shared card tokens with the
 * performance tab's own 18px/20px padding. `minWidth: 0` because these are grid
 * items, and a grid item defaults to `min-width: auto` — the same line, for the
 * same reason, is in reviewCardStyle. */
const panel: React.CSSProperties = {
  minWidth: 0,
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)",
  boxShadow: "var(--sh)", padding: "18px 20px",
};

/** The comp's link-styled row action ("Quick view" / "Edit"). */
const rowAction = (strong: boolean): React.CSSProperties => ({
  border: "none", background: "none",
  color: strong ? "var(--fg-2)" : "var(--muted)",
  fontSize: 11.5, fontWeight: strong ? 600 : 500, fontFamily: "inherit",
  cursor: "pointer", padding: 0,
});

/** The primary action, in the comp's header geometry. */
const primaryBtn: React.CSSProperties = {
  height: 38, padding: "0 15px", border: "none", borderRadius: 9,
  background: "var(--primary)", color: "var(--primary-fg)",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
};

export function StudentReviews({ studentId }: { studentId: string }) {
  const { t, fmt } = useSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  /** Create is a boolean — the month is the server's to offer. Edit carries the
   * review it opens on, which is what makes the drawer's student and month the
   * record's own without this file having to enforce it. */
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<ReviewDetail | null>(null);
  /** Which timeline rows have their Quick view open. Presentation state only. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Radar overlay and trend range — both presentation state, both local. */
  const [compare, setCompare] = useState(false);
  const [windowMonths, setWindowMonths] = useState<TrendWindow>(12);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: reviewKeys.student(studentId),
    queryFn: () => fetchStudentReviews(studentId),
  });

  /** A review changes reviews, and the Dashboard's "Reviews to write" counter.
   *
   * THE DASHBOARD IS MARKED STALE WITHOUT BEING FETCHED, for the reason the
   * Reviews index states: `GET /api/dashboard` advances the lesson lifecycle,
   * which WRITES to Lessons, so an active refetch would turn saving a review
   * into a lesson mutation nobody asked for.
   *
   * `reviewKeys.all` covers this tab's own cache and the Reviews index in one
   * call. Nothing else is invalidated — a review changes no student, class,
   * lesson, register or assignment. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: reviewKeys.all });
    qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
  };

  const createMutation = useMutation({
    mutationFn: (body: ReviewCreateBody) => createReview(body),
    onSuccess: () => { invalidate(); setWriting(false); toast(t("Review saved")); },
    onError: (e: Error) => {
      toast(t(e.message), "error");
      /* A duplicate month means this client's month list is stale — the month
       * was written elsewhere, or in another tab. One refetch corrects the
       * options; the drawer stays open with the teacher's words intact. */
      if (e instanceof ReviewApiError && e.code === "review_already_exists") {
        qc.invalidateQueries({ queryKey: reviewKeys.all });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewUpdateBody }) => updateReview(id, body),
    onSuccess: () => { invalidate(); setEditing(null); toast(t("Review saved")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  if (isLoading) return <SkeletonTab />;

  if (isError || !data) {
    /* AN INLINE FAILURE. Only the tab failed — the profile header, the tablist
     * and every other tab are still there, so this replaces the panel and never
     * the page. */
    return (
      <div style={{ ...panel, padding: "48px 24px", textAlign: "center" }}>
        <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load reviews")}</div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
          {t("Something went wrong while fetching the list. Check your connection and try again.")}
        </p>
        <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, margin: "0 auto" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
          {t("Try again")}
        </button>
      </div>
    );
  }

  const {
    student, reviews, months, canCreate, parentLinked,
    analytics, latestMetrics, metricsByMonth, defaultMonth,
  } = data;

  /* Each reviewed month's derived metrics, by month, so the journey can put a
   * month's numbers beside that month's words without searching an array per
   * row. Built from the payload; nothing is computed here. */
  const metricsFor = new Map(metricsByMonth.map((m) => [m.month, m]));

  /* THE CTA'S TWO CONDITIONS ARE DIFFERENT QUESTIONS, and they are answered
   * differently. `canCreate` is the server's eligibility rule — false for an
   * Archived student, whose history stays readable and whose existing reviews
   * stay editable, but who may not be given a NEW one, so the button is not
   * drawn at all. A month being available is a fact about this student's last
   * twelve months: when every one of them is already reviewed the action still
   * exists, it simply has nothing left to write, so it is DISABLED in the app's
   * existing `button:disabled` treatment. It never becomes an Edit, and no
   * thirteenth month is invented — the months are the server's list. */
  const monthAvailable = hasAvailableMonth(months);

  /* NEWEST FIRST is the server's order (`buildReviewHistory`), and it is not
   * re-sorted here. The first entry is therefore the latest review — the one
   * the header names and the only one the strengths card reads. */
  const latest = reviews[0] ?? null;
  /* `null` only when there is no review at all — the same fact `latest === null`
   * states, and the reason an absent assessment renders the empty state rather
   * than a shell of zeroed charts. */
  const latestScore = latest ? reviewScore(latest.average) : null;

  const writeButton = (style: React.CSSProperties) => (
    <button
      onClick={() => setWriting(true)}
      disabled={!monthAvailable}
      className="btn-primary"
      style={style}
    >
      {iconWrite}
      {t("Write review")}
    </button>
  );

  const drawerStudent = {
    id: student.id, name: student.name, initials: student.initials,
    color: student.color, avatar: student.avatar, gradeLabel: student.gradeLabel,
  };

  return (
    <div style={{ minWidth: 0 }}>
      {latest === null || analytics === null ? (
        /* The comp's empty performance tab. NO SCORE, NO ANALYTICS: a student
         * nobody has assessed has no average, and drawing a 0.0 would be an
         * assessment this app never made — so the whole analytics surface is
         * absent rather than present and zeroed. The server sends `analytics:
         * null` for exactly the same case, and both are checked because either
         * one alone would leave the other unproven to the compiler. */
        <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "48px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: 13.5, margin: canCreate ? "0 0 16px" : 0 }}>
            {t("No monthly reviews yet for this student.")}
          </p>
          {canCreate && writeButton({ ...primaryBtn, padding: "0 16px", fontSize: 13.5, margin: "0 auto" })}
        </div>
      ) : (
        <>
          {/* Header — the comp's "Learning analytics" row. The deferred summary
            * cards sat under it; they are gone entirely rather than left as
            * empty frames. */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "var(--gap)" }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", margin: 0 }}>{t("Learning analytics")}</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 0" }}>
                {t("Latest review")} · {fmt.monthLabel(latest.month)}
              </p>
            </div>
            {canCreate && writeButton(primaryBtn)}
          </div>

          {/* ROW 1 — the comp's summary cards. Attendance and Homework are
            * DERIVED LIVE from canonical data by src/lib/finance.ts and arrive
            * on the payload; neither is stored on a review and neither is the
            * review's own `homework` skill rating, which is a different thing
            * that happens to share a word. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: "var(--gap)", marginBottom: "var(--gap)" }}>
            <div style={{ ...panel, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 13, background: `color-mix(in srgb, ${latestScore?.color ?? "var(--muted)"} 12%, var(--card))`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.02em", color: latestScore?.color, fontFamily: "'Geist Mono',monospace" }}>
                  {latestScore?.value}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>{t("Overall score")}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: latestScore?.color, marginTop: 2 }}>
                  {latestScore ? t(latestScore.label) : t("No data")}
                </div>
              </div>
            </div>

            <MetricCard
              label={t("Attendance")}
              pct={latestMetrics?.attendance.pct ?? null}
              /* Coverage, kept secondary: a percentage over two registers and a
               * percentage over twenty are not the same claim, and the design's
               * single big number cannot say which this is. */
              detail={
                latestMetrics && latestMetrics.attendance.lessonsCompleted > 0
                  ? `${t("Registers taken")} ${latestMetrics.attendance.registersTaken}/${latestMetrics.attendance.lessonsCompleted}`
                  : null
              }
            />

            <MetricCard
              label={t("Homework completion")}
              pct={latestMetrics?.homework.pct ?? null}
              detail={
                latestMetrics && latestMetrics.homework.total > 0
                  ? `${latestMetrics.homework.done}/${latestMetrics.homework.total}`
                  : null
              }
            />
          </div>

          {/* ROW 2 — radar, trend, distribution. The comp's own auto-fit track;
            * `min(...,100%)` is this app's remediated form of it, so below 290px
            * the column pays for the item instead of overflowing. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(290px,100%),1fr))", gap: "var(--gap)", alignItems: "stretch", marginBottom: "var(--gap)" }}>
            <div style={{ ...panel, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Skill radar")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("10 skills · rated 1–5")}</div>
                </div>
                {/* NO PREVIOUS REVIEW, NO CONTROL. A disabled Compare button would
                  * advertise a comparison that does not exist; a second series
                  * drawn from nothing would be a fabrication. */}
                {analytics.radar.previous && (
                  <button
                    onClick={() => setCompare((v) => !v)}
                    aria-pressed={compare}
                    className="btn-ghost"
                    style={{ flex: "none", height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, background: compare ? "var(--card-2)" : "var(--card)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {t("Compare")}
                  </button>
                )}
              </div>
              <SkillRadar
                current={analytics.radar.current}
                previous={analytics.radar.previous?.axes ?? null}
                compare={compare}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 6 }}>
                <LegendSwatch color="var(--green)" label={fmt.monthLabel(analytics.radar.month)} />
                {compare && analytics.radar.previous && (
                  <LegendSwatch color="var(--sky)" label={fmt.monthLabel(analytics.radar.previous.month)} muted />
                )}
              </div>
            </div>

            <div style={{ ...panel, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Progress over time")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("Overall score trend")}</div>
                </div>
                {/* 6M / 12M are the comp's own literals — symbols rather than
                  * copy, so they are not put through the dictionary. */}
                <div style={{ display: "flex", gap: 6, flex: "none" }}>
                  {TREND_WINDOWS.map((w) => (
                    <button
                      key={w}
                      onClick={() => setWindowMonths(w)}
                      aria-pressed={windowMonths === w}
                      style={{ height: 28, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 8, background: windowMonths === w ? "var(--card-2)" : "var(--card)", color: windowMonths === w ? "var(--fg)" : "var(--muted)", fontSize: 11.5, fontWeight: windowMonths === w ? 600 : 500, fontFamily: "inherit", cursor: "pointer" }}
                    >
                      {w}M
                    </button>
                  ))}
                </div>
              </div>
              {/* The window is anchored to the SERVER's application month. The
                * client reads no clock. */}
              <ScoreTrend points={trendWindowPoints(analytics.trend, defaultMonth, windowMonths)} />
            </div>

            <div style={{ ...panel, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{t("Score distribution")}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>{t("Across 10 skills this month")}</div>
              <ScoreDonut buckets={analytics.distribution} averageLabel={latestScore?.value ?? ""} />
              {/* The comp's AI summary panel sat here. It is omitted whole: no
                * stored field carries it and no rule produces it. */}
            </div>
          </div>

          {/* ROW 3 — heatmap, timeline, strengths. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(290px,100%),1fr))", gap: "var(--gap)", alignItems: "start" }}>
            <div style={panel}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Skill trend heatmap")}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("Rating by month")}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--muted-2)", flex: "none" }}>
                  {t("Low")}
                  <span style={{ width: 44, height: 8, borderRadius: 99, background: "linear-gradient(90deg, color-mix(in srgb,var(--green) 18%,var(--card)), var(--green))" }} />
                  {t("High")}
                </div>
              </div>
              <SkillHeatmap data={analytics.heatmap} />
            </div>

            {/* Monthly reviews timeline. The comp's "View all →" is omitted:
              * this IS the full history, so the link has no destination. */}
            <div style={panel}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("Monthly reviews")}</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {reviews.map((r, i) => {
                  /* The server's average, formatted to one decimal and given the
                   * app's existing performance label and colour band. */
                  const score = reviewScore(r.average);
                  const open = expanded[r.id] === true;
                  /* Only what the teacher actually wrote. An empty field is not
                   * a subsection, and a review with no assessment prose at all
                   * has no Quick view to open. */
                  const quick = ([
                    ["Strengths", r.strengths, "var(--green)"],
                    ["Areas for improvement", r.improvements, "var(--amber)"],
                    ["Learning goals", r.goals, "var(--sky)"],
                  ] as const).filter(([, value]) => value.trim() !== "");
                  const last = i === reviews.length - 1;
                  return (
                    <div key={r.id} style={{ display: "flex", gap: 12, minWidth: 0 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                        <span style={{ minWidth: 11, width: 11, height: 11, borderRadius: "50%", background: score ? score.color : "var(--border)", flexShrink: 0 }} />
                        {!last && <span style={{ flex: 1, width: 2, background: "var(--border-2)" }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}>
                        {/* The month and its badge wrap rather than overflow: a
                          * long localized month beside "Needs support · 2.1" is
                          * more than a 290px column can hold on one line. */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{fmt.monthLabel(r.month)}</span>
                          {score && (
                            <span style={{ flex: "none", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap", background: `color-mix(in srgb, ${score.color} 13%, var(--card))`, color: score.color }}>
                              {t(score.label)} · <span style={{ fontFamily: "'Geist Mono',monospace" }}>{score.value}</span>
                            </span>
                          )}
                        </div>
                        {/* The comp's two-line summary. Rendered only when the
                          * teacher wrote one — never replaced with filler. */}
                        {r.comment.trim() !== "" && (
                          <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
                            {r.comment}
                          </p>
                        )}
                        {open && quick.length > 0 && (
                          <div style={{ marginTop: 9, background: "var(--card-2)", borderRadius: 10, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                            {quick.map(([label, value, color]) => (
                              <div key={label} style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 10.5, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{t(label)}</div>
                                <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5, overflowWrap: "anywhere" }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                          {quick.length > 0 && (
                            <button
                              onClick={() => setExpanded((prev) => ({ ...prev, [r.id]: !open }))}
                              aria-expanded={open}
                              style={rowAction(true)}
                            >
                              {t("Quick view")}
                            </button>
                          )}
                          {/* EDIT LIVES HERE, and only here. It opens the Gate
                            * 4.3 drawer on this record, whose student and month
                            * are the record's own and neither is a control.
                            * There is no Delete: a review is a historical record
                            * of a month and no endpoint removes one. */}
                          <button onClick={() => setEditing(r)} style={rowAction(false)}>{t("Edit")}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Strengths & focus areas — THE LATEST REVIEW ONLY.
              *
              * `rankSkills` is the domain's own ranking: top three by rating,
              * bottom three by rating, ties broken on the canonical SKILLS
              * order. Nothing is inferred from the review's prose, nothing is
              * weighted, no other month is consulted, and the ratings are the
              * ones the payload already carries rather than a second DTO. */}
            <StrengthsCard skills={latest.skills} />
          </div>

          {/* ROW 4 — the monthly learning journey, newest first.
            *
            * REAL DATA ONLY. Each entry carries the month, that review's own
            * score, the teacher's own words, and the two derived metrics for
            * that month. The comp's achievement callout is omitted whole: no
            * stored field carries one and no deterministic rule produces one, so
            * generating a trophy line for a real child is not something this app
            * will do. */}
          <div style={{ ...panel, padding: "20px 22px", marginTop: "var(--gap)" }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Monthly learning journey")}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("Long-term progress at a glance")}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {reviews.map((r, i) => {
                const score = reviewScore(r.average);
                const m = metricsFor.get(r.month);
                const last = i === reviews.length - 1;
                return (
                  <div key={r.id} style={{ display: "flex", gap: 16, minWidth: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 5 }}>
                      <span style={{ width: 13, height: 13, borderRadius: "50%", background: score ? score.color : "var(--border)", boxShadow: `0 0 0 4px color-mix(in srgb, ${score ? score.color : "var(--border)"} 15%, transparent)` }} />
                      {!last && <span style={{ flex: 1, width: 2, background: "var(--border-2)", marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 22 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{fmt.monthLabel(r.month)}</div>
                        {score && (
                          <span style={{ flex: "none", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap", background: `color-mix(in srgb, ${score.color} 13%, var(--card))`, color: score.color }}>
                            {t(score.label)} · <span style={{ fontFamily: "'Geist Mono',monospace" }}>{score.value}</span>
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                        <JourneyChip label={t("Attendance")} pct={m?.attendance.pct ?? null} noData={t("No data")} />
                        <JourneyChip label={t("Homework")} pct={m?.homework.pct ?? null} noData={t("No data")} />
                      </div>
                      {r.comment.trim() !== "" && (
                        <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, margin: 0, overflowWrap: "anywhere" }}>
                          {r.comment}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* CREATE. The months are the server's; the drawer picks the newest
        * untaken one and leaves the taken ones visible but disabled. */}
      {writing && (
        <ReviewDrawer
          open
          review={null}
          student={drawerStudent}
          parentLinked={parentLinked}
          months={months}
          saving={createMutation.isPending}
          onClose={() => setWriting(false)}
          onCreate={(body) => createMutation.mutate(body)}
        />
      )}

      {/* EDIT. No month options are passed, because an edit may not change its
        * month — the drawer's union type refuses them outright. */}
      {editing && (
        <ReviewDrawer
          open
          review={editing}
          student={drawerStudent}
          parentLinked={parentLinked}
          saving={updateMutation.isPending}
          onClose={() => setEditing(null)}
          onUpdate={(id, body) => updateMutation.mutate({ id, body })}
        />
      )}
    </div>
  );
}

/** One derived percentage, in the comp's summary-card shape.
 *
 * `null` RENDERS "No data", NEVER 0%. The two are different facts — "this
 * student attended nothing" and "nobody took a register" — and a card showing
 * 0% for the second states an assessment the data never made. The metric
 * helpers return `null` precisely so this branch exists.
 *
 * THE NUMBER IS NOT COLOUR-CODED. `perfColor` grades a 1-5 average and there is
 * no threshold anywhere in this app for grading a percentage; the Attendance
 * index renders its own rate in `var(--fg)` for the same reason. Inventing a
 * band here would be inventing a rule. */
function MetricCard({ label, pct, detail }: { label: string; pct: number | null; detail: string | null }) {
  return (
    <div style={{ ...panel, padding: "16px 18px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>{label}</div>
      {pct === null ? (
        <NoData size={17} />
      ) : (
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", marginTop: 4, color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>
          {pct}%
        </div>
      )}
      {detail && (
        <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4, overflowWrap: "anywhere" }}>{detail}</div>
      )}
    </div>
  );
}

/** The absence of a measurement, said plainly. */
function NoData({ size }: { size: number }) {
  const t = useSettings().t;
  return (
    <div style={{ fontSize: size, fontWeight: 600, marginTop: 4, color: "var(--muted-2)" }}>{t("No data")}</div>
  );
}

/** A radar legend entry: the comp's swatch and month label. */
function LegendSwatch({ color, label, muted = false }: { color: string; label: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: muted ? "var(--muted)" : "var(--fg-2)", minWidth: 0 }}>
      <span style={{ minWidth: 11, width: 11, height: 11, borderRadius: 3, background: color, flex: "none" }} />
      <span style={{ overflowWrap: "anywhere" }}>{label}</span>
    </div>
  );
}

/** One derived metric on a journey entry. `null` says so rather than showing 0%. */
function JourneyChip({ label, pct, noData }: { label: string; pct: number | null; noData: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-2)", background: "var(--card-2)", borderRadius: 8, padding: "5px 10px", maxWidth: "100%", minWidth: 0 }}>
      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: pct === null ? "var(--muted-2)" : undefined }}>
        {pct === null ? noData : `${pct}%`}
      </span>
    </span>
  );
}

/** The comp's "Strengths & focus areas" card, over one review's ten ratings. */
function StrengthsCard({ skills }: { skills: Record<string, number> }) {
  const { t } = useSettings();
  const { strengths, focus } = rankSkills(skills);
  return (
    <div style={panel}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{t("Strengths & focus areas")}</div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 9 }}>{t("Top strengths")}</div>
        <SkillRows rows={strengths} color="var(--green)" tint={14} pill={13} icon={iconCheck} />
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 9 }}>{t("Areas for improvement")}</div>
        <SkillRows rows={focus} color="var(--amber)" tint={16} pill={15} icon={iconFocus} />
      </div>
    </div>
  );
}

function SkillRows({
  rows, color, tint, pill, icon,
}: {
  rows: Array<{ key: string; label: string; rating: number }>;
  color: string; tint: number; pill: number; icon: React.ReactNode;
}) {
  const { t } = useSettings();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((s) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ minWidth: 24, width: 24, height: 24, borderRadius: 7, background: `color-mix(in srgb, ${color} ${tint}%, var(--card))`, color, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            {icon}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--fg-2)" }}>{t(s.label)}</span>
          <span style={{ flex: "none", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: `color-mix(in srgb, ${color} ${pill}%, var(--card))`, color, fontFamily: "'Geist Mono',monospace" }}>
            {s.rating}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The tab's loading state, in the shimmer every other list surface uses. */
function SkeletonTab() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: "var(--gap)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 16, width: "36%", borderRadius: 7, ...bar }} />
          <div style={{ height: 11, width: "22%", borderRadius: 6, marginTop: 7, ...bar }} />
        </div>
        <div style={{ height: 38, width: "22%", maxWidth: 132, borderRadius: 9, flex: "none", ...bar }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(290px,100%),1fr))", gap: "var(--gap)", alignItems: "start" }}>
        {[0, 1].map((i) => (
          <div key={i} style={panel}>
            <div style={{ height: 13, width: "44%", borderRadius: 6, ...bar }} />
            {[0, 1, 2].map((j) => (
              <div key={j} style={{ display: "flex", gap: 12, marginTop: 14 }}>
                <div style={{ minWidth: 11, width: 11, height: 11, borderRadius: "50%", ...bar }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 11, width: "50%", borderRadius: 6, ...bar }} />
                  <div style={{ height: 10, width: "80%", borderRadius: 6, marginTop: 7, ...bar }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
