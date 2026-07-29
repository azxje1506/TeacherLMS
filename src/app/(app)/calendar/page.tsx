"use client";

/* Calendar — ported from the design comp's "CALENDAR" screen: the Month / Week
 * toggle, the title + prev / Today / next controls, the month grid and the week
 * columns. Lessons are generated on the server (lazy ensure) and fetched for the
 * visible range. Clicking a lesson opens the read-only drawer (never navigates
 * away); drag-and-drop moves a lesson to another day via the reschedule endpoint
 * (mutate -> invalidate -> refetch, no optimistic update).
 *
 * The attendance status indicator the comp shows on past lessons is owned by the
 * Attendance sprint and is intentionally omitted here — no Attendance data is
 * read this sprint. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { dow as dowNames } from "@/lib/i18n";
import { cardStyle, timeRangeLabel } from "@/components/classes/class-ui";
import { LessonDrawer } from "@/components/lessons/lesson-drawer";
import {
  calMonthChipStyle, calWeekEventStyle, lessonTypeBadgeStyle, lessonTypeLabel,
} from "@/components/lessons/lesson-ui";
import {
  fetchLessons, lessonKeys, rescheduleLesson, type LessonRow, type ListParams,
} from "@/components/lessons/api";

type View = "month" | "week";

const MONTH_MAX_CHIPS = 3;
/** Month grid geometry. Equal-width tracks that never grow with their content,
 * and one fixed row height sized for the day number + MONTH_MAX_CHIPS chips +
 * the "+N more" link, so every cell is identical and rows stay aligned. */
const MONTH_COLUMNS = "repeat(7,minmax(0,1fr))";
const MONTH_ROW_HEIGHT = 116;

