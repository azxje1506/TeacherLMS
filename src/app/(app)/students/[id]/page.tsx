"use client";

/* Student profile — ported from the design comp's "Student profile" screen:
 * back button, profile header (avatar, name + status, summary, Edit / Archive /
 * Delete) and the tablist.
 *
 * Only the Overview tab belongs to the Students module. Attendance, Homework,
 * Classes and Finance read from modules later in the priority order, so they
 * render the comp's own "arrives in a later sprint" panel until then.
 *
 * REVIEWS IS LIVE as of Sprint 8 Gate 4.4, and it is the whole of this page's
 * involvement with it: the tab renders `<StudentReviews>`, which owns its own
 * query, its own states and its own drawer. This page fetches no review, holds
 * no review state and knows no review rule.
 *
 * THE TAB MAY BE DEEP-LINKED. `/students/{id}?tab=Reviews` is the destination
 * the Reviews index's "View performance" already points at. The query is read
 * ONCE, as the initial value of the existing tab state, and is never written
 * back — clicking a tab changes the tab and leaves the URL alone, so there is no
 * URL/state round trip to loop. An unknown value falls back to Overview.
 * `useSearchParams` needs a Suspense boundary, exactly as the Login screen's
 * does; the page's own body is otherwise unchanged. */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings, useT } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { StudentDrawer } from "@/components/students/student-drawer";
import { StudentReviews } from "@/components/reviews/student-reviews";
import { Avatar, cardStyle, statusBadgeStyle, statusDotStyle, tabStyle } from "@/components/students/student-ui";
import {
  deleteStudent, fetchStudent, saveStudentNotes, studentKeys, updateStudent,
} from "@/components/students/api";
import type { Student } from "@/lib/types";

const TABS = ["Overview", "Attendance", "Homework", "Reviews", "Classes", "Finance"] as const;
type Tab = (typeof TABS)[number];

const headBtn: React.CSSProperties = {
  height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--card)", fontSize: 13, fontWeight: 500, fontFamily: "inherit",
  cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11.5, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600,
};

/** The tab a `?tab=` query asks for, or Overview.
 *
 * MEMBERSHIP OF `TABS`, so it fails closed: `?tab=Nonsense`, `?tab=reviews`,
 * `?tab=` and a missing query all land on Overview rather than on a tab that
 * does not exist. It is a pure function of the query string — it reads no state,
 * writes nothing, and is used once, as an initial value. */
function tabFromQuery(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : "Overview";
}

export default function StudentProfilePage() {
  /* `useSearchParams` suspends while the query is resolved, so the page states
   * its own boundary — the same shape the Login screen uses. The fallback is
   * null because the profile already renders its own loading card underneath. */
  return (
    <Suspense fallback={null}>
      <StudentProfile />
    </Suspense>
  );
}

