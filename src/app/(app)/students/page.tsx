"use client";

/* Students roster — ported verbatim from the design comp's "STUDENTS / STUDENT
 * LIST" screen: heading + count, toolbar (search, status chips, grade filter,
 * refresh, error preview) and the table card with its loading / error / empty /
 * ready states. Data is real, via React Query against /api/students.
 *
 * Sorting and pagination are API-level capabilities (see /api/students). The
 * comp's roster has no pager and no sortable headers, so this screen renders one
 * page at the default sort and adds no chrome the design does not define. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/dialog";
import { StudentDrawer } from "@/components/students/student-drawer";
import {
  Avatar, GRADE_OPTIONS, cardStyle, chipStyle, rowIconBtn, statusBadgeStyle, statusDotStyle,
} from "@/components/students/student-ui";
import {
  createStudent, deleteStudent, fetchStudents, studentKeys, updateStudent, type ListParams,
} from "@/components/students/api";
import type { Student } from "@/lib/types";
import type { StudentInput } from "@/lib/schemas";

const STATUS_CHIPS = ["All", "Active", "Trial", "Paused", "Archived"];

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted-2)",
  textTransform: "uppercase", letterSpacing: ".05em", padding: "11px 14px",
};

export default function StudentsPage() {
  const { t } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [grade, setGrade] = useState("all");
  const params: ListParams = { q, status, grade };

  const [drawerFor, setDrawerFor] = useState<Student | null | undefined>(undefined); // undefined = closed
  const [confirm, setConfirm] = useState<Student | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: studentKeys.list(params),
    queryFn: () => fetchStudents(params),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: studentKeys.all });
    qc.invalidateQueries({ queryKey: ["meta", "counts"] }); // sidebar badge
  };

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; values: StudentInput }) =>
      vars.id ? updateStudent(vars.id, vars.values) : createStudent(vars.values),
    onSuccess: (_res, vars) => {
      invalidate();
      setDrawerFor(undefined);
      toast(t(vars.id ? "Student updated" : "Student created"));
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStudent(id),
    onSuccess: () => { invalidate(); setConfirm(null); toast(t("Student deleted")); },
    onError: (e: Error) => { setConfirm(null); toast(e.message, "error"); },
  });

  /** Archive / restore is a status change through the same update path. */
  function setStatusFor(s: Student, next: Student["status"]) {
    saveMutation.mutate({
      id: s.id,
      values: {
        first: s.first, last: s.last, birthday: s.birthday, school: s.school, grade: s.grade,
        parentId: s.parentId, phone: s.phone, status: next, notes: s.notes ?? "", avatar: s.avatar ?? null,
      },
    });
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const countLabel = isLoading
    ? t("Loading…")
    : `${total} ${total === 1 ? t("student") : t("students")}`;

  return (
    <div data-screen-label="Students" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Students")}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>{countLabel}</p>
        </div>
        <button
          onClick={() => setDrawerFor(null)}
          className="btn-primary"
          style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {t("Add student")}
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 340 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)", display: "flex" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </span>
          <input
            className="ring"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search by name, school, parent…")}
            aria-label={t("Search by name, school, parent…")}
            style={{ width: "100%", height: 38, padding: "0 12px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none" }}
          />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_CHIPS.map((c) => (
            <button key={c} onClick={() => setStatus(c)} style={chipStyle(status === c)}>{t(c)}</button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ minWidth: 150 }}>
          <Select
            ariaLabel={t("Filter by grade")}
            value={grade}
            options={[{ value: "all", label: t("All grades") }, ...GRADE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))]}
            onChange={setGrade}
          />
        </div>

        <button
          onClick={() => refetch()}
          title={t("Refresh")}
          aria-label={t("Refresh")}
          className="btn-ghost"
          style={{ minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isFetching ? { animation: "spin .7s linear infinite" } : undefined}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
        </button>
      </div>

      {/* Table card */}
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        {isLoading && <SkeletonRows />}

        {!isLoading && isError && (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load students")}</div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
              {t("Something went wrong while fetching the roster. Check your connection and try again.")}
            </p>
            <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
              {t("Try again")}
            </button>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No students found")}</div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
              {t("No students match your current search or filters. Try clearing them, or add a new student.")}
            </p>
            <button onClick={() => setDrawerFor(null)} className="btn-primary" style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {t("Add student")}
            </button>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: "var(--card-2)" }}>
                  <th style={{ ...th, padding: "11px 18px" }}>{t("Student")}</th>
                  <th style={th}>{t("Grade")}</th>
                  <th style={th}>{t("Parent")}</th>
                  <th style={th}>{t("Phone")}</th>
                  <th style={th}>{t("Status")}</th>
                  <th style={{ ...th, textAlign: "right", padding: "11px 18px" }}>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="row-hover" style={{ borderTop: "1px solid var(--border-2)" }}>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Link href={`/students/${r.id}`} aria-label={r.name} style={{ display: "flex", borderRadius: "50%" }}>
                          <Avatar name={r.name} initials={r.initials} avatar={r.avatar} color={r.avatarColor} size={36} fontSize={13} />
                        </Link>
                        <div style={{ minWidth: 0 }}>
                          <Link href={`/students/${r.id}`} className="row-name" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", textDecoration: "none", display: "block" }}>
                            {r.name}
                          </Link>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{r.school}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-2)" }}>{t(r.gradeLabel)}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-2)" }}>{r.parentName}</td>
                    <td style={{ padding: "11px 14px", fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--font-mono-stack)" }}>{r.phone}</td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={statusBadgeStyle(r.status)}><span style={statusDotStyle(r.status)} />{t(r.status)}</span>
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <button onClick={() => router.push(`/students/${r.id}`)} title={t("View profile")} aria-label={t("View profile")} className="icon-action" style={rowIconBtn}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                        </button>
                        <button onClick={() => setDrawerFor(r)} title={t("Edit")} aria-label={t("Edit")} className="icon-action" style={rowIconBtn}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                        {r.status !== "Archived" ? (
                          <button onClick={() => setStatusFor(r, "Archived")} title={t("Archive")} aria-label={t("Archive")} className="icon-action" style={rowIconBtn}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
                          </button>
                        ) : (
                          <button onClick={() => setStatusFor(r, "Active")} title={t("Restore")} aria-label={t("Restore")} className="icon-restore" style={rowIconBtn}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                          </button>
                        )}
                        <button onClick={() => setConfirm(r)} title={t("Delete")} aria-label={t("Delete")} className="icon-danger" style={rowIconBtn}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StudentDrawer
        open={drawerFor !== undefined}
        student={drawerFor ?? null}
        parents={data?.parents ?? []}
        saving={saveMutation.isPending}
        onClose={() => setDrawerFor(undefined)}
        onSave={(values) => saveMutation.mutate({ id: drawerFor?.id ?? null, values })}
      />

      <ConfirmDialog
        open={confirm !== null}
        destructive
        title={t("Delete student")}
        message={`${t("This permanently removes")} ${confirm?.name ?? ""}. ${t("This can't be undone.")}`}
        confirmLabel={t("Delete")}
        busy={deleteMutation.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && deleteMutation.mutate(confirm.id)}
      />
    </div>
  );
}

function SkeletonRows() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ padding: "6px 0" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderTop: "1px solid var(--border-2)" }}>
          <div style={{ minWidth: 36, width: 36, height: 36, borderRadius: "50%", ...bar }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ height: 11, width: "38%", borderRadius: 6, ...bar }} />
            <div style={{ height: 9, width: "24%", borderRadius: 6, ...bar }} />
          </div>
          <div style={{ height: 11, width: 90, borderRadius: 6, ...bar }} />
          <div style={{ height: 22, width: 64, borderRadius: 99, ...bar }} />
        </div>
      ))}
    </div>
  );
}
