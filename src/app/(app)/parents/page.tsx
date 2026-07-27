"use client";

/* Parents roster — ported verbatim from the design comp's "PARENTS" screen:
 * heading + count, toolbar (search, refresh) and the table card with its
 * loading / error / empty / ready states. Data is real, via React Query against
 * /api/parents.
 *
 * The comp's roster has no pager and no sortable headers, so this screen renders
 * one page at the default sort and adds no chrome the design does not define. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { cardStyle, rowIconBtn } from "@/components/students/student-ui";
import { ParentDrawer } from "@/components/parents/parent-drawer";
import {
  createParent, deleteParent, fetchParents, parentKeys, updateParent,
  type ListParams, type ParentRow,
} from "@/components/parents/api";
import type { ParentInput } from "@/lib/schemas";

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted-2)",
  textTransform: "uppercase", letterSpacing: ".05em", padding: "11px 14px",
};

export default function ParentsPage() {
  const { t } = useSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const params: ListParams = { q };

  const [drawerFor, setDrawerFor] = useState<ParentRow | null | undefined>(undefined); // undefined = closed
  const [confirm, setConfirm] = useState<ParentRow | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: parentKeys.list(params),
    queryFn: () => fetchParents(params),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: parentKeys.all });
    // Unassigning students on delete changes the roster's Parent column.
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; values: ParentInput }) =>
      vars.id ? updateParent(vars.id, vars.values) : createParent(vars.values),
    onSuccess: (_res, vars) => {
      invalidate();
      setDrawerFor(undefined);
      toast(t(vars.id ? "Parent updated" : "Parent created"));
    },
    // Route the message through t(): Parents-specific errors have vi entries;
    // shared HTTP messages (Unauthorized, Internal server error) have none and
    // fall back to their English source unchanged.
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteParent(id),
    onSuccess: () => { invalidate(); setConfirm(null); toast(t("Parent deleted")); },
    onError: (e: Error) => { setConfirm(null); toast(t(e.message), "error"); },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const countLabel = isLoading
    ? t("Loading…")
    : `${total} ${total === 1 ? t("parent") : t("parents")}`;

  // Delete copy: when a parent has linked students, spell out the Unassign
  // consequence exactly; otherwise the design's standard parent-delete message.
  const deleteMessage = (() => {
    const n = confirm?.childCount ?? 0;
    if (n > 0) {
      return `${t("This parent is currently linked to")} ${n} ${n === 1 ? t("student") : t("students")}. ${t("Deleting this parent will not delete any students.")} ${t("Those students will become Unassigned.")}`;
    }
    return t("This permanently removes the parent record. This cannot be undone.");
  })();

  return (
    <div data-screen-label="Parents" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Parents")}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>{countLabel}</p>
        </div>
        <button
          onClick={() => setDrawerFor(null)}
          className="btn-primary"
          style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {t("Add parent")}
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
            placeholder={t("Search by name, email, phone…")}
            aria-label={t("Search by name, email, phone…")}
            style={{ width: "100%", height: 38, padding: "0 12px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none" }}
          />
        </div>

        <div style={{ flex: 1 }} />

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
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load parents")}</div>
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
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></svg>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t("No parents found")}</div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 340, margin: "6px auto 18px" }}>
              {t("No parents match your search. Add a parent to start linking students.")}
            </p>
            <button onClick={() => setDrawerFor(null)} className="btn-primary" style={{ height: 38, padding: "0 16px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {t("Add parent")}
            </button>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ background: "var(--card-2)" }}>
                  <th style={{ ...th, padding: "11px 18px" }}>{t("Parent")}</th>
                  <th style={th}>{t("Contact")}</th>
                  <th style={th}>{t("Students")}</th>
                  <th style={{ ...th, textAlign: "right", padding: "11px 18px" }}>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="row-hover" style={{ borderTop: "1px solid var(--border-2)" }}>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ minWidth: 36, width: 36, height: 36, borderRadius: "50%", background: p.color, color: "#fff", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {p.initials}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{t(p.relationship)}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontSize: 13, color: "var(--fg-2)", fontFamily: "var(--font-mono-stack)" }}>{p.phone}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{p.email}</div>
                    </td>
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: "var(--accent-soft)", color: "var(--accent)" }}>{p.childCount}</span>{" "}
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.childCount === 1 ? t("student") : t("students")}</span>
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <button onClick={() => setDrawerFor(p)} title={t("Edit")} aria-label={t("Edit")} className="icon-action" style={rowIconBtn}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                        </button>
                        <button onClick={() => setConfirm(p)} title={t("Delete")} aria-label={t("Delete")} className="icon-danger" style={rowIconBtn}>
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

      <ParentDrawer
        open={drawerFor !== undefined}
        parent={drawerFor ?? null}
        saving={saveMutation.isPending}
        onClose={() => setDrawerFor(undefined)}
        onSave={(values) => saveMutation.mutate({ id: drawerFor?.id ?? null, values })}
      />

      <ConfirmDialog
        open={confirm !== null}
        destructive
        title={t("Delete parent")}
        message={deleteMessage}
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
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderTop: "1px solid var(--border-2)" }}>
          <div style={{ minWidth: 38, width: 38, height: 38, borderRadius: "50%", ...bar }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ height: 11, width: "32%", borderRadius: 6, ...bar }} />
            <div style={{ height: 9, width: "22%", borderRadius: 6, ...bar }} />
          </div>
        </div>
      ))}
    </div>
  );
}