function StudentProfile() {
  const { t, fmt } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const id = String(useParams().id);
  const params = useSearchParams();

  /* Read once, as the initial value. Ordinary tab clicks own the state from
   * then on and nothing writes the query back, so no effect can chase the URL
   * and no render can chase an effect. */
  const [tab, setTab] = useState<Tab>(() => tabFromQuery(params.get("tab")));

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /* KEEP THE SELECTED TAB REACHABLE. At 375px the six tabs are wider than the
   * column, so a deep link to a later tab — `?tab=Reviews` is the one the
   * Reviews index points at — could land on a tab scrolled out of sight, with
   * the strip's scrollbar hidden and nothing to suggest it was there.
   *
   * ONLY `scrollLeft` IS TOUCHED, never `scrollIntoView`: that would search for
   * the nearest scrollable ancestor on BOTH axes and could move the page under
   * the reader. This adjusts one number on one element, and only when the tab is
   * actually out of view — a tab already visible is left exactly where it is, so
   * the strip does not jump when somebody clicks a tab they can already see. */
  const tablistRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tablistRef.current;
    const active = strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!strip || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [tab]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: studentKeys.detail(id),
    queryFn: () => fetchStudent(id),
  });

  const student = data?.student;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: studentKeys.all });
    qc.invalidateQueries({ queryKey: ["meta", "counts"] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: Parameters<typeof updateStudent>[1]) => updateStudent(id, values),
    onSuccess: () => { invalidate(); setEditing(false); toast(t("Student updated")); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const notesMutation = useMutation({
    mutationFn: (value: string) => saveStudentNotes(id, value),
    onSuccess: () => { invalidate(); toast(t("Notes saved")); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteStudent(id),
    onSuccess: () => { invalidate(); toast(t("Student deleted")); router.replace("/students"); },
    onError: (e: Error) => { setConfirming(false); toast(e.message, "error"); },
  });

  function setStatusFor(s: Student, next: Student["status"]) {
    saveMutation.mutate({
      first: s.first, last: s.last, birthday: s.birthday, school: s.school, grade: s.grade,
      parentId: s.parentId, phone: s.phone, status: next, notes: s.notes ?? "", avatar: s.avatar ?? null,
    });
  }

  const back = (
    <Link
      href="/students"
      className="btn-ghost"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px 0 8px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", fontSize: 13, fontWeight: 500, cursor: "pointer", marginBottom: 18, textDecoration: "none" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
      {t("All students")}
    </Link>
  );

  if (isLoading) {
    const bar: React.CSSProperties = {
      background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
      backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
    };
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        {back}
        <div style={{ ...cardStyle, padding: 22, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ minWidth: 66, width: 66, height: 66, borderRadius: "50%", ...bar }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ height: 16, width: "34%", borderRadius: 7, ...bar }} />
            <div style={{ height: 11, width: "48%", borderRadius: 6, ...bar }} />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !student) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        {back}
        <div style={{ ...cardStyle, padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load this student")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("The record may have been deleted, or the connection dropped.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ ...headBtn, color: "var(--fg)", margin: "0 auto" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      </div>
    );
  }

  const parent = data?.parent ?? null;
  const summary = [t(student.gradeLabel), student.school, `${t("Joined")} ${fmt.dateLabel(student.joined)}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-screen-label="Student profile" style={{ animation: "fadeUp .3s ease both" }}>
      {back}

      {/* Profile header */}
      <div style={{ ...cardStyle, padding: 22, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
        <Avatar name={student.name} initials={student.initials} avatar={student.avatar} color={student.avatarColor} size={66} fontSize={24} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{student.name}</h1>
            <span style={statusBadgeStyle(student.status)}><span style={statusDotStyle(student.status)} />{t(student.status)}</span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "5px 0 0" }}>{summary}</p>
        </div>
        {/* An action cluster, spaced by the workspace's derived control rhythm.
          * See --control-gap in globals.css. */}
        <div style={{ display: "flex", gap: "var(--control-gap)", flexWrap: "wrap" }}>
          <button onClick={() => setEditing(true)} className="btn-ghost" style={{ ...headBtn, color: "var(--fg)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            {t("Edit")}
          </button>
          {student.status !== "Archived" ? (
            <button onClick={() => setStatusFor(student, "Archived")} className="btn-ghost" style={{ ...headBtn, color: "var(--fg)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
              {t("Archive")}
            </button>
          ) : (
            <button onClick={() => setStatusFor(student, "Active")} style={{ ...headBtn, color: "var(--green)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
              {t("Restore")}
            </button>
          )}
          <button onClick={() => setConfirming(true)} style={{ ...headBtn, color: "var(--accent)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
            {t("Delete")}
          </button>
        </div>
      </div>

      {/* Tabs */}
      {/* THE DIVIDER LIVES ON THE WRAPPER, OUTSIDE THE SCROLL CONTAINER.
        * A scroll container clips at its PADDING box, and each tab deliberately
        * hangs 1px below the flex line (`marginBottom: -1` in tabStyle) so its
        * 2px active underline covers that divider. Clipping vertically on the
        * same element that draws the divider would shave the underline back to
        * 1px. Splitting them keeps every pixel where it was: the strip pads its
        * own 1px back, pulls it off again with a negative margin, and the
        * wrapper's border lands exactly under the tabs, as before. */}
      <div style={{ borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
        <div
          ref={tablistRef}
          role="tablist"
          aria-label={t("Student sections")}
          className="tabstrip"
          /* HORIZONTAL ONLY. `overflow-y` is stated explicitly because leaving
           * it out does NOT leave it alone — with `overflow-x: auto` beside it,
           * `visible` computes to `auto`, which is what put a vertical scrollbar
           * on this strip. See ".tabstrip" in globals.css. */
          style={{ display: "flex", gap: 2, overflowX: "auto", overflowY: "hidden", paddingBottom: 1, marginBottom: -1 }}
        >
          {TABS.map((tb) => (
            <button key={tb} role="tab" aria-selected={tab === tb} onClick={() => setTab(tb)} style={tabStyle(tab === tb)}>
              {t(tb)}
            </button>
          ))}
        </div>
      </div>

      {tab === "Overview" ? (
        <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
            {/* Student details */}
            <div style={{ ...cardStyle, padding: "18px 20px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>{t("Student details")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 22px" }}>
                <Detail label={t("Birthday")} value={fmt.dateLabel(student.birthday)} />
                <Detail label={t("Age")} value={`${student.age}`} />
                <Detail label={t("School")} value={student.school} />
                <Detail label={t("Grade")} value={t(student.gradeLabel)} />
                <Detail label={t("Joined")} value={fmt.dateLabel(student.joined)} />
                <Detail label={t("Phone")} value={student.phone} mono />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <Stat label={t("Classes")} value={String(student.classes)} />
                <Stat label={t("Attendance")} value={`${student.attendance}%`} />
                <Stat label={t("Balance")} value={fmt.vnd(student.balance)} color={student.balance > 0 ? "var(--accent)" : "var(--fg)"} />
              </div>
            </div>

            {/* Notes — keyed on the stored value so a server-side change re-seeds
                the draft without a state-sync effect. */}
            <NotesCard
              key={`${student.id}|${student.notes ?? ""}`}
              initial={student.notes ?? ""}
              saving={notesMutation.isPending}
              onSave={(value) => notesMutation.mutate(value)}
            />
          </div>

          {/* Parent card */}
          <div style={{ ...cardStyle, padding: "18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>{t("Parent / Guardian")}</div>
            {parent ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <span style={{ minWidth: 42, width: 42, height: 42, borderRadius: "50%", background: parent.color, color: "#fff", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{parent.initials}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{parent.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{t(parent.relationship)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--fg-2)" }}>
                    <span style={{ color: "var(--muted-2)", display: "flex" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
                    </span>
                    <span style={{ fontFamily: "var(--font-mono-stack)" }}>{parent.phone}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--fg-2)" }}>
                    <span style={{ color: "var(--muted-2)", display: "flex" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>
                    </span>
                    {parent.email}
                  </div>
                </div>
              </>
            ) : (
              /* Unassigned state — mirrors the parent-present layout (avatar +
                 name + subtitle) with a neutral placeholder, so a student with
                 no linked parent reads clearly. */
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ minWidth: 42, width: 42, height: 42, borderRadius: "50%", background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>{t("Unassigned")}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-2)" }}>{t("No parent linked. Edit this student to assign one.")}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : tab === "Reviews" ? (
        /* Sprint 8. The component owns the query, the states and the drawer;
         * this page passes it a student id and nothing else. */
        <StudentReviews studentId={id} />
      ) : (
        /* The comp's own placeholder for sections owned by later sprints. */
        <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "52px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 48, width: 48, height: 48, borderRadius: 13, background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{t(tab)} {t("arrives in a later sprint")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 0" }}>
            {t("This section of the student profile connects to the")} {t(tab)} {t("module, which isn't part of this sprint yet.")}
          </p>
        </div>
      )}

      <StudentDrawer
        open={editing}
        student={student}
        parents={data?.parents ?? []}
        saving={saveMutation.isPending}
        onClose={() => setEditing(false)}
        onSave={(values) => saveMutation.mutate(values)}
      />

      <ConfirmDialog
        open={confirming}
        destructive
        title={t("Delete student")}
        message={`${t("This permanently removes")} ${student.name}. ${t("This can't be undone.")}`}
        confirmLabel={t("Delete")}
        busy={deleteMutation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}

function NotesCard({ initial, saving, onSave }: { initial: string; saving: boolean; onSave: (value: string) => void }) {
  const t = useT();
  const [notes, setNotes] = useState(initial);
  return (
    <div style={{ ...cardStyle, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Notes")}</div>
        <button
          onClick={() => onSave(notes)}
          disabled={saving}
          className="btn-primary"
          style={{ height: 32, padding: "0 13px", border: "none", borderRadius: 8, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
        >
          {t("Save notes")}
        </button>
      </div>
      <textarea
        className="ring"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t("Add private notes about this student…")}
        style={{ width: "100%", minHeight: 110, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical", outline: "none" }}
      />
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 3, fontFamily: mono ? "var(--font-mono-stack)" : undefined }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 11, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, marginTop: 2, color }}>{value}</div>
    </div>
  );
}
