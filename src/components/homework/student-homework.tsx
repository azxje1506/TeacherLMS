"use client";

/* The Student Profile's Homework tab — the comp's "TAB: HOMEWORK" section
 * (Sprint 13 Gate 5).
 *
 * ONE ENDPOINT, AND THE PAYLOAD IS RENDERED AS IT ARRIVES.
 * `GET /api/homework/student/:studentId` returns the whole read model, and this
 * file DERIVES NOTHING FROM IT: not the completion rate, not a count, not a
 * status, and not one of the three lists. `missing` and `late` are the server's
 * own lists, not the timeline filtered twice in the browser — filtering here
 * would be a second copy of a domain rule with nothing testing it, and it would
 * quietly disagree with the timeline's cap the first time a student had more
 * than twenty assignments.
 *
 * THE SUBMISSIONS MAP NEVER REACHES THIS FILE. Each row's `status` is already
 * THIS student's own outcome, resolved on the server from
 * `submissions[studentId]` for class-scoped work and from the record's own
 * status for student-scoped work. The browser is handed an outcome rather than a
 * map, so it cannot read another student's key even by accident, and an
 * assignment's own top-level status is never mistaken for a person's result.
 *
 * `null` IS NOT `0%`, AND "NO OUTCOME YET" IS NOT "NO HOMEWORK".
 * A student whose work is all still `Assigned` has `completionRate: null` while
 * `counts.total` is greater than zero — they were given work, nobody has marked
 * it. That is NOT the empty state: the tab renders with an em dash in the ring,
 * because a partial answer must never be dressed as an empty one. Only the
 * server's own `hasRecords` decides the whole-tab empty state.
 *
 * `Total` INCLUDES `Assigned`, so it is legitimately LARGER than
 * `completed + late + missing`. The two answer different questions — what were
 * they given, and of the work that has an outcome how much is done — and the gap
 * between them is the unmarked work. It is not a defect and must not be "fixed"
 * by deriving one from the others.
 *
 * THE PAGE PASSES A STUDENT ID AND NOTHING ELSE, exactly as it does for the
 * Reviews and Attendance tabs. It holds no homework state and knows no homework
 * rule.
 *
 * THE SPLIT IS GATE 4'S `.sp-split`, REUSED UNCHANGED. This gate adds no
 * responsive CSS: the container query on `[data-screen-label="Student profile"]`
 * already collapses both tabs on the room they actually have.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { cardStyle } from "@/components/students/student-ui";
import { homeworkBadgeStyle, SCOPE_LABEL } from "@/components/homework/homework-ui";
import { homeworkKeys, fetchStudentHomework } from "@/components/homework/api";
/* GEOMETRY AND FORMATTING, NOT ATTENDANCE SEMANTICS. `ringDash` is the comp's
 * r=40 donut maths and `rateLabel` is "a percentage, or the shared em dash when
 * there is nothing to rate" — the same question this ring asks. They happen to
 * live in the Attendance presentation module because Attendance needed them
 * first; reusing them is the house rule (`attendance-ui` itself reuses
 * `cardStyle` from Students for the same reason) and duplicating them here would
 * be the thing PROJECT_RULES forbids. Relocating them to a neutral module is a
 * genuine tidy-up and is deliberately NOT done in this gate — Gate 5 introduces
 * the second tab and must not generalise the first one at the same time. */
import { ringDash, rateLabel } from "@/components/attendance/attendance-ui";

const panel: React.CSSProperties = { ...cardStyle, padding: "18px 20px", minWidth: 0 };
const column: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0,
};
const cardTitle: React.CSSProperties = { fontSize: 14.5, fontWeight: 600 };

/** The comp's four summary tiles. `Total` is the neutral one — it counts work
 * rather than judging it — and the other three carry their status colour. */
const TILES = [
  { key: "total", label: "Total", soft: "var(--card-2)", color: "var(--fg)" },
  { key: "completed", label: "Completed", soft: "var(--green-soft)", color: "var(--green)" },
  { key: "late", label: "Late", soft: "var(--amber-soft)", color: "var(--amber)" },
  { key: "missing", label: "Missing", soft: "var(--accent-soft)", color: "var(--accent)" },
] as const;

