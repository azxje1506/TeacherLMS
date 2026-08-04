"use client";

/* Calendar — ported from the design comp's "CALENDAR" screen: the Month / Week
 * toggle, the title + prev / Today / next controls, the month grid and the week
 * columns. Lessons are generated on the server (lazy ensure) and fetched for the
 * visible range. Clicking a lesson opens the read-only drawer (never navigates
 * away); dragging one onto another day reschedules it (mutate -> invalidate ->
 * refetch, no optimistic update).
 *
 * Sprint 5.5 turned this screen into the scheduling workspace: the toolbar
 * filters, the legend, and a pointer-driven drag with a live drop preview and a
 * conflict check. The drag mechanics live in use-calendar-drag; the cards, the
 * toolbar and the ghost live in calendar-ui. What stays here is the calendar
 * itself — the ranges, the grids and what a drop means.
 *
 * The attendance status indicator the comp shows on past lessons is owned by the
 * Attendance sprint and is intentionally omitted here — no Attendance data is
 * read this sprint. */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { overlaps } from "@/lib/calc";
import { dow as dowNames } from "@/lib/i18n";
import type { SelectOption } from "@/components/ui/select";
import { cardStyle } from "@/components/classes/class-ui";
import { fetchClasses, classKeys } from "@/components/classes/api";
import { fetchStudents, studentKeys } from "@/components/students/api";
import { LessonDrawer } from "@/components/lessons/lesson-drawer";
import { CalendarLegend, lessonKind } from "@/components/lessons/lesson-ui";
import {
  ANY, CalendarFilters, DragGhost, DropPlaceholder, MonthChip, WeekEvent,
  type CalendarFilterValues,
} from "@/components/lessons/calendar-ui";
import { DROP_ATTR, SCROLLER_ATTR, useCalendarDrag } from "@/components/lessons/use-calendar-drag";
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

const NO_FILTERS: CalendarFilterValues = { q: "", classId: ANY, studentId: ANY, classroom: ANY, kind: "All" };

