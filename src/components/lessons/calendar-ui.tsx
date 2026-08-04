"use client";

/* Calendar presentation atoms — the toolbar, the event cards and the drag
 * affordances, kept out of the Calendar screen so that screen stays a layout.
 *
 * The event cards are memoized: a drag re-renders the calendar whenever the
 * destination cell changes, and without memo every lesson on screen would re-run
 * for a move that concerns exactly two cells. They take `t` / `fmt` / `lang` as
 * props rather than reading the Settings context, because a context read would
 * re-render them anyway and defeat the memo. Callbacks must be stable (the screen
 * keeps them in useCallback) for the same reason.
 *
 * Nothing here introduces a new visual language: the toolbar reuses the Classes
 * toolbar's search field and the shared <Select>, the badges reuse the lesson
 * pill, and the cards keep the exact typography Sprint 5.4 settled on. */

import { memo } from "react";
import type { Formatter } from "@/lib/format";
import { Select, type SelectOption } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeRange } from "@/components/classes/class-ui";
import {
  KindGlyph, calMonthChipStyle, calWeekEventStyle, lessonKind,
  lessonKindColor, lessonKindLabel, LESSON_KINDS, type LessonKind,
} from "./lesson-ui";
import type { LessonRow } from "./api";

/* ------------------------------------------------------------------ toolbar */

export interface CalendarFilterValues {
  q: string;
  classId: string;
  studentId: string;
  classroom: string;
  kind: string;
}

/** The empty value every dropdown falls back to — "no restriction on this axis".
 * Filters combine, so each one only ever narrows what the others left. */
export const ANY = "";

const searchIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
);

