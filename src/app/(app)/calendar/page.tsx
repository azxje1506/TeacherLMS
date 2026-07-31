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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        onClick={() => goDay(d)}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isToday ? "var(--primary)" : "transparent", color: isToday ? "var(--primary-fg)" : "var(--fg-2)" }}
                      >{d.getDate()}</div>
                    </TooltipTrigger>
                    <TooltipContent>{t("Open day")}</TooltipContent>
                  </Tooltip>
                  {events.slice(0, MONTH_MAX_CHIPS).map((e) => (
                    <Tooltip key={e.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setOpenId(e.id)}
                          draggable
                          onDragStart={() => setDraggingId(e.id)}
                          onDragEnd={() => setDraggingId(null)}
                          style={calMonthChipStyle(e.classColor)}
                        >
                          {/* Makeup / Extra keep their marker here: this is the
                            * only place on the calendar that an ad-hoc lesson is
                            * distinguishable at a glance, and a Regular lesson —
                            * which is nearly all of them — shows nothing. */}
                          {e.type !== "regular" && <span style={{ ...lessonTypeBadgeStyle(e.type), padding: "1px 4px", marginRight: 3, fontSize: 8, flex: "none" }}>{t(lessonTypeLabel(e.type))}</span>}
                          {/* The label truncates inside the chip; without its own
                            * min-width:0 a long class name would push the chip —
                            * and with it the column — wider than its track. */}
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {fmt.time12(e.start)} {e.className}
                          </span>
                        </button>
                      </TooltipTrigger>
                      {/* The chip shows a truncated start time + name and has no
                          room for anything else, so its tooltip carries the full
                          event: name, where, when — the same three facts, in the
                          same order, as the week view's card. */}
                      <TooltipContent>
                        <div style={tipName}>{e.className}</div>
                        {e.classroom && (
                          <div style={tipMeta}>{pinIcon}<span>{e.classroom}</span></div>
                        )}
                        <div style={tipMeta}>
                          {clockIcon}
                          <span>{timeRangeLabel(e.start, fmt.addMinutes(e.start, e.duration), fmt)}</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
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
                      /* Event card: class name, then where, then when. No
                       * lesson-type badge — on a calendar all but a handful of
                       * lessons are Regular, so the pill was noise competing
                       * with the name for the top of the card. The lesson's
                       * type, status and notes are in the drawer one click away.
                       *
                       * Each line keeps the typography its role was given in
                       * 5.4; only the order of the two subordinate lines moved. */
                      <button
                        key={e.id}
                        onClick={() => setOpenId(e.id)}
                        draggable
                        onDragStart={() => setDraggingId(e.id)}
                        onDragEnd={() => setDraggingId(null)}
                        style={calWeekEventStyle(e.classColor)}
                      >
                        <div style={eventName}>{e.className}</div>
                        {e.classroom && <div style={eventRoom}>{e.classroom}</div>}
                        <div style={eventTime}>
                          {timeRangeLabel(e.start, fmt.addMinutes(e.start, e.duration), fmt)}
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

/* Week-view event card typography — three genuinely descending steps in size,
 * weight and colour, matching the order the lines are read in: name, then where,
 * then when. The time is the quietest of the three; it used to be set larger and
 * darker than the classroom above it, which fought the order.
 *
 * Each line clips to one line (a card must not grow with the length of a name)
 * and the line-heights are explicit rather than inherited, which is what keeps
 * the three evenly spaced instead of drifting with the font size. */
const eventLine: React.CSSProperties = {
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};
const eventName: React.CSSProperties = {
  ...eventLine,
  fontSize: 13, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-.01em", color: "var(--fg)",
};
const eventRoom: React.CSSProperties = {
  ...eventLine,
  fontSize: 11.5, fontWeight: 500, lineHeight: 1.35, marginTop: 3,
  color: "var(--fg-2)",
};
const eventTime: React.CSSProperties = {
  ...eventLine,
  fontSize: 11, fontWeight: 500, lineHeight: 1.35, marginTop: 2,
  color: "var(--muted-2)", fontFamily: "var(--font-mono-stack)",
};

/* Month-chip tooltip — the bubble is already small, inverted text, so the two
 * subordinate lines separate from the name by weight and a little transparency
 * rather than by another colour token (which would be reading against --bg).
 * Each is prefixed by its own glyph — the same pin and clock the class card uses
 * for the same two facts — so where and when are told apart at a glance without
 * a label. The title needs no icon: it is the subject of the bubble. */
const tipName: React.CSSProperties = { fontWeight: 600 };
const tipMeta: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 5,
  fontWeight: 500, opacity: 0.75, marginTop: 2,
};
/** Icons sit on the first line of a value that wraps, hence the nudge. */
const tipIcon: React.CSSProperties = { flex: "none", marginTop: 1.5 };

const pinIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={tipIcon}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const clockIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={tipIcon}>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

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