export default function CalendarPage() {
  const { t, fmt, lang } = useSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date("2026-07-10T00:00:00")); // app clock
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilterValues>(NO_FILTERS);

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

  /* Filter option sources. Classes and Students are read whole (both lists are
   * small and both queries are already cached by their own screens) so the
   * dropdowns offer a stable set that does not shuffle as you page through
   * months. Classrooms are Class-owned, so they come from the same class read
   * rather than from a fourth request. */
  const classListParams = { q: "", status: "All" };
  const { data: classData } = useQuery({
    queryKey: classKeys.list(classListParams),
    queryFn: () => fetchClasses(classListParams),
  });
  const studentListParams = { q: "", status: "All", grade: "all" };
  const { data: studentData } = useQuery({
    queryKey: studentKeys.list(studentListParams),
    queryFn: () => fetchStudents(studentListParams),
  });

  const classRows = useMemo(() => classData?.rows ?? [], [classData]);

  const classOptions: SelectOption[] = useMemo(
    () => classRows.map((c) => ({ value: c.id, label: c.name })),
    [classRows]
  );
  const studentOptions: SelectOption[] = useMemo(
    () => (studentData?.rows ?? []).map((s) => ({ value: s.id, label: s.name })),
    [studentData]
  );
  const classroomOptions: SelectOption[] = useMemo(() => {
    const names = new Set<string>();
    for (const c of classRows) if (c.classroom) names.add(c.classroom);
    return [...names].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  }, [classRows]);

  /** Which classes a student is enrolled in — the Class owns the enrolment, so
   * the student filter is answered by intersecting `studentIds`, never by
   * copying a roster onto the lesson. */
  const classesOfStudent = useMemo(() => {
    if (!filters.studentId) return null;
    return new Set(classRows.filter((c) => (c.studentIds ?? []).includes(filters.studentId)).map((c) => c.id));
  }, [classRows, filters.studentId]);

  /* Every filter narrows the same fetched range and they combine, so a lesson is
   * shown only when it satisfies all five. Filtering is client-side because the
   * calendar already holds the whole visible range in one page — going back to
   * the server per keystroke would buy nothing and cost a spinner. */
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((l) => {
      if (q && ![l.className, l.classroom, l.classLevel].some((f) => String(f ?? "").toLowerCase().includes(q))) return false;
      if (filters.classId && l.classId !== filters.classId) return false;
      if (classesOfStudent && !classesOfStudent.has(l.classId)) return false;
      if (filters.classroom && l.classroom !== filters.classroom) return false;
      if (filters.kind !== "All" && lessonKind(l) !== filters.kind) return false;
      return true;
    });
  }, [rows, filters, classesOfStudent]);

  // ---- group lessons by day ----
  const byDay = useMemo(() => {
    const map = new Map<string, LessonRow[]>();
    for (const l of visible) {
      const arr = map.get(l.date) ?? [];
      arr.push(l);
      map.set(l.date, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [visible]);

  const hasEvents = rows.length > 0;

  const reschedule = useMutation({
    mutationFn: (vars: { id: string; date: string }) => rescheduleLesson(vars.id, { date: vars.date }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: lessonKeys.all }); toast(t("Lesson rescheduled")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  /* ---- drag & drop -------------------------------------------------------
   *
   * The single-teacher rule the Classes module enforces on a weekly schedule
   * applies to individual lessons too: one teacher cannot be in two places at
   * once. The same interval test (`overlaps` — back-to-back never clashes) is
   * reused here against the lessons already on the destination day, so the
   * preview and the rule can never disagree. Cancelled lessons do not occupy the
   * teacher, so only live ones block. Nothing about attendance or billing is
   * consulted or changed. */
  const conflictOn = useCallback((id: string, date: string): LessonRow | null => {
    const moving = rows.find((l) => l.id === id);
    if (!moving) return null;
    return (
      rows.find(
        (l) =>
          l.id !== id &&
          l.date === date &&
          l.status !== "Cancelled" &&
          overlaps(moving.start, moving.duration, l.start, l.duration)
      ) ?? null
    );
  }, [rows]);

  const blockedFor = useCallback((id: string, date: string): string | null => {
    const moving = rows.find((l) => l.id === id);
    if (!moving || moving.date === date) return null; // a no-op move is allowed, it just does nothing
    const clash = conflictOn(id, date);
    if (!clash) return null;
    const who = `${clash.className}${clash.classLevel ? ` · ${clash.classLevel}` : ""}`;
    return `${t("Conflicts with")} ${who}`;
  }, [rows, conflictOn, t]);

  const onDrop = useCallback((id: string, date: string) => {
    const lesson = rows.find((l) => l.id === id);
    if (!lesson || lesson.date === date) return; // no-op if unchanged
    reschedule.mutate({ id, date });
  }, [rows, reschedule]);

  const drag = useCalendarDrag({ onDrop, blockedFor });
  const { draggingId, overDate, blocked, ghost, ghostRef, landed, onPointerDown, suppressClick } = drag;
  /* The card the ghost was lifted from stays put and faded for as long as the
   * ghost exists — through the settle and the bounce alike — so the column never
   * reflows mid-gesture and a refused drop visibly returns to where it started. */
  const liftedId = ghost?.id ?? null;

  const onOpen = useCallback((id: string) => setOpenId(id), []);
  const ghostLesson = ghost ? rows.find((l) => l.id === ghost.id) ?? null : null;

  /** How a day cell should read while something is being dragged over it. */
  function dropState(dISO: string): "idle" | "over" | "blocked" {
    if (!draggingId || overDate !== dISO) return "idle";
    return blocked ? "blocked" : "over";
  }
  function dropTint(state: "idle" | "over" | "blocked", base: string): string {
    if (state === "blocked") return "var(--accent-soft)";
    if (state === "over") return "var(--hover)";
    return base;
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
  /* Re-keyed on the view and the range so switching month/week — or stepping to
   * the next period — replays the grid's entry instead of swapping its contents
   * in place. Same `fadeUp` the screen already enters with; no new motion. */
  const gridKey = `${view}:${rangeFrom}`;

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
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => go(-1)} aria-label={t("Previous")} className="btn-ghost" style={navBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("Previous")}</TooltipContent>
            </Tooltip>
            <button onClick={goToday} className="btn-ghost" style={{ height: 34, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{t("Today")}</button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => go(1)} aria-label={t("Next")} className="btn-ghost" style={navBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("Next")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <CalendarFilters
        values={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        classes={classOptions}
        students={studentOptions}
        classrooms={classroomOptions}
        t={t}
      />
      <CalendarLegend lang={lang} />

      {!hasEvents && (
        <div style={noticeStyle}>
          {t("No lessons scheduled in this period. Lessons are generated for roughly a two-month window around today.")}
        </div>
      )}
      {hasEvents && visible.length === 0 && (
        <div style={noticeStyle}>{t("No lessons match these filters.")}</div>
      )}

      {view === "month" ? (
        <div key={gridKey} style={{ ...cardStyle, overflow: "hidden", animation: "fadeUp .22s ease both" }}>
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
              const state = dropState(dISO);
              return (
                <div
                  key={dISO}
                  {...{ [DROP_ATTR]: dISO }}
                  className="cal-cell"
                  style={{
                    minWidth: 0, overflow: "hidden", borderRight: "1px solid var(--border-2)", borderBottom: "1px solid var(--border-2)",
                    padding: "6px 6px 8px",
                    background: dropTint(state, inMonth ? "var(--card)" : "var(--card-2)"),
                    boxShadow: state === "blocked" ? "inset 0 0 0 1px var(--accent)" : undefined,
                    opacity: inMonth ? 1 : 0.6,
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        onClick={() => goDay(d)}
                        className={isToday ? "cal-today" : undefined}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isToday ? "var(--primary)" : "transparent", color: isToday ? "var(--primary-fg)" : "var(--fg-2)" }}
                      >{d.getDate()}</div>
                    </TooltipTrigger>
                    <TooltipContent>{t("Open day")}</TooltipContent>
                  </Tooltip>
                  {events.slice(0, MONTH_MAX_CHIPS).map((e) => (
                    <MonthChip
                      key={e.id}
                      lesson={e}
                      t={t}
                      fmt={fmt}
                      dragging={liftedId === e.id}
                      landed={landed?.id === e.id && landed.date === dISO}
                      onOpen={onOpen}
                      onPointerDown={onPointerDown}
                      suppressClick={suppressClick}
                    />
                  ))}
                  {state !== "idle" && <DropPlaceholder view="month" message={blocked} t={t} />}
                  {events.length > MONTH_MAX_CHIPS && (
                    <button onClick={() => goDay(d)} style={{ fontSize: 10, color: "var(--accent)", padding: "1px 5px", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left", display: "block" }}>+{events.length - MONTH_MAX_CHIPS} {t("more")}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div key={gridKey} {...{ [SCROLLER_ATTR]: "1" }} style={{ overflowX: "auto", animation: "fadeUp .22s ease both" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(150px,1fr))", gap: 10, minWidth: 900 }}>
            {days.map((d) => {
              const dISO = iso(d);
              const isToday = dISO === todayIso;
              const events = byDay.get(dISO) ?? [];
              const state = dropState(dISO);
              return (
                <div
                  key={dISO}
                  {...{ [DROP_ATTR]: dISO }}
                  className="cal-cell"
                  style={{
                    ...cardStyle, overflow: "hidden", minHeight: 220,
                    borderColor: state === "blocked" ? "var(--accent)" : "var(--border)",
                    background: dropTint(state, "var(--card)"),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border-2)", background: isToday ? "var(--accent-soft)" : "var(--card-2)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{dows[d.getDay()]}</div>
                    <div className={isToday ? "cal-today" : undefined} style={{ fontSize: 13, fontWeight: 600, color: isToday ? "var(--accent)" : "var(--fg)" }}>{d.getDate()}</div>
                  </div>
                  <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                    {events.length === 0 && state === "idle" && (
                      <div style={{ fontSize: 11.5, color: "var(--muted-2)", textAlign: "center", padding: "16px 0" }}>{t("Drop here")}</div>
                    )}
                    {events.map((e) => (
                      <WeekEvent
                        key={e.id}
                        lesson={e}
                        t={t}
                        fmt={fmt}
                        dragging={liftedId === e.id}
                        landed={landed?.id === e.id && landed.date === dISO}
                        onOpen={onOpen}
                        onPointerDown={onPointerDown}
                        suppressClick={suppressClick}
                      />
                    ))}
                    {state !== "idle" && <DropPlaceholder view="week" message={blocked} t={t} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ghost && ghostLesson && (
        <DragGhost lesson={ghostLesson} fmt={fmt} width={ghost.width} ghostRef={ghostRef} />
      )}

      <LessonDrawer lessonId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

const noticeStyle: React.CSSProperties = {
  fontSize: 12.5, color: "var(--muted-2)", background: "var(--card-2)",
  border: "1px solid var(--border)", borderRadius: 9, padding: "10px 14px", marginBottom: 12,
};

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
