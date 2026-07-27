"use client";

/* Classes list — ported verbatim from the design comp's "CLASS LIST" screen:
 * heading + count, toolbar (search + status chips) and the card grid with its
 * loading / error / empty / ready states. Data is real, via React Query against
 * /api/classes.
 *
 * Sorting and pagination are API-level capabilities (see /api/classes). The
 * comp's list has no pager and no sortable headers, so this screen renders one
 * page at the default sort and adds no chrome the design does not define. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ClassDrawer } from "@/components/classes/class-drawer";
import {
  cardStyle, chipStyle, classBadgeStyle, typeLabel, scheduleLabel, studentText, feeLabel,
} from "@/components/classes/class-ui";
import {
  createClass, deleteClass, fetchClasses, classKeys, updateClass,
  type ListParams, type ClassRow,
} from "@/components/classes/api";
import type { ClassInput } from "@/lib/schemas";

const STATUS_CHIPS = ["All", "Active", "Archived"];

export default function ClassesPage() {
  const { t, fmt, lang } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const params: ListParams = { q, status };

  const [drawerFor, setDrawerFor] = useState<ClassRow | null | undefined>(undefined); // undefined = closed
  const [confirm, setConfirm] = useState<ClassRow | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: classKeys.list(params),
    queryFn: () => fetchClasses(params),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: classKeys.all });
    qc.invalidateQueries({ queryKey: ["meta", "counts"] }); // sidebar badge
  };

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; values: ClassInput }) =>
      vars.id ? updateClass(vars.id, vars.values) : createClass(vars.values),
    onSuccess: (_res, vars) => {
      invalidate();
      setDrawerFor(undefined);
      toast(t(vars.id ? "Class updated" : "Class created"));
    },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClass(id),
    onSuccess: () => { invalidate(); setConfirm(null); toast(t("Class deleted")); },
    onError: (e: Error) => { setConfirm(null); toast(t(e.message), "error"); },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const countLabel = isLoading
    ? t("Loading…")
    : `${total} ${total === 1 ? t("class") : t("classes")}`;

  return (
    <div data-screen-label="Classes" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Classes")}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>{countLabel}</p>
        </div>
        <button
          onClick={() => setDrawerFor(null)}
          className="btn-primary"
          style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {t("Create class")}
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
            placeholder={t("Search classes…")}
            aria-label={t("Search classes…")}
            style={{ width: "100%", height: 38, padding: "0 12px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none" }}
          />
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_CHIPS.map((c) => (
            <button key={c} onClick={() => setStatus(c)} style={chipStyle(status === c)}>{t(c)}</button>
          ))}
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

      {isLoading && <SkeletonGrid />}

      {!isLoading && isError && (
        <div style={{ ...cardStyle, padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load classes")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 16, background: "var(--card)", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No classes found")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 340, margin: "6px auto 18px" }}>
            {t("No classes match your filter. Create a class to start scheduling lessons.")}
          </p>
          <button onClick={() => setDrawerFor(null)} className="btn-primary" style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("Create class")}
          </button>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "var(--gap)" }}>
          {rows.map((c) => (
            <div key={c.id} style={{ ...cardStyle, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ height: 4, background: c.color }} />
              <div style={{ padding: "16px 17px", flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>{c.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{t(typeLabel(c.type))}{c.level ? ` · ${c.level}` : ""}</div>
                  </div>
                  <span style={classBadgeStyle(c.status)}>{t(c.status)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "15px 0 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--fg-2)" }}>
                    <span style={{ display: "flex", color: "var(--muted-2)" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    </span>
                    {scheduleLabel(c.schedule, fmt, lang)}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--fg-2)" }}>
                    <span style={{ display: "flex", color: "var(--muted-2)" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
                    </span>
                    {studentText(c.studentCount, lang)} · <span style={{ fontWeight: 600, color: "var(--fg)" }}>{feeLabel(c.fee, fmt)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: "auto" }}>
                  <button onClick={() => router.push(`/classes/${c.id}`)} className="btn-ghost" style={{ flex: 1, height: 34, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{t("View class")}</button>
                  <button onClick={() => setDrawerFor(c)} title={t("Edit")} aria-label={t("Edit")} className="icon-action" style={iconBtn}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button onClick={() => setConfirm(c)} title={t("Delete")} aria-label={t("Delete")} className="icon-danger" style={iconBtn}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ClassDrawer
        open={drawerFor !== undefined}
        klass={drawerFor ?? null}
        saving={saveMutation.isPending}
        onClose={() => setDrawerFor(undefined)}
        onSave={(values) => saveMutation.mutate({ id: drawerFor?.id ?? null, values })}
      />

      <ConfirmDialog
        open={confirm !== null}
        destructive
        title={t("Delete class")}
        message={`${t("This permanently removes")} ${confirm?.name ?? ""}. ${t("This can't be undone.")}`}
        confirmLabel={t("Delete")}
        busy={deleteMutation.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && deleteMutation.mutate(confirm.id)}
      />
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  minWidth: 34, width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--card)", color: "var(--muted)",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function SkeletonGrid() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: "var(--gap)" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ height: 4, ...bar }} />
          <div style={{ padding: "16px 17px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ height: 13, width: "60%", borderRadius: 6, ...bar }} />
            <div style={{ height: 10, width: "40%", borderRadius: 6, ...bar }} />
            <div style={{ height: 10, width: "70%", borderRadius: 6, ...bar, marginTop: 6 }} />
            <div style={{ height: 34, borderRadius: 8, ...bar, marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
