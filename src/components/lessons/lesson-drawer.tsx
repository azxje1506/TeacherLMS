"use client";

/* Lesson drawer — the design comp's read-only "LESSON DRAWER": scrim, 440px
 * right panel, header (class colour dot, class name, lesson type, close), and a
 * scrolling body with the status + type badges, the Lesson information grid and
 * the Students section. Opened by clicking a lesson on the Lessons list or the
 * Calendar; it never navigates away.
 *
 * The comp's markup for this drawer is read-only (its action controls fall in the
 * truncated region of the export), so no cancel/reschedule/notes controls are
 * invented here — the operations exist on the API and will surface when their
 * design does. Everything shown comes from a single GET /api/lessons/:id. */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { Formatter } from "@/lib/format";
import type { Lang } from "@/lib/types";
import { useSettings } from "@/lib/settings-context";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dowFull, RecurringSchedule, timeRange } from "@/components/classes/class-ui";
import { Avatar } from "@/components/students/student-ui";
import {
  isRescheduled, isoWeekday, lessonHistory, lessonKindColor,
  lessonStatusBadgeStyle, lessonTypeBadgeStyle, lessonTypeLabel, lessonDurationLabel, KindGlyph,
} from "./lesson-ui";
import { fetchLesson, lessonKeys, type LessonDetail } from "./api";

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase",
  letterSpacing: ".05em", marginBottom: 10,
};
const fieldLabel: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)" };
const fieldValue: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginTop: 2 };
const timeValue: React.CSSProperties = { ...fieldValue, fontFamily: "'Geist Mono',monospace" };
/** A timeline step's recorded date / time — mono, so the stamps under a column
 * of steps line up digit for digit. */
const stampLine: React.CSSProperties = {
  fontSize: 11.5, color: "var(--muted)", marginTop: 2, fontFamily: "'Geist Mono',monospace",
};

/** One weekday + time-range block: the schedule a lesson used to sit in, or the
 * one it sits in now. Same two lines in both, so the pair reads as a comparison. */
function SlotBlock({
  label, date, start, duration, fmt, lang,
}: {
  label: string;
  date: string;
  start: string;
  duration: number;
  fmt: Formatter;
  lang: Lang;
}) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={fieldValue}>{dowFull(isoWeekday(date), lang)}</div>
      <div style={timeValue}>{timeRange({ start, duration }, fmt)}</div>
    </div>
  );
}

/** The two halves of a moved lesson — where it recurs, where it is being taught
 * — plus the one-line statement of the move. Everything comes from the lesson's
 * own stored origin (see Lesson.originalDate); the class is never consulted, so
 * editing the class schedule later cannot rewrite this history. */
function RescheduledSchedule({
  lesson, t, fmt, lang,
}: {
  lesson: LessonDetail;
  t: (s: string) => string;
  fmt: Formatter;
  lang: Lang;
}) {
  const originDate = lesson.originalDate ?? lesson.date;
  const originStart = lesson.originalStart ?? lesson.start;
  const originDuration = lesson.originalDuration ?? lesson.duration;
  const originDay = dowFull(isoWeekday(originDate), lang);

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SlotBlock
          // A Makeup or an Extra has no recurring slot of its own — it was placed
          // once and then moved — so the heading says what is true of each.
          label={t(lesson.type === "regular" ? "Recurring schedule" : "Original schedule")}
          date={originDate}
          start={originStart}
          duration={originDuration}
          fmt={fmt}
          lang={lang}
        />
        <SlotBlock
          label={t("Current lesson")}
          date={lesson.date}
          start={lesson.start}
          duration={lesson.duration}
          fmt={fmt}
          lang={lang}
        />
      </div>
      <div>
        <div style={fieldLabel}>{t("Status")}</div>
        <div style={{ ...fieldValue, display: "flex", alignItems: "center", gap: 6, color: "var(--sky)" }}>
          <KindGlyph kind="rescheduled" size={12} />
          {t("Rescheduled from")} {originDay}
        </div>
      </div>
    </div>
  );
}

/** The lesson's life so far, as a vertical timeline: what it started as, whether
 * it moved, and where it stands now. Presentation only — it reads the lesson's
 * own type, status and origin, and no history is stored anywhere. */
