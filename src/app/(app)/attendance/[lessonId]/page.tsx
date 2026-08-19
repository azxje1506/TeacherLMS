"use client";

/* Take attendance — ported from the design comp's "ATTENDANCE TAKE" screen: the
 * back button, the lesson header with Mark all present, the five summary tiles,
 * the student rows with their segmented status control and optional note, and the
 * sticky save bar.
 *
 * A ROUTE, NOT A LOCAL VIEW STATE. The comp models this as a second state of the
 * Attendance screen, but this project already translates the comp's list/detail
 * state model into routes everywhere else (Students, Classes), so a register has
 * its own URL for the same reasons theirs do: it can be linked to, reloaded and
 * navigated back from.
 *
 * NOTHING IS PERSISTED UNTIL SAVE. Opening this screen writes nothing; every edit
 * lives in `draft` until the teacher presses the button. The comp's "Unsaved
 * changes" indicator is driven by comparing that draft against the baseline the
 * server last confirmed.
 *
 * NO "Last updated". The comp has a slot for it, but nothing in the data model
 * records when a register was written — the Attendance schema carries no
 * timestamps and this sprint does not add any. Deriving one from an ObjectId or
 * from the wall clock would put a number in front of a teacher that is not a
 * fact, so the slot simply stays empty until it can be filled honestly.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { cardStyle, timeRange } from "@/components/classes/class-ui";
import { lessonTypeLabel } from "@/components/lessons/lesson-ui";
import { Avatar } from "@/components/students/student-ui";
import {
  ATTENDANCE_DISPLAY_ORDER, ATTENDANCE_COLORS, rateLabel, segmentStyle,
} from "@/components/attendance/attendance-ui";
import {
  attendanceKeys, fetchAttendanceRegister, saveAttendanceRegister,
} from "@/components/attendance/api";
import {
  draftFrom, isDirty, signatureOf, submitFrom, withAllPresent, withNote, withStatus,
  type Draft,
} from "@/components/attendance/draft";
import { summarizeRegister } from "@/lib/attendance";
import type { AttendanceStatus } from "@/lib/types";

export default function TakeAttendancePage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const { t, fmt } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: attendanceKeys.register(lessonId),
    queryFn: () => fetchAttendanceRegister(lessonId),
  });

  const [baseline, setBaseline] = useState<Draft>({});
  const [draft, setDraft] = useState<Draft>({});
  const loadedSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const sig = signatureOf(data.rows);
    if (loadedSignature.current === sig) return;
    loadedSignature.current = sig;
    const next = draftFrom(data.rows);
    setBaseline(next);
    setDraft(next);
  }, [data]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const dirty = useMemo(() => isDirty(rows, draft, baseline), [rows, draft, baseline]);

  /* The summary is computed from the DRAFT, through the same pure function the
   * server uses, so the tiles move the instant a segment is pressed rather than
   * one request later. */
  const summary = useMemo(
    () => summarizeRegister(rows.map((r) => ({ status: draft[r.id]?.status ?? r.status }))),
    [rows, draft]
  );

  const save = useMutation({
    // The COMPLETE visible register, every time. The server writes exactly these
    // students and leaves every other stored entry untouched.
    mutationFn: () => saveAttendanceRegister(lessonId, submitFrom(rows, draft)),
    onSuccess: (register) => {
      // The server's answer becomes the new baseline, so "dirty" is measured
      // against what is actually stored rather than against what was sent.
      const next = draftFrom(register.rows);
      loadedSignature.current = signatureOf(register.rows);
      setBaseline(next);
      setDraft(next);
      qc.setQueryData(attendanceKeys.register(lessonId), register);
      qc.invalidateQueries({ queryKey: attendanceKeys.all });
      // The dashboard reports the monthly attendance rate, which this changes.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast(t("Attendance saved"));
    },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const setStatus = (id: string, status: AttendanceStatus) => setDraft((d) => withStatus(d, id, status));
  const setNote = (id: string, note: string) => setDraft((d) => withNote(d, id, note));
  const markAllPresent = () => setDraft((d) => withAllPresent(d, rows));

  const back = () => router.push("/attendance");

  if (isLoading) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <div style={{ ...cardStyle, height: 96, marginBottom: "var(--gap)" }} />
        <div style={{ ...cardStyle, height: 300 }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <BackButton onClick={back} label={t("All lessons")} />
        <div style={{ ...cardStyle, padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load attendance")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t((error as Error | null)?.message ?? "Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      </div>
    );
  }

  const { lesson, klass } = data;

  return (
    <>
      <div data-screen-label="Take attendance" style={{ animation: "fadeUp .3s ease both", paddingBottom: 80 }}>
        <BackButton onClick={back} label={t("All lessons")} />

        {/* ---- lesson info ---- */}
        <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "var(--gap)" }}>
          <div style={{ height: 5, background: klass.color }} />
          <div style={{ padding: "18px 20px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{klass.name}</h1>
              {/* The LESSON's date — AttendanceRecord.date is legacy and is never
                * read, here or anywhere else. */}
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                {fmt.dateLabel(lesson.date)} · {timeRange(lesson, fmt)}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-2)", marginTop: 2 }}>
                {t(lessonTypeLabel(lesson.type))} · {lesson.classroom}
              </div>
            </div>
            <button
              type="button"
              onClick={markAllPresent}
              className="btn-ghost"
              style={{ height: 34, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {t("Mark all present")}
            </button>
          </div>
        </div>

        {/* ---- summary ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: "var(--gap)" }}>
          {ATTENDANCE_DISPLAY_ORDER.map((status) => (
            <div key={status} style={{ ...cardStyle, borderRadius: 12, padding: "13px 15px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: ATTENDANCE_COLORS[status].color, fontFamily: "'Geist Mono',monospace" }}>
                {status === "Present" ? summary.present
                  : status === "Late" ? summary.late
                    : status === "Absent" ? summary.absent
                      : summary.excused}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t(status)}</div>
            </div>
          ))}
          <div style={{ ...cardStyle, background: "var(--card-2)", borderRadius: 12, padding: "13px 15px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Geist Mono',monospace" }}>{rateLabel(summary.rate)}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t("Attendance rate")}</div>
          </div>
        </div>

        {/* ---- student list ---- */}
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
              {t("No students enrolled in this class.")}
            </div>
          ) : (
            rows.map((r) => {
              const entry = draft[r.id] ?? { status: r.status, note: r.note };
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: "1px solid var(--border-2)", flexWrap: "wrap" }}>
                  <Avatar name={r.name} initials={r.initials} avatar={r.avatar} color={r.avatarColor} size={36} fontSize={13} />
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(r.gradeLabel)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, minWidth: 280 }}>
                    {ATTENDANCE_DISPLAY_ORDER.map((status) => {
                      const active = entry.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setStatus(r.id, status)}
                          style={segmentStyle(status, active)}
                        >
                          {t(status)}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    value={entry.note}
                    onChange={(e) => setNote(r.id, e.target.value)}
                    placeholder={t("Add note (optional)…")}
                    className="ring"
                    style={{ flex: 1, minWidth: 160, height: 34, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ---- sticky save bar ----
        * The comp bleeds this bar to the edges of its own 28px content padding;
        * this app's <main> pads 32px/48px, so the negative margins match THIS
        * container. Same treatment, same result — a bar flush to the content
        * area — rather than the same literal numbers leaving a seam. */}
      <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 20, margin: "0 -32px -48px", padding: "14px 32px", background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(8px)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {dirty && <span style={{ color: "var(--amber)", fontWeight: 600 }}>● {t("Unsaved changes")}</span>}
        </div>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-primary"
          style={{ height: 42, padding: "0 22px", border: "none", borderRadius: 10, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: save.isPending ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
          {t("Save attendance")}
        </button>
      </div>
    </>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px 0 8px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", marginBottom: 16 }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      {label}
    </button>
  );
}