export function CalendarFilters({
  values, onChange, classes, students, classrooms, t,
}: {
  values: CalendarFilterValues;
  onChange: (patch: Partial<CalendarFilterValues>) => void;
  classes: SelectOption[];
  students: SelectOption[];
  classrooms: SelectOption[];
  t: (s: string) => string;
}) {
  const kindOptions: SelectOption[] = [
    { value: "All", label: t("All") },
    ...LESSON_KINDS.map((k) => ({ value: k, label: t(lessonKindLabel(k)) })),
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 300 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)", display: "flex" }}>
          {searchIcon}
        </span>
        <input
          className="ring"
          value={values.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder={t("Search lessons…")}
          aria-label={t("Search lessons…")}
          style={{ width: "100%", height: 38, padding: "0 12px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none" }}
        />
      </div>
      <div style={{ minWidth: 150, flex: "0 1 170px" }}>
        <Select
          value={values.classId}
          onChange={(v) => onChange({ classId: v })}
          ariaLabel={t("Class")}
          options={[{ value: ANY, label: t("All classes") }, ...classes]}
        />
      </div>
      <div style={{ minWidth: 150, flex: "0 1 170px" }}>
        <Select
          value={values.studentId}
          onChange={(v) => onChange({ studentId: v })}
          ariaLabel={t("Student")}
          options={[{ value: ANY, label: t("All students") }, ...students]}
        />
      </div>
      <div style={{ minWidth: 140, flex: "0 1 160px" }}>
        <Select
          value={values.classroom}
          onChange={(v) => onChange({ classroom: v })}
          ariaLabel={t("Classroom")}
          options={[{ value: ANY, label: t("All classrooms") }, ...classrooms]}
        />
      </div>
      <div style={{ minWidth: 130, flex: "0 1 150px" }}>
        <Select
          value={values.kind}
          onChange={(v) => onChange({ kind: v })}
          ariaLabel={t("Status")}
          options={kindOptions}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- event cards */

const pinIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

export interface EventCardProps {
  lesson: LessonRow;
  t: (s: string) => string;
  fmt: Formatter;
  /** This card is the one under the pointer — it stays in place, dimmed, while
   * the ghost carries its likeness around. */
  dragging: boolean;
  /** This card has just arrived here from a drop; play its entry once. */
  landed: boolean;
  onOpen: (id: string) => void;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** True when the click now arriving is the tail end of a drag. */
  suppressClick: () => boolean;
}

/** Style shared by both cards while their lesson is being dragged: the original
 * stays where it is, faded, so the row it leaves does not collapse mid-gesture. */
function draggingStyle(on: boolean): React.CSSProperties {
  return on ? { opacity: 0.35, filter: "saturate(.6)" } : {};
}

function landingStyle(on: boolean): React.CSSProperties {
  return on ? { animation: "eventLand .34s cubic-bezier(.32,.72,0,1) both" } : {};
}

/** Month-grid chip. Too small for a label, so a lesson that is not a plain
 * recurring one is marked with its legend glyph alone. */
export const MonthChip = memo(function MonthChip({
  lesson, t, fmt, dragging, landed, onOpen, onPointerDown, suppressClick,
}: EventCardProps) {
  const kind = lessonKind(lesson);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => { if (!suppressClick()) onOpen(lesson.id); }}
          onPointerDown={(e) => onPointerDown(e, lesson.id)}
          className="cal-event"
          style={{ ...calMonthChipStyle(lesson.classColor), ...draggingStyle(dragging), ...landingStyle(landed) }}
        >
          {kind !== "regular" && (
            <span style={{ display: "flex", color: lessonKindColor(kind), flex: "none" }}>
              <KindGlyph kind={kind} size={9} />
            </span>
          )}
          {/* The label truncates inside the chip; without its own min-width:0 a
            * long class name would push the chip — and with it the column —
            * wider than its track. */}
          <span
            style={{
              minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              textDecoration: kind === "cancelled" ? "line-through" : undefined,
            }}
          >
            {fmt.time12(lesson.start)} {lesson.className}
          </span>
        </button>
      </TooltipTrigger>
      {/* The chip shows a truncated start time + name and has no room for
          anything else, so its tooltip carries the full event: name, where,
          when — the same three facts, in the same order, as the week card. */}
      <TooltipContent>
        <div style={tipName}>{lesson.className}</div>
        {kind !== "regular" && <div style={tipMeta}>{t(lessonKindLabel(kind))}</div>}
        {lesson.classroom && <div style={tipMeta}>{pinIcon}<span>{lesson.classroom}</span></div>}
        <div style={tipMeta}>
          {clockIcon}
          <span>{timeRange(lesson, fmt)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

/** Week-column card — class name, then when, then where.
 *
 * The three lines descend in size, weight and colour in the order they are read.
 * There is no "Regular" pill: on a calendar nearly every lesson is a plain
 * recurring one, so the badge appears only when the lesson is something else,
 * and then it carries the same glyph the legend does. */
export const WeekEvent = memo(function WeekEvent({
  lesson, fmt, dragging, landed, onOpen, onPointerDown, suppressClick,
}: EventCardProps) {
  const kind = lessonKind(lesson);
  return (
    <button
      onClick={() => { if (!suppressClick()) onOpen(lesson.id); }}
      onPointerDown={(e) => onPointerDown(e, lesson.id)}
      className="cal-event"
      style={{ ...calWeekEventStyle(lesson.classColor), ...draggingStyle(dragging), ...landingStyle(landed) }}
    >
      <WeekEventBody lesson={lesson} fmt={fmt} kind={kind} />
    </button>
  );
});

/** The week card's contents on their own, so the drag ghost can render exactly
 * the same three lines without duplicating them.
 *
 * A lesson that is not a plain recurring one is marked by its legend glyph
 * sitting in front of the class name, tinted by kind — not by a pill on the top
 * line. A pill is wider than the word it carries, wraps the name onto a second
 * line on a narrow column, and competes with the name for the eye; the glyph
 * costs 9px and says the same thing. */
export function WeekEventBody({
  lesson, fmt, kind,
}: {
  lesson: LessonRow;
  fmt: Formatter;
  kind: LessonKind;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        {kind !== "regular" && (
          <span style={{ display: "flex", flex: "none", color: lessonKindColor(kind) }}>
            <KindGlyph kind={kind} size={10} />
          </span>
        )}
        <div style={{ ...eventName, textDecoration: kind === "cancelled" ? "line-through" : undefined }}>
          {lesson.className}
        </div>
      </div>
      {lesson.classroom && (
        <div style={eventRoom}>{pinIcon}<span style={clip}>{lesson.classroom}</span></div>
      )}
      {/* The lesson's OWN start and duration — never its class's recurring
        * schedule. A rescheduled lesson therefore reads on the calendar as
        * where it is now; where it recurs is the drawer's business. */}
      <div style={eventTime}>{timeRange(lesson, fmt)}</div>
    </>
  );
}

/* Week-card typography — three descending steps in size, weight and colour,
 * matching the order the lines are read in: name, then where, then when. Each
 * line clips to one line (a card must not grow with the length of a name) and
 * the line-heights are explicit rather than inherited, which is what keeps the
 * three evenly spaced instead of drifting with the font size. */
const clip: React.CSSProperties = { minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const eventName: React.CSSProperties = {
  ...clip, fontSize: 13, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-.01em", color: "var(--fg)",
};
const eventRoom: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 5, minWidth: 0,
  fontSize: 11.5, fontWeight: 500, lineHeight: 1.35, marginTop: 3, color: "var(--fg-2)",
};
const eventTime: React.CSSProperties = {
  ...clip, fontSize: 11, fontWeight: 500, lineHeight: 1.35, marginTop: 2,
  color: "var(--muted-2)", fontFamily: "var(--font-mono-stack)",
};

/* Month-chip tooltip — the bubble is already small, inverted text, so the
 * subordinate lines separate from the name by weight and a little transparency
 * rather than by another colour token (which would be reading against --bg).
 * Where and when are prefixed by the same pin and clock the class card uses for
 * the same two facts. The title needs no icon: it is the subject of the bubble. */
const tipName: React.CSSProperties = { fontWeight: 600 };
const tipMeta: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 5, fontWeight: 500, opacity: 0.75, marginTop: 2,
};
const clockIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1.5 }}>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

/* --------------------------------------------------------- drag affordances */

/** The gap the dragged lesson would occupy in the cell under the pointer, and —
 * when the destination refuses it — the reason why.
 *
 * Both live in the destination cell rather than beside the cursor: the question
 * is "can this land HERE?", so the answer belongs where "here" is. It also keeps
 * the ghost a plain lesson card, which is what the ghost is supposed to be. */
export function DropPlaceholder({
  view, message, t,
}: {
  view: "month" | "week";
  /** The refusal reason; null when the drop is allowed. */
  message: string | null;
  t: (s: string) => string;
}) {
  const blocked = message !== null;
  // A legal drop reads as a neutral gap; a refused one takes the accent (this
  // design's red), matching the cell tint behind it.
  const base: React.CSSProperties = {
    border: `1px dashed ${blocked ? "var(--accent)" : "var(--muted-2)"}`,
    background: blocked ? "var(--accent-soft)" : "var(--hover)",
    color: "var(--accent)",
    animation: "placeholderIn .16s ease both",
    display: "flex", alignItems: "center",
    overflow: "hidden",
  };

  if (view === "month") {
    /* A month cell is a 17px line inside a 116px box that already holds three
     * chips and a day number: a class name and level cannot be read there, and
     * ellipsising one produces a truncated sentence that says less than a word
     * would. So the cell states the VERDICT — ⚠ Conflict — and the full "with
     * what" travels on the title, which is also what a screen reader announces.
     * Week columns are wide enough for the sentence and keep it. */
    return (
      <div
        title={message ?? undefined}
        style={{ ...base, minHeight: 17, borderRadius: 5, marginTop: 3, gap: 3, padding: blocked ? "0 4px" : 0 }}
      >
        {blocked && (
          <>
            {warnIcon}
            <span style={{ fontSize: 9.5, fontWeight: 600, lineHeight: 1.5, whiteSpace: "nowrap" }}>
              {t("Conflict")}
            </span>
          </>
        )}
      </div>
    );
  }
  return (
    <div style={{ ...base, minHeight: 62, borderRadius: 9, padding: blocked ? "8px 10px" : 0 }}>
      {blocked && (
        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.4 }}>{message}</span>
      )}
    </div>
  );
}

