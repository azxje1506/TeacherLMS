"use client";

/* Attendance index — ported from the design comp's "ATTENDANCE INDEX" screen:
 * heading + subtitle, the This month / Attendance by class statistics pair, the
 * Today card grid and the Recent lessons list, with the comp's own empty states.
 *
 * Everything on this screen is shaped by the server (GET /api/attendance) — which
 * lessons are "today", which are "recent", how many and in what order are
 * business rules, and they live in src/lib/attendance.ts where they are tested.
 * This file draws the answer.
 *
 * NO search, filters, pagination or date picker: the comp has none, and
 * PROJECT_RULES is explicit that missing UI is not invented. The Recent list is
 * capped at the 8 the comp's own placeholder hint carries.
 */

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { cardStyle, timeRange, studentText } from "@/components/classes/class-ui";
import { dateCell, lessonTypeLabel } from "@/components/lessons/lesson-ui";
import {
  ATTENDANCE_DISPLAY_ORDER, ATTENDANCE_COLORS, attendanceCtaLabel, attendanceIndicator, ringDash,
} from "@/components/attendance/attendance-ui";
import { attendanceKeys, fetchAttendanceIndex } from "@/components/attendance/api";
import type { AttendanceLessonCard } from "@/lib/attendance";

export default function AttendancePage() {
  const { t, fmt, lang } = useSettings();
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: attendanceKeys.index,
    queryFn: fetchAttendanceIndex,
  });

  const open = (lessonId: string) => router.push(`/attendance/${lessonId}`);

  const today = data?.today ?? [];
  const recent = data?.recent ?? [];
  const summary = data?.summary;
  const byClass = data?.byClass ?? [];
  // The comp's `asHasData`: the statistics pair appears once there is something
  // to report. No entries means no data — not a screen full of zeroes.
  const hasStats = Boolean(summary && summary.entries > 0);

  const todayCell = data ? dateCell(data.todayIso, lang) : null;

  return (
    <div data-screen-label="Attendance" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Attendance")}</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>
          {t("Take attendance for a lesson. Everyone starts as present — you only mark the exceptions.")}
        </p>
      </div>

      {isLoading && <SkeletonIndex />}

      {!isLoading && isError && (
        <div style={{ ...cardStyle, padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load attendance")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {/* ---- Attendance statistics ---- */}
          {hasStats && summary && (
            <div className="att-stats" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: "var(--gap)", marginBottom: "var(--gap)" }}>
              <div style={{ ...cardStyle, padding: "18px 20px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>{t("This month")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <div style={{ position: "relative", flexShrink: 0, width: 96, height: 96 }}>
                    <svg width="96" height="96" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="9" />
                      <circle
                        cx="50" cy="50" r="40" fill="none" strokeWidth="9" strokeLinecap="round"
                        strokeDasharray={ringDash(summary.rate)} strokeDashoffset="0"
                        transform="rotate(-90 50 50)" style={{ stroke: "var(--green)" }}
                      />
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05 }}>
                      <span style={{ fontSize: 20, fontWeight: 600, color: "var(--fg)" }}>{summary.rate}%</span>
                      <span style={{ fontSize: 8.5, color: "var(--muted-2)" }}>{t("attended")}</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                    {ATTENDANCE_DISPLAY_ORDER.map((status) => {
                      const c = ATTENDANCE_COLORS[status];
                      const count = status === "Present" ? summary.present
                        : status === "Late" ? summary.late
                          : status === "Absent" ? summary.absent
                            : summary.excused;
                      return (
                        <div key={status} style={{ background: c.soft, borderRadius: 9, padding: "8px 10px" }}>
                          <div style={{ fontSize: 17, fontWeight: 600, color: c.color }}>{count}</div>
                          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{t(status)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ ...cardStyle, padding: "18px 20px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>{t("Attendance by class")}</div>
                {byClass.map((c) => (
                  <div key={c.classId} style={{ padding: "7px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                        <span style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace" }}>{c.rate}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: "var(--card-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 99, background: c.color, width: `${c.rate}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- Today ---- */}
          <div style={{ marginBottom: "var(--gap)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 11 }}>
              {t("Today")} · <span style={{ color: "var(--fg)" }}>{todayCell ? `${todayCell.monLabel} ${todayCell.dateNum}` : ""}</span>
            </div>
            {today.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: "var(--gap)" }}>
                {today.map((a) => (
                  <TodayCard key={a.lessonId} card={a} onOpen={() => open(a.lessonId)} />
                ))}
              </div>
            ) : (
              <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: 22, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                {t("No classes scheduled today.")}
              </div>
            )}
          </div>

          {/* ---- Recent lessons ---- */}
          {recent.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 11 }}>
                {t("Recent lessons")}
              </div>
              <div style={{ ...cardStyle, overflow: "hidden" }}>
                {recent.map((a) => {
                  const dc = dateCell(a.date, lang);
                  const ind = attendanceIndicator(a, lang);
                  return (
                    <div
                      key={a.lessonId}
                      onClick={() => open(a.lessonId)}
                      className="row-hover meta-row"
                      style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: "1px solid var(--border-2)", cursor: "pointer" }}
                    >
                      <div style={{ minWidth: 46, height: 46, borderRadius: 10, background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                        <span style={{ fontSize: 9.5, color: "var(--muted-2)", fontWeight: 600, textTransform: "uppercase" }}>{dc.dayLabel}</span>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>{dc.dateNum}</span>
                        <span style={{ fontSize: 8.5, color: "var(--muted-2)", textTransform: "uppercase" }}>{dc.monLabel}</span>
                      </div>
                      <div style={{ width: 3, height: 34, borderRadius: 2, background: a.color }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.className}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
                          {timeRange(a, fmt)} · {studentText(a.studentCount, lang)}
                        </div>
                      </div>
                      <div className="meta-trail" style={{ display: "contents" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: ind.color, whiteSpace: "nowrap" }}>
                          <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: ind.color }} />
                          {ind.label}
                        </div>
                        {/* On its own line the chevron keeps the trailing edge it
                          * holds in the desktop row. */}
                        <span style={{ display: "flex", color: "var(--muted-2)", marginLeft: "auto" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TodayCard({ card, onOpen }: { card: AttendanceLessonCard; onOpen: () => void }) {
  const { t, fmt, lang } = useSettings();
  const ind = attendanceIndicator(card, lang);
  return (
    <div style={{ ...cardStyle, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 4, background: card.color }} />
      <div style={{ padding: "15px 17px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.className}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{timeRange(card, fmt)} · {card.classroom}</div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: ind.color, whiteSpace: "nowrap" }}>
            <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: ind.color }} />
            {ind.label}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "11px 0 14px" }}>
          {studentText(card.studentCount, lang)} · {t(lessonTypeLabel(card.type))}
        </div>
        <button
          onClick={onOpen}
          style={{ marginTop: "auto", height: 38, border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          {attendanceCtaLabel(card.taken, lang)}
        </button>
      </div>
    </div>
  );
}

/** Loading state, in the same shape the screen will settle into. */
function SkeletonIndex() {
  return (
    <div style={{ display: "grid", gap: "var(--gap)" }}>
      <div className="att-stats" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: "var(--gap)" }}>
        <div style={{ ...cardStyle, height: 160 }} />
        <div style={{ ...cardStyle, height: 160 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: "var(--gap)" }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ ...cardStyle, height: 150 }} />)}
      </div>
    </div>
  );
}
