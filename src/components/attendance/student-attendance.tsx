"use client";

/* The Student Profile's Attendance tab — the comp's "TAB: ATTENDANCE" section
 * (Sprint 13 Gate 4).
 *
 * ONE ENDPOINT, AND THE PAYLOAD IS RENDERED AS IT ARRIVES.
 * `GET /api/attendance/student/:studentId` returns the whole read model, and
 * this file DERIVES NOTHING FROM IT: not the headline rate, not a monthly rate,
 * not a count, and not one of the three lists. It does not filter, re-sort,
 * re-bucket or recompute — `absences` is already `Absent` only and `timeline` is
 * already newest-first with its tie-break applied, so a client-side filter here
 * would be a second copy of a domain rule with nothing testing it, and the first
 * thing it would do is let `Excused` slip into the absences card. Presentation
 * formatting is all that happens below: a percent sign, a localized date, a bar
 * height.
 *
 * THE PAGE PASSES A STUDENT ID AND NOTHING ELSE. This component owns its query,
 * its states and its layout, exactly as `StudentReviews` does for its tab. The
 * profile page holds no attendance state and knows no attendance rule.
 *
 * `null` IS NOT `0`, ANYWHERE. A student with no stored entry has no percentage,
 * and a month with no entry has no percentage — "they missed everything" and
 * "nothing was recorded" are different facts, and the shared `rateLabel` renders
 * the second as the app's em dash. The tab never prints `0%` for an absence of
 * data, and the whole-tab empty state is used when there is no record at all
 * rather than drawing an analytics shell over nothing.
 *
 * THE SPLIT IS A CLASS, NOT AN INLINE STYLE. `.sp-split` lives in globals.css and
 * owns `grid-template-columns`, because a media or container rule cannot beat an
 * inline declaration — a trap this repository has shipped more than once. See
 * the `.sp-split` block in globals.css for the container query that collapses it.
 */

import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { cardStyle } from "@/components/students/student-ui";
import {
  ATTENDANCE_COLORS, ATTENDANCE_DISPLAY_ORDER, rateLabel,
} from "@/components/attendance/attendance-ui";
import { attendanceKeys, fetchStudentAttendance } from "@/components/attendance/api";
import type { StudentAttendanceEntry } from "@/lib/student-profile";
import type { AttendanceStatus } from "@/lib/types";

const panel: React.CSSProperties = { ...cardStyle, padding: "18px 20px", minWidth: 0 };
const column: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0,
};
const cardTitle: React.CSSProperties = { fontSize: 14.5, fontWeight: 600 };

/** The comp's status pill. Soft ground, solid text, and the status NAMED — the
 * colour is never the only signal. */
function badgeStyle(status: AttendanceStatus): React.CSSProperties {
  const c = ATTENDANCE_COLORS[status];
  return {
    fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
    background: c.soft, color: c.color, whiteSpace: "nowrap", flex: "none",
  };
}

