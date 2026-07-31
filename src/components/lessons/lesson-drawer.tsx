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
import { useSettings } from "@/lib/settings-context";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RecurringSchedule, timeRangeLabel } from "@/components/classes/class-ui";
import { Avatar } from "@/components/students/student-ui";
import {
  lessonStatusBadgeStyle, lessonTypeBadgeStyle, lessonTypeLabel, lessonDurationLabel,
} from "./lesson-ui";
import { fetchLesson, lessonKeys } from "./api";

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase",
  letterSpacing: ".05em", marginBottom: 10,
};
const fieldLabel: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)" };
const fieldValue: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginTop: 2 };

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
                  <div><div style={fieldLabel}>{t("Time")}</div><div style={{ ...fieldValue, fontFamily: "'Geist Mono',monospace" }}>{timeRangeLabel(ld.start, fmt.addMinutes(ld.start, ld.duration), fmt)}</div></div>
                  <div><div style={fieldLabel}>{t("Duration")}</div><div style={fieldValue}>{lessonDurationLabel(ld.duration, lang)}</div></div>
                  <div><div style={fieldLabel}>{t("Classroom")}</div><div style={fieldValue}>{ld.classroom || "—"}</div></div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={fieldLabel}>{t("Recurring schedule")}</div>
                  {/* The Class Detail card's own renderer — one visual language
                    * for recurring schedules across every screen. */}
                  <RecurringSchedule schedule={ld.recurringSchedule} fmt={fmt} lang={lang} />
                </div>
              </div>

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