function LessonHistory({
  lesson, t, fmt,
}: {
  lesson: LessonDetail;
  t: (s: string) => string;
  fmt: Formatter;
}) {
  const steps = lessonHistory(lesson);
  return (
    <div>
      <div style={sectionLabel}>{t("History")}</div>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const color = s.kind === "done" ? "var(--green)" : lessonKindColor(s.kind);
        // `stretch` so the marker column takes the row's full height and the
        // connector below can simply fill what the text beside it leaves.
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
            {/* Marker column: the glyph, then the connector down to the next
              * step. The connector belongs to the step above it, so the last
              * step ends cleanly instead of trailing a line into nothing. */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <span style={{ display: "flex", flex: "none", color, opacity: last ? 1 : 0.8, marginTop: 2 }}>
                <KindGlyph kind={s.kind === "done" ? "regular" : s.kind} size={13} />
              </span>
              {!last && <span style={{ width: 1, flex: 1, background: "var(--border)", margin: "3px 0" }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 12, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: last ? 600 : 500, color: last ? "var(--fg)" : "var(--fg-2)" }}>
                {t(s.label)}
              </div>
              {/* Date, then clock time on its own line — and only for the steps
                * that actually have one (see lessonHistory). Both go through the
                * shared formatter, so they follow the teacher's date and time
                * preferences like every other date in the app. */}
              {s.date && (
                <div style={stampLine}>{fmt.dateLabel(s.date)}</div>
              )}
              {s.time && (
                <div style={stampLine}>{fmt.time12(s.time)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LessonDrawer({ lessonId, onClose }: { lessonId: string | null; onClose: () => void }) {
  const open = lessonId !== null;
  const { t, fmt, lang } = useSettings();

  useScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { data: ld, isLoading } = useQuery({
    queryKey: lessonKeys.detail(lessonId ?? ""),
    queryFn: () => fetchLesson(lessonId as string),
    enabled: open,
  });

  if (!open) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(9,9,11,.42)", animation: "overlayFade .2s ease both" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Lesson details")}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 81, width: "min(440px,94vw)",
          background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 40px rgba(0,0,0,.16)",
          display: "flex", flexDirection: "column", animation: "drawerIn .26s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <div style={{ minWidth: 10, width: 10, height: 10, borderRadius: "50%", background: ld?.classColor ?? "var(--muted)" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ld?.className ?? t("Loading…")}
              </div>
              {ld && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{t(lessonTypeLabel(ld.type))}</div>}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button" onClick={onClose} aria-label={t("Close")} className="btn-ghost"
                style={{ minWidth: 32, width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("Close")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 20 }}>
          {isLoading || !ld ? (
            <div style={{ color: "var(--muted)", fontSize: 13.5 }}>{t("Loading…")}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={lessonStatusBadgeStyle(ld.status)}>{t(ld.status)}</span>
                <span style={lessonTypeBadgeStyle(ld.type)}>{t(lessonTypeLabel(ld.type))}</span>
              </div>

              <div>
                <div style={sectionLabel}>{t("Lesson information")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div><div style={fieldLabel}>{t("Date")}</div><div style={fieldValue}>{fmt.dateLabel(ld.date)}</div></div>
                  <div><div style={fieldLabel}>{t("Time")}</div><div style={timeValue}>{timeRange(ld, fmt)}</div></div>
                  <div><div style={fieldLabel}>{t("Duration")}</div><div style={fieldValue}>{lessonDurationLabel(ld.duration, lang)}</div></div>
                  <div><div style={fieldLabel}>{t("Classroom")}</div><div style={fieldValue}>{ld.classroom || "—"}</div></div>
                </div>
                {isRescheduled(ld) ? (
                  /* A moved lesson is told in two halves: the slot it belongs to
                   * and the slot it is actually being taught in. Showing the
                   * class's full recurring schedule here instead would answer the
                   * wrong question — this lesson's own origin is what changed. */
                  <RescheduledSchedule lesson={ld} t={t} fmt={fmt} lang={lang} />
                ) : (
                  <div style={{ marginTop: 14 }}>
                    <div style={fieldLabel}>{t("Recurring schedule")}</div>
                    {/* The Class Detail card's own renderer — one visual language
                      * for recurring schedules across every screen. */}
                    <RecurringSchedule schedule={ld.recurringSchedule} fmt={fmt} lang={lang} />
                  </div>
                )}
              </div>

              <LessonHistory lesson={ld} t={t} fmt={fmt} />

              <div>
                <div style={sectionLabel}>{t("Students")} · {ld.studentCount}</div>
                {ld.students.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("No students enrolled.")}</div>
                ) : (
                  ld.students.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
                      <Avatar name={s.name} initials={s.initials} avatar={s.avatar} color={s.avatarColor} size={36} fontSize={13} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.gradeLabel}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {ld.notes && ld.notes.trim() !== "" && (
                <div>
                  <div style={sectionLabel}>{t("Notes")}</div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{ld.notes}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