export function StudentHomework({ studentId }: { studentId: string }) {
  const { t, fmt } = useSettings();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: homeworkKeys.student(studentId),
    queryFn: () => fetchStudentHomework(studentId),
  });

  if (isLoading) return <SkeletonTab />;

  if (isError || !data) {
    /* AN INLINE FAILURE, and never an empty one. Only the tab failed — the
     * profile header, the tablist and every other tab are still there — and a
     * failed request must never be rendered as "no homework assigned to this
     * student", which is a claim about their record rather than about the
     * network. This branch returns before `hasRecords` is ever consulted. */
    return (
      <div style={{ ...panel, padding: "48px 24px", textAlign: "center" }}>
        <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load homework")}</div>
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

  /* THE WHOLE-TAB EMPTY STATE, decided by the SERVER'S `hasRecords` and by
   * nothing else. It is emphatically NOT `completionRate === null`: a student
   * whose work is all still `Assigned` has a null rate and real homework, and
   * telling them they have none would be false. `hasRecords` answers "is any
   * work addressed to this student", which is the question the empty state
   * actually asks.
   *
   * THE ACTION IS THE COMP'S OWN, and it goes to the module that owns the verb.
   * There is no student-scoped assign deep link, and inventing a route to carry
   * one is out of scope, so it opens the narrowest existing relevant screen —
   * the Homework index, where "Assign homework" lives. */
  if (!data.hasRecords) {
    return (
      <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "48px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "0 0 16px" }}>
          {t("No homework assigned to this student yet.")}
        </p>
        <Link href="/homework" style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          {t("Assign homework")}
        </Link>
      </div>
    );
  }

  return (
    <div className="sp-split">
      <div style={column}>
        {/* ---- Completion ring and the four counts --------------------------
          * THE RING IS DECORATION. Its figure is written in the middle of it in
          * text, so the svg is `aria-hidden` and the percentage is read once.
          * A `null` rate draws NO arc and the em dash — never a zero-length arc
          * labelled 0%, which would state an assessment nobody made. */}
        <section style={{ ...panel, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }} aria-label={t("Homework completion")}>
          <div style={{ position: "relative", width: 104, height: 104, flex: "none" }}>
            <svg width="104" height="104" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="9" />
              {data.completionRate !== null && (
                <circle
                  cx="50" cy="50" r="40" fill="none" stroke="var(--green)" strokeWidth="9"
                  strokeLinecap="round" strokeDasharray={ringDash(data.completionRate)}
                  transform="rotate(-90 50 50)"
                />
              )}
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "'Geist Mono',monospace", color: "var(--green)" }}>
                {rateLabel(data.completionRate)}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted-2)" }}>{t("completed")}</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, minWidth: 220 }}>
            {TILES.map((tile) => (
              <div key={tile.key} style={{ background: tile.soft, borderRadius: 11, padding: "11px 12px" }}>
                <div style={{ fontSize: 19, fontWeight: 600, color: tile.color }}>{data.counts[tile.key]}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{t(tile.label)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Homework timeline --------------------------------------------
          * Rendered in the order it arrives. The server sorted it newest-first
          * by due date with the assignment id as the final tie-break; sorting
          * again here could only disagree with it. */}
        <section style={panel} aria-label={t("Homework timeline")}>
          <h3 style={{ ...cardTitle, margin: "0 0 6px" }}>{t("Homework timeline")}</h3>
          {data.timeline.map((h) => (
            <div key={h.homeworkId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
              <span aria-hidden="true" style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: dotColor(h.status) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {h.className} · {t(SCOPE_LABEL[h.scope])}
                </div>
              </div>
              <span style={homeworkBadgeStyle(h.status)}>{t(h.status)}</span>
              <div style={{ fontSize: 12, color: "var(--muted)", minWidth: 52, textAlign: "right" }}>{fmt.dateLabel(h.dueDate)}</div>
            </div>
          ))}
        </section>
      </div>

      <div style={column}>
        {/* ---- Missing homework ----------------------------------------------
          * `data.missing` is the SERVER'S list. It is not the timeline filtered
          * here — the timeline is capped at twenty and this list is capped at
          * five, so reconstructing one from the other would silently lose rows
          * for a student with a long history. */}
        <section style={panel} aria-label={t("Missing homework")}>
          <h3 style={{ ...cardTitle, margin: "0 0 10px" }}>{t("Missing homework")}</h3>
          {data.missing.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("Nothing missing. 🎉")}</p>
          ) : (
            data.missing.map((h) => <SideRow key={h.homeworkId} title={h.title} caption={`${h.className} · ${t("Due")} ${fmt.dateLabel(h.dueDate)}`} />)
          )}
        </section>

        {/* ---- Late homework -------------------------------------------------- */}
        <section style={panel} aria-label={t("Late homework")}>
          <h3 style={{ ...cardTitle, margin: "0 0 10px" }}>{t("Late homework")}</h3>
          {data.late.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("No late submissions.")}</p>
          ) : (
            data.late.map((h) => <SideRow key={h.homeworkId} title={h.title} caption={`${h.className} · ${t("Due")} ${fmt.dateLabel(h.dueDate)}`} />)
          )}
        </section>
      </div>
    </div>
  );
}

/** The two side cards draw the same row, so it is written once. */
function SideRow({ title, caption }: { title: string; caption: string }) {
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid var(--border-2)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption}</div>
    </div>
  );
}

/** The timeline's leading dot, in the same status language the badge beside it
 * uses. It is `aria-hidden` and duplicates nothing: the badge names the status
 * in text, so colour is never the only signal. */
function dotColor(status: string): string {
  return status === "Completed" ? "var(--green)"
    : status === "Late" ? "var(--amber)"
      : status === "Missing" ? "var(--accent)"
        : "var(--muted-2)";
}

/** The loading state.
 *
 * IT IS THE TAB'S SHAPE, NOT A SPINNER, and it shows no values — no count, no
 * percentage, no due date. It occupies the same `.sp-split` the loaded tab does,
 * so revealing the data does not move the tablist above it. */
function SkeletonTab() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div className="sp-split" aria-hidden="true">
      <div style={column}>
        <div style={{ ...panel, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div style={{ width: 104, height: 104, borderRadius: "50%", flex: "none", ...bar }} />
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, minWidth: 220 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 56, borderRadius: 11, ...bar }} />)}
          </div>
        </div>
        <div style={panel}>
          <div style={{ height: 13, width: "40%", borderRadius: 6, ...bar }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
              <div style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", ...bar }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ height: 11, width: "58%", borderRadius: 6, ...bar }} />
                <div style={{ height: 10, width: "36%", borderRadius: 6, marginTop: 6, ...bar }} />
              </div>
              <div style={{ width: 52, height: 11, borderRadius: 6, ...bar }} />
            </div>
          ))}
        </div>
      </div>
      <div style={column}>
        {[0, 1].map((i) => (
          <div key={i} style={panel}>
            <div style={{ height: 13, width: "50%", borderRadius: 6, ...bar }} />
            {[0, 1, 2].map((j) => (
              <div key={j} style={{ marginTop: 12 }}>
                <div style={{ height: 11, width: "66%", borderRadius: 6, ...bar }} />
                <div style={{ height: 10, width: "42%", borderRadius: 6, marginTop: 6, ...bar }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