/** ⚠ — the same alert triangle the list screens use for an error state. */
const warnIcon = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
    <path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);

/** The thing that actually follows the pointer: a copy of the week card, scaled
 * up a hair, faded and lifted off the page.
 *
 * It is ALWAYS an ordinary lesson card — it never turns red and never carries a
 * message. What the ghost communicates is "this is the lesson you are holding";
 * whether it may be put down is the destination's business (see
 * DropPlaceholder), and saying it in both places just made the cursor noisy. */
export function DragGhost({
  lesson, fmt, width, ghostRef,
}: {
  lesson: LessonRow;
  fmt: Formatter;
  width: number;
  ghostRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={ghostRef}
      aria-hidden
      style={{
        position: "fixed", left: 0, top: 0, zIndex: 200, width: Math.max(160, width),
        pointerEvents: "none", visibility: "hidden", transformOrigin: "top left",
        opacity: 0.92, transition: "none",
      }}
    >
      <div
        style={{
          ...calWeekEventStyle(lesson.classColor),
          boxShadow: "0 18px 40px rgba(9,9,11,.22)",
          cursor: "grabbing",
        }}
      >
        <WeekEventBody lesson={lesson} fmt={fmt} kind={lessonKind(lesson)} />
      </div>
    </div>
  );
}
