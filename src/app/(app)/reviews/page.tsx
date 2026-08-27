"use client";

/* Reviews index — ported from the design comp's "REVIEWS" screen: the "Monthly
 * reviews" heading and the student card grid, each card carrying the avatar,
 * name, grade, latest average over "avg / 5", the performance label, the review
 * count, the latest month, and the Write review / View performance pair. Data is
 * real, via React Query against /api/reviews.
 *
 * A CARD IS A STUDENT, NOT A REVIEW. The comp's grid is `reviewStudentRows`, and
 * the server builds it from canonical Student data — so a student who has never
 * been reviewed still gets a card, which is the whole point of a screen whose
 * primary action is "write one".
 *
 * THE SUBTITLE IS DELIBERATELY ABSENT. `reviewsSubtitle` is a computed binding
 * with no literal anywhere in the comp or the dictionary, so it is omitted whole
 * rather than approximated — exactly what the Homework index did with its own
 * count subtitle, and for the same reason. The heading keeps its own margin, so
 * nothing renders an empty container.
 *
 * WRITE REVIEW IS A LINK, NOT A DRAWER. Gate 4.4D moved the review form onto
 * its own route, so this card's primary action navigates to
 * /reviews/new?studentId={id} and this screen holds no form, no mutation and no
 * form state at all. What it passes along is the student id and nothing else:
 * eligibility, the selectable months and the default month are resolved by the
 * server on the page that lands, so a card drawn before a student was archived
 * cannot open a form the API would refuse.
 *
 * A STUDENT WITH REVIEWS GETS SOMEWHERE TO GO. Human verification found the
 * card offering only "write another one" to a student who already had months of
 * history. The secondary action opens the LATEST review — by its own id, which
 * the card now carries — and it is deliberately not called Edit: what it opens
 * is a record to read, and editing starts there.
 *
 * THE SCORE IS THE LATEST REVIEW'S. No historical averaging happens anywhere:
 * `latestAverage` comes from the latest review alone (see buildReviewCards), and
 * a student with no review has no score at all rather than a zero.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar } from "@/components/students/student-ui";
import {
  noParentPillStyle, reviewCardStyle, reviewCountKey, reviewScore, reviewSummaryStyle,
} from "@/components/reviews/reviews-ui";
import { fetchReviews, reviewKeys } from "@/components/reviews/api";

const iconWrite = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const iconChart = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
);
const iconEye = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);

export default function ReviewsPage() {
  const { t, fmt } = useSettings();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: reviewKeys.list,
    queryFn: fetchReviews,
  });

  const cards = useMemo(() => data?.cards ?? [], [data]);

  return (
    <div data-screen-label="Reviews" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Monthly reviews")}</h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => refetch()}
              aria-label={t("Refresh")}
              className="btn-ghost"
              style={{ minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isFetching ? { animation: "spin .7s linear infinite" } : undefined}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("Refresh")}</TooltipContent>
        </Tooltip>
      </div>

      {isLoading && <SkeletonGrid />}

      {!isLoading && isError && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load reviews")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {/* No eligible students at all — a real state, not a blank page. Archived
        * students are not offered a review, so a roster of only archived
        * students lands here too. */}
      {!isLoading && !isError && cards.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "52px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          {t("No students")}
        </div>
      )}

      {!isLoading && !isError && cards.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))", gap: "var(--gap)" }}>
          {cards.map((c) => {
            /* `null` when this student has no review. It is the ONLY thing that
             * decides whether a score, a "/5" and a performance label are drawn
             * at all — an absent assessment is never rendered as 0.0, and
             * perfLabel/perfColor are never asked about a number that isn't
             * there (see reviewScore). */
            const score = reviewScore(c.latestAverage);
            return (
              <div key={c.studentId} style={reviewCardStyle()}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <Avatar name={c.name} initials={c.initials} avatar={c.avatar} color={c.color} size={44} fontSize={15} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(c.gradeLabel)}</div>
                    {/* PROJECT_RULES: reviews must say clearly when a student has
                      * no linked parent. Informational only — it blocks nothing,
                      * changes nothing and notifies nobody. */}
                    {!c.parentLinked && (
                      <div style={{ marginTop: 4 }}>
                        <span style={noParentPillStyle()}>{t("No linked parent")}</span>
                      </div>
                    )}
                  </div>
                  {score && (
                    <div style={{ textAlign: "right", flex: "none" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", color: score.color, fontFamily: "'Geist Mono',monospace" }}>
                        {score.value}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{t("avg / 5")}</div>
                    </div>
                  )}
                </div>

                <div style={reviewSummaryStyle()}>
                  <div style={{ minWidth: 0 }}>
                    {score ? (
                      <>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: score.color }}>{t(score.label)}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                          {c.reviewCount}{t(reviewCountKey(c.reviewCount))}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{t("No review yet")}</div>
                    )}
                  </div>
                  {c.latestMonth && (
                    <div style={{ fontSize: 11, color: "var(--muted-2)", textAlign: "right", flex: "none" }}>
                      {fmt.monthLabel(c.latestMonth)}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {/* ALWAYS CREATE. This goes to a blank review for a month the
                    * student does not yet have; it never turns into an edit of
                    * an existing one, and it carries the student id and nothing
                    * else — the months, the default and the eligibility rule are
                    * the composer page's server-side answers. */}
                  <Link
                    href={`/reviews/new?studentId=${encodeURIComponent(c.studentId)}`}
                    className="btn-primary"
                    style={{ flex: 1, minWidth: 0, height: 36, border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    {iconWrite}
                    {t("Write review")}
                  </Link>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/students/${c.studentId}?tab=Reviews`}
                        aria-label={t("View performance")}
                        className="btn-ghost"
                        style={{ minWidth: 36, width: 36, height: 36, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
                      >
                        {iconChart}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>{t("View performance")}</TooltipContent>
                  </Tooltip>

                  {/* ONLY WHEN THERE IS ONE TO VIEW. A student nobody has
                    * assessed gets the create action and nothing else — an
                    * action that would open a record that does not exist is
                    * worse than an action that is absent.
                    *
                    * NOT LABELLED EDIT: what it opens is a saved record, which
                    * a teacher reads first and edits deliberately from there. */}
                  {c.latestReviewId && (
                    <Link
                      href={`/reviews/${encodeURIComponent(c.latestReviewId)}`}
                      className="btn-ghost"
                      style={{ flex: "1 0 100%", minWidth: 0, height: 34, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      {iconEye}
                      {t("View latest review")}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

/** The card grid's loading state, in the shimmer the other list screens use. */
function SkeletonGrid() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))", gap: "var(--gap)" }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={reviewCardStyle()}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ minWidth: 44, width: 44, height: 44, borderRadius: "50%", ...bar }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 12, width: "60%", borderRadius: 6, ...bar }} />
              <div style={{ height: 10, width: "35%", borderRadius: 6, marginTop: 7, ...bar }} />
            </div>
          </div>
          <div style={{ height: 44, borderRadius: 11, ...bar }} />
          <div style={{ height: 36, borderRadius: 9, ...bar }} />
        </div>
      ))}
    </div>
  );
}