export function StudentAttendance({ studentId }: { studentId: string }) {
  const { t, fmt } = useSettings();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: attendanceKeys.student(studentId),
    queryFn: () => fetchStudentAttendance(studentId),
  });

  if (isLoading) return <SkeletonTab />;

  if (isError || !data) {
    /* AN INLINE FAILURE, and never an empty one. Only the tab failed — the
     * profile header, the tablist and every other tab are still there — and a
     * failed request must never be dressed as "this student has no attendance",
     * which is a claim about their record rather than about the network. */
    return (
      <div style={{ ...panel, padding: "48px 24px", textAlign: "center" }}>
        <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load attendance")}</div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
          {t("Something went wrong while fetching the list. Check your connection and try again.")}
        </p>
        <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, margin: "0 auto" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
          {t("Try again")}
        </button>
      </div>
    );
  }

  /* THE WHOLE-TAB EMPTY STATE, which is the comp's own. `hasRecords` is the
   * server's answer, so the screen and the read model cannot disagree about what
   * "empty" means. Nothing partial is drawn beside it — no 0%, no flat chart, no
   * empty timeline under a headline figure that does not exist. */
  if (!data.hasRecords) {
    return (
      <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "52px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
        {t("No attendance recorded for this student yet.")}
      </div>
    );
  }

  return (
    <div className="sp-split">
      <div style={column}>
        {/* ---- Summary: the headline rate and the four counts ---------------- */}
        <section style={panel} aria-label={t("Attendance")}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 96 }}>
              {/* The server's own figure. `rateLabel` renders `null` as the app's
                * em dash rather than as 0%. */}
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.02em", color: "var(--green)", fontFamily: "'Geist Mono',monospace" }}>
                {rateLabel(data.rate)}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("Attendance")}</div>
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, minWidth: 220 }}>
              {ATTENDANCE_DISPLAY_ORDER.map((status) => {
                const c = ATTENDANCE_COLORS[status];
                const count = status === "Present" ? data.counts.present
                  : status === "Late" ? data.counts.late
                    : status === "Absent" ? data.counts.absent
                      : data.counts.excused;
                return (
                  <div key={status} style={{ background: c.soft, borderRadius: 11, padding: "11px 12px" }}>
                    <div style={{ fontSize: 19, fontWeight: 600, color: c.color }}>{count}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{t(status)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---- Monthly attendance -------------------------------------------
          * Six server-supplied points, in the order they arrive (oldest first).
          * THE BARS ARE DECORATION: every value is already written underneath in
          * text, so the bar row is `aria-hidden` and a screen reader hears the
          * figures once rather than twice. A month with no entry has no
          * percentage — its bar is the design's own minimum-height stub and its
          * label is the em dash, never `0%`. */}
        <section style={panel} aria-label={t("Monthly attendance")}>
          <h3 style={{ ...cardTitle, margin: "0 0 16px" }}>{t("Monthly attendance")}</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 150 }}>
            {data.monthly.map((m) => (
              <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", minWidth: 0 }}>
                <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }} aria-hidden="true">
                  <div style={{ width: "100%", borderRadius: "7px 7px 0 0", background: "var(--green)", height: `${m.rate ?? 0}%`, minHeight: 4 }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-2)", fontWeight: 600 }}>{rateLabel(m.rate)}</div>
                <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{fmt.monthShort(m.month)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Attendance timeline ------------------------------------------ */}
        <section style={panel} aria-label={t("Attendance timeline")}>
          <h3 style={{ ...cardTitle, margin: "0 0 6px" }}>{t("Attendance timeline")}</h3>
          {data.timeline.map((e) => (
            <div key={e.lessonId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid var(--border-2)" }}>
              <span aria-hidden="true" style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: ATTENDANCE_COLORS[e.status].color }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.className}</div>
              <span style={badgeStyle(e.status)}>{t(e.status)}</span>
              <div style={{ fontSize: 12, color: "var(--muted)", minWidth: 56, textAlign: "right" }}>{fmt.dateLabel(e.date)}</div>
            </div>
          ))}
        </section>
      </div>

      <div style={column}>
        {/* ---- Recent absences ----------------------------------------------
          * `data.absences` is ALREADY `Absent` only — the server's rule, because
          * `Excused` counts as attended everywhere else in this application. No
          * filter is applied here, so none can drift. */}
        <section style={panel} aria-label={t("Recent absences")}>
          <h3 style={{ ...cardTitle, margin: "0 0 10px" }}>{t("Recent absences")}</h3>
          {data.absences.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("No absences on record. 🎉")}</p>
          ) : (
            data.absences.map((a) => (
              <div key={a.lessonId} style={{ padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.className}</div>
                  <span style={badgeStyle(a.status)}>{t(a.status)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{noteLine(fmt.dateLabel(a.date), a)}</div>
              </div>
            ))
          )}
        </section>

        {/* ---- Recent late arrivals ------------------------------------------ */}
        <section style={panel} aria-label={t("Recent late arrivals")}>
          <h3 style={{ ...cardTitle, margin: "0 0 10px" }}>{t("Recent late arrivals")}</h3>
          {data.lates.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("No late arrivals on record.")}</p>
          ) : (
            data.lates.map((a) => (
              <div key={a.lessonId} style={{ padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.className}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{noteLine(fmt.dateLabel(a.date), a)}</div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

/** The design's "{date} · {note}" caption. The separator appears only when there
 * is a note to separate — the server omits the field when none was recorded, and
 * a dangling middot would be punctuation standing in for information. */
function noteLine(dateLabel: string, entry: StudentAttendanceEntry): string {
  return entry.note ? `${dateLabel} · ${entry.note}` : dateLabel;
}

/** The loading state.
 *
 * IT IS THE TAB'S SHAPE, NOT A SPINNER, and it shows no values — no `0`, no
 * `0%`, no placeholder month. It occupies the same two-column split the loaded
 * tab does, so revealing the data does not move the tablist above it. */
function SkeletonTab() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div className="sp-split" aria-hidden="true">
      <div style={column}>
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <div style={{ minWidth: 96 }}>
              <div style={{ height: 34, width: 84, borderRadius: 9, ...bar }} />
              <div style={{ height: 11, width: 60, borderRadius: 6, marginTop: 6, ...bar }} />
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, minWidth: 220 }}>
              {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 56, borderRadius: 11, ...bar }} />)}
            </div>
          </div>
        </div>
        <div style={panel}>
          <div style={{ height: 13, width: "38%", borderRadius: 6, ...bar }} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 150, marginTop: 16 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ flex: 1, height: `${40 + ((i * 13) % 50)}%`, borderRadius: "7px 7px 0 0", ...bar }} />
            ))}
          </div>
        </div>
        <div style={panel}>
          <div style={{ height: 13, width: "42%", borderRadius: 6, ...bar }} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0" }}>
              <div style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", ...bar }} />
              <div style={{ flex: 1, height: 11, borderRadius: 6, ...bar }} />
              <div style={{ width: 56, height: 11, borderRadius: 6, ...bar }} />
            </div>
          ))}
        </div>
      </div>
      <div style={column}>
        {[0, 1].map((i) => (
          <div key={i} style={panel}>
            <div style={{ height: 13, width: "52%", borderRadius: 6, ...bar }} />
            {[0, 1, 2].map((j) => (
              <div key={j} style={{ marginTop: 12 }}>
                <div style={{ height: 11, width: "64%", borderRadius: 6, ...bar }} />
                <div style={{ height: 10, width: "44%", borderRadius: 6, marginTop: 6, ...bar }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