/** Local ISO "YYYY-MM-DD" (no UTC shift). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { return addDays(d, -d.getDay()); }

export default function CalendarPage() {
  const { t, fmt, lang } = useSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date("2026-07-10T00:00:00")); // app clock
  const [openId, setOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // ---- visible date range ----
  const { days, rangeFrom, rangeTo } = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(anchor);
      const ds = Array.from({ length: 7 }, (_, i) => addDays(s, i));
      return { days: ds, rangeFrom: iso(ds[0]), rangeTo: iso(ds[6]) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const s = startOfWeek(first);
    const ds = Array.from({ length: 42 }, (_, i) => addDays(s, i));
    return { days: ds, rangeFrom: iso(ds[0]), rangeTo: iso(ds[41]) };
  }, [view, anchor]);

  const params: ListParams = { from: rangeFrom, to: rangeTo, pageSize: 500 };
  const { data } = useQuery({
    queryKey: lessonKeys.list(params),
    queryFn: () => fetchLessons(params),
  });

  // ---- group lessons by day ----
  const byDay = useMemo(() => {
    const map = new Map<string, LessonRow[]>();
    for (const l of data?.rows ?? []) {
      const arr = map.get(l.date) ?? [];
      arr.push(l);
      map.set(l.date, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [data]);

  const hasEvents = (data?.rows?.length ?? 0) > 0;

  const reschedule = useMutation({
    mutationFn: (vars: { id: string; date: string }) => rescheduleLesson(vars.id, { date: vars.date }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: lessonKeys.all }); toast(t("Lesson rescheduled")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  function dropOn(date: string) {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const lesson = (data?.rows ?? []).find((l) => l.id === id);
    if (!lesson || lesson.date === date) return; // no-op if unchanged
    reschedule.mutate({ id, date });
  }

  // ---- title + navigation ----
  const title = view === "month"
    ? fmt.monthLabel(`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`)
    : `${fmt.dateLabel(iso(days[0]))} – ${fmt.dateLabel(iso(days[6]))}`;

  function go(step: number) {
    if (view === "week") { setAnchor((a) => addDays(a, step * 7)); return; }
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + step, 1));
  }
  function goToday() { setAnchor(new Date("2026-07-10T00:00:00")); }
  function goDay(d: Date) { setAnchor(d); setView("week"); }

  const todayIso = "2026-07-10";
  const dows = dowNames(lang, "short");

  return (
    <div data-screen-label="Calendar" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Calendar")}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 9, padding: 3 }}>
            <button onClick={() => setView("month")} style={segBtn(view === "month")}>{t("Month")}</button>
            <button onClick={() => setView("week")} style={segBtn(view === "week")}>{t("Week")}</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em", minWidth: 150, textAlign: "right" }}>{title}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => go(-1)} title={t("Previous")} aria-label={t("Previous")} className="btn-ghost" style={navBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <button onClick={goToday} className="btn-ghost" style={{ height: 34, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{t("Today")}</button>
            <button onClick={() => go(1)} title={t("Next")} aria-label={t("Next")} className="btn-ghost" style={navBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        </div>
      </div>

      {!hasEvents && (
        <div style={{ fontSize: 12.5, color: "var(--muted-2)", background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 14px", marginBottom: 12 }}>
          {t("No lessons scheduled in this period. Lessons are generated for roughly a two-month window around today.")}
        </div>
      )}

      {view === "month" ? (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          {/* DOW header */}
          <div style={{ display: "grid", gridTemplateColumns: MONTH_COLUMNS }}>
            {dows.map((d, i) => (
              <div key={i} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".05em", textAlign: "center", borderBottom: "1px solid var(--border)" }}>{d}</div>
            ))}
          </div>
          {/* Weeks — ONE grid for all 42 cells, not six per-week grids: separate
            * grids size their columns independently, so a long class name in one
            * week could widen that week's column and break the alignment down the
            * page. minmax(0,1fr) keeps a column from growing past its share, and
            * a fixed row height makes every day cell the same size regardless of
            * how many lessons it holds (content beyond MONTH_MAX_CHIPS is already
            * collapsed into the "+N more" link). */}
          <div style={{ display: "grid", gridTemplateColumns: MONTH_COLUMNS, gridAutoRows: `${MONTH_ROW_HEIGHT}px` }}>
            {days.map((d) => {
              const dISO = iso(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              const isToday = dISO === todayIso;
              const events = byDay.get(dISO) ?? [];
              return (
                <div
                  key={dISO}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); dropOn(dISO); }}
                  style={{ minWidth: 0, overflow: "hidden", borderRight: "1px solid var(--border-2)", borderBottom: "1px solid var(--border-2)", padding: "6px 6px 8px", background: inMonth ? "var(--card)" : "var(--card-2)", opacity: inMonth ? 1 : 0.6 }}
                >
                  <div
                    onClick={() => goDay(d)}
                    title={t("Open day")}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isToday ? "var(--primary)" : "transparent", color: isToday ? "var(--primary-fg)" : "var(--fg-2)" }}
                  >{d.getDate()}</div>
                  {events.slice(0, MONTH_MAX_CHIPS).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setOpenId(e.id)}
                      draggable
                      onDragStart={() => setDraggingId(e.id)}
                      onDragEnd={() => setDraggingId(null)}
                      title={`${fmt.time12(e.start)} ${e.className}`}
                      style={calMonthChipStyle(e.classColor)}
                    >
                      {e.type !== "regular" && <span style={{ ...lessonTypeBadgeStyle(e.type), padding: "1px 4px", marginRight: 3, fontSize: 8, flex: "none" }}>{t(lessonTypeLabel(e.type))}</span>}
                      {/* The label truncates inside the chip; without its own
                        * min-width:0 a long class name would push the chip — and
                        * with it the column — wider than its track. */}
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fmt.time12(e.start)} {e.className}
                      </span>
                    </button>
                  ))}
                  {events.length > MONTH_MAX_CHIPS && (
                    <button onClick={() => goDay(d)} style={{ fontSize: 10, color: "var(--accent)", padding: "1px 5px", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left", display: "block" }}>+{events.length - MONTH_MAX_CHIPS} {t("more")}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(150px,1fr))", gap: 10, minWidth: 900 }}>
            {days.map((d) => {
              const dISO = iso(d);
              const isToday = dISO === todayIso;
              const events = byDay.get(dISO) ?? [];
              return (
                <div
                  key={dISO}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); dropOn(dISO); }}
                  style={{ ...cardStyle, overflow: "hidden", minHeight: 220 }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border-2)", background: isToday ? "var(--accent-soft)" : "var(--card-2)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{dows[d.getDay()]}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isToday ? "var(--accent)" : "var(--fg)" }}>{d.getDate()}</div>
                  </div>
                  <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    {events.length === 0 && <div style={{ fontSize: 11.5, color: "var(--muted-2)", textAlign: "center", padding: "16px 0" }}>{t("Drop here")}</div>}
                    {events.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => setOpenId(e.id)}
                        draggable
                        onDragStart={() => setDraggingId(e.id)}
                        onDragEnd={() => setDraggingId(null)}
                        style={calWeekEventStyle(e.classColor)}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--fg)" }}>{timeRangeLabel(e.start, fmt.addMinutes(e.start, e.duration), fmt)}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.className}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span style={lessonTypeBadgeStyle(e.type)}>{t(lessonTypeLabel(e.type))}</span>
                          {e.classroom && <span style={{ fontSize: 11, color: "var(--muted)" }}>{e.classroom}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <LessonDrawer lessonId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

const navBtn: React.CSSProperties = {
  minWidth: 34, width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function segBtn(active: boolean): React.CSSProperties {
  return {
    height: 28, padding: "0 14px", borderRadius: 7, border: "none", cursor: "pointer",
    fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
    background: active ? "var(--card)" : "transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    boxShadow: active ? "var(--sh)" : "none",
  };
}
