"use client";

/* Class detail — ported from the design comp's "CLASS DETAIL" screen: back
 * button, header (colour bar, name + status, type · level · fee · classroom, and
 * the Edit / Archive / Restore / Delete actions) and the two-column body.
 *
 * Only Class-owned data is implemented this sprint — the header, the info line,
 * the Weekly schedule card and the Teacher notes card. Enrolled students,
 * Upcoming lessons and Revenue read from modules later in the priority order
 * (Enrolment, Lessons/Attendance, Finance), so they render the comp's own
 * placeholder state and are NOT wired to any data. The "Assign students" and
 * "Extra lesson" actions belong to those sprints and stay inert until then. */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ClassDrawer } from "@/components/classes/class-drawer";
import {
  cardStyle, classBadgeStyle, typeLabel, feeLabel, dowFull,
} from "@/components/classes/class-ui";
import {
  deleteClass, fetchClass, saveClassNotes, classKeys, updateClass,
} from "@/components/classes/api";
import { CURRENT_MONTH } from "@/lib/constants";
import type { ClassInput } from "@/lib/schemas";

const headBtn: React.CSSProperties = {
  height: 36, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 500,
  fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
};

export default function ClassDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, fmt, lang } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const { data: klass, isLoading, isError } = useQuery({
    queryKey: classKeys.detail(id),
    queryFn: () => fetchClass(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: classKeys.all });
    qc.invalidateQueries({ queryKey: ["meta", "counts"] }); // sidebar badge
  };

  const saveMutation = useMutation({
    mutationFn: (values: ClassInput) => updateClass(id, values),
    onSuccess: () => { invalidate(); setEditing(false); toast(t("Class updated")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) => saveClassNotes(id, notes),
    onSuccess: () => { invalidate(); toast(t("Notes saved")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClass(id),
    onSuccess: () => { invalidate(); toast(t("Class deleted")); router.push("/classes"); },
    onError: (e: Error) => { setConfirm(false); toast(t(e.message), "error"); },
  });

  /** Archive / restore is a status change through the same update path. It
   * rebuilds the full validated payload from the current record. */
  function setStatus(next: "Active" | "Archived") {
    if (!klass) return;
    saveMutation.mutate({
      name: klass.name, type: klass.type, level: klass.level, fee: klass.fee,
      classroom: klass.classroom, status: next, studentIds: klass.studentIds ?? [],
      notes: klass.notes ?? "", schedule: klass.schedule,
    });
  }

  if (isLoading) {
    return <div style={{ padding: "60px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("Loading…")}</div>;
  }

  if (isError || !klass) {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <BackButton onClick={() => router.push("/classes")} label={t("All classes")} />
        <div style={{ ...cardStyle, padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Class not found")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "6px 0 0" }}>
            {t("This class may have been deleted. Head back to the list.")}
          </p>
        </div>
      </div>
    );
  }

  const isOneOnOne = klass.type === "one-on-one";
  const isArchived = klass.status === "Archived";
  const infoLine = [t(typeLabel(klass.type)), klass.level, feeLabel(klass.fee, fmt), klass.classroom]
    .filter(Boolean).join(" · ");
  const scheduleRows = klass.schedule.slice().sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

  return (
    <div data-screen-label="Class detail" style={{ animation: "fadeUp .3s ease both" }}>
      <BackButton onClick={() => router.push("/classes")} label={t("All classes")} />

      {/* Header */}
      <div style={{ ...cardStyle, overflow: "hidden", marginBottom: "var(--gap)" }}>
        <div style={{ height: 5, background: klass.color }} />
        <div style={{ padding: "20px 22px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{klass.name}</h1>
              <span style={classBadgeStyle(klass.status)}>{t(klass.status)}</span>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 5 }}>{infoLine}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Extra lesson belongs to the Lessons/Attendance sprint — shown for
                one-on-one classes per the design, inert until then. */}
            {isOneOnOne && (
              <button
                type="button" disabled title={t("Available in a later sprint")}
                style={{ height: 36, padding: "0 13px", border: "1px solid #7c3aed", borderRadius: 9, background: "color-mix(in srgb, #7c3aed 13%, var(--card))", color: "#7c3aed", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "not-allowed", display: "flex", alignItems: "center", gap: 6 }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {t("Extra lesson")}
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="btn-ghost" style={headBtn}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              {t("Edit")}
            </button>
            {!isArchived ? (
              <button type="button" onClick={() => setStatus("Archived")} className="btn-ghost" style={{ ...headBtn, gap: 0 }}>{t("Archive")}</button>
            ) : (
              <button type="button" onClick={() => setStatus("Active")} className="btn-ghost" style={{ ...headBtn, gap: 0 }}>{t("Restore")}</button>
            )}
            <button type="button" onClick={() => setConfirm(true)} title={t("Delete")} aria-label={t("Delete")} className="icon-danger" style={{ minWidth: 36, width: 36, height: 36, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          {/* Enrolled students — Enrolment is a later sprint: placeholder only. */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Enrolled students")}</div>
              <button type="button" disabled title={t("Available in a later sprint")} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--muted-2)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "not-allowed", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                {t("Assign students")}
              </button>
            </div>
            <div style={{ padding: "20px 18px 26px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              {t("Enrolment arrives in a later sprint.")}
            </div>
          </div>

          {/* Upcoming lessons — Lessons module: placeholder only, no lesson data. */}
          <div style={cardStyle}>
            <div style={{ padding: "16px 18px 12px", fontSize: 14.5, fontWeight: 600 }}>{t("Upcoming lessons")}</div>
            <div style={{ padding: "6px 18px 22px", color: "var(--muted)", fontSize: 13 }}>{t("No upcoming lessons scheduled.")}</div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          {/* Revenue — Finance module: placeholder only, nothing computed. */}
          <div style={{ ...cardStyle, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Revenue")}</div>
              <span style={{ fontSize: 11.5, color: "var(--muted-2)" }}>{fmt.monthLabel(CURRENT_MONTH)}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", fontFamily: "'Geist Mono',monospace" }}>{fmt.vnd(0)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <RevStat label={t("Students paid")} value="—" />
              <RevStat label={t("Unpaid")} value="—" />
              <RevStat label={t("Attendance")} value="—" />
              <RevStat label={t("Upcoming")} value="—" />
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-2)", fontSize: 12, color: "var(--muted-2)" }}>
              {t("No revenue recorded this month yet.")}
            </div>
          </div>

          {/* Weekly schedule — Class-owned, real. */}
          <div style={{ ...cardStyle, padding: "16px 18px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>{t("Weekly schedule")}</div>
            {scheduleRows.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid var(--border-2)" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{dowFull(r.day, lang)}</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)", fontFamily: "'Geist Mono',monospace" }}>{fmt.time12(r.start)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{r.duration} {t("min")}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Teacher notes — Class-owned, real, saves on its own. Keyed on the
              stored value so a server-side change re-seeds the draft (matches the
              Student profile's NotesCard, and keeps state out of an effect). */}
          <NotesCard
            key={`${klass.id}|${klass.notes ?? ""}`}
            initial={klass.notes ?? ""}
            saving={notesMutation.isPending}
            onSave={(value) => notesMutation.mutate(value)}
          />
        </div>
      </div>

      <ClassDrawer
        open={editing}
        klass={klass}
        saving={saveMutation.isPending}
        onClose={() => setEditing(false)}
        onSave={(values) => saveMutation.mutate(values)}
      />

      <ConfirmDialog
        open={confirm}
        destructive
        title={t("Delete class")}
        message={`${t("This permanently removes")} ${klass.name}. ${t("This can't be undone.")}`}
        confirmLabel={t("Delete")}
        busy={deleteMutation.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button" onClick={onClick} className="btn-ghost"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px 0 8px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", marginBottom: 16 }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      {label}
    </button>
  );
}

function RevStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border-2)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function NotesCard({ initial, saving, onSave }: { initial: string; saving: boolean; onSave: (value: string) => void }) {
  const { t } = useSettings();
  const [notes, setNotes] = useState(initial);
  return (
    <div style={{ ...cardStyle, padding: "16px 18px" }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>{t("Teacher notes")}</div>
      <textarea
        className="ring"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t("Notes about this class…")}
        style={{ width: "100%", minHeight: 120, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", lineHeight: 1.55, resize: "vertical", outline: "none" }}
      />
      <button
        type="button"
        onClick={() => onSave(notes)}
        disabled={saving}
        className="btn-primary"
        style={{ marginTop: 10, height: 36, padding: "0 15px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
      >
        {t("Save notes")}
      </button>
    </div>
  );
}
