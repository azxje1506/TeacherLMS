"use client";

/* Classes list — ported verbatim from the design comp's "CLASS LIST" screen:
 * heading + count, toolbar (search + status chips) and the card grid with its
 * loading / error / empty / ready states. Data is real, via React Query against
 * /api/classes.
 *
 * Sorting and pagination are API-level capabilities (see /api/classes). The
 * comp's list has no pager and no sortable headers, so this screen renders one
 * page at the default sort and adds no chrome the design does not define. */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ClassDrawer } from "@/components/classes/class-drawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cardStyle, chipStyle, classBadgeStyle, typeLabel, scheduleDaysLabel, studentText, feeLabel,
  conflictMessage,
} from "@/components/classes/class-ui";
import {
  createClass, deleteClass, fetchClasses, classKeys, updateClass, setClassStatus,
  ClassConflictError, type ListParams, type ClassRow,
} from "@/components/classes/api";
import { lessonKeys } from "@/components/lessons/api";
import type { ClassInput } from "@/lib/schemas";

const STATUS_CHIPS = ["All", "Active", "Archived"];

export default function ClassesPage() {
  const { t, fmt, lang } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  // Teachers work in the classes they are actually teaching, so the page opens
  // filtered to Active; All and Archived are one chip away. The chip stays plain
  // component state — the screen had no cross-visit memory of it before and
  // nothing here adds one.
  const [status, setStatus] = useState("Active");
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
    // Lessons present class-owned fields (classroom, name, colour), so every
    // lesson view has to re-read after a class changes.
    qc.invalidateQueries({ queryKey: lessonKeys.all });
  };

  const saveMutation = useMutation({
    mutationFn: (vars: { id: string | null; values: ClassInput }) =>
      vars.id ? updateClass(vars.id, vars.values) : createClass(vars.values),
    onSuccess: (_res, vars) => {
      invalidate();
      setDrawerFor(undefined);
      toast(t(vars.id ? "Class updated" : "Class created"));
    },
    onError: (e: Error) => toast(saveErrorText(e), "error"),
  });

  /** A schedule clash is rendered from its data so it localizes; anything else
   * is a dictionary key already. */
  function saveErrorText(e: Error): string {
    return e instanceof ClassConflictError ? conflictMessage(e.conflict, lang, fmt) : t(e.message);
  }

  /** Archive / restore, from the card's quick action or the drawer's footer.
   * Same update path the class detail header has always used — only `status`
   * changes, the rest of the record is re-sent as stored. */
  const statusMutation = useMutation({
    mutationFn: (vars: { klass: ClassRow; status: ClassRow["status"] }) =>
      setClassStatus(vars.klass, vars.status),
    onSuccess: (_res, vars) => {
      invalidate();
      setDrawerFor(undefined);
      toast(t(vars.status === "Archived" ? "Class archived" : "Class restored"));
    },
    onError: (e: Error) => toast(saveErrorText(e), "error"),
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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => refetch()}
              aria-label={t("Refresh")}
              className="btn-ghost"
              style={{ minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isFetching ? { animation: "spin .7s linear infinite" } : undefined}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("Refresh")}</TooltipContent>
        </Tooltip>
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
                {/* Three single-line meta rows, ordered where → when → who &
                    how much: the classroom leads (it is the thing a teacher
                    scans a card for), the weekday summary follows, and the
                    roster + fee close. One line each, so every card in the grid
                    is the same height however many lesson slots its class holds. */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0 16px" }}>
                  {/* Rendered on every card, so the row is a constant: a class
                      with no classroom set says so rather than dropping the line
                      and making its card shorter than its neighbours. */}
                  <div style={metaRow}>
                    <span style={metaIcon}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    </span>
                    <Classroom value={c.classroom} empty={t("No classroom")} />
                  </div>
                  <div style={metaRow}>
                    <span style={metaIcon}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    </span>
                    <span style={truncate}>{scheduleDaysLabel(c.schedule, lang)}</span>
                  </div>
                  <div style={metaRow}>
                    <span style={metaIcon}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
                    </span>
                    <span style={truncate}>
                      {studentText(c.studentCount, lang)} · <span style={{ fontWeight: 600, color: "var(--fg)" }}>{feeLabel(c.fee, fmt)}</span>
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: "auto" }}>
                  <button onClick={() => router.push(`/classes/${c.id}`)} className="btn-ghost" style={{ flex: 1, height: 34, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{t("View class")}</button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => setDrawerFor(c)} aria-label={t("Edit")} className="icon-action" style={iconBtn}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t("Edit")}</TooltipContent>
                  </Tooltip>
                  {/* Archived only: bring the class back without opening it
                      first. Same icon and treatment the roster's archived rows
                      already use (icon-restore in globals.css). */}
                  {c.status === "Archived" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => statusMutation.mutate({ klass: c, status: "Active" })}
                          disabled={statusMutation.isPending}
                          aria-label={t("Restore")}
                          className="icon-restore"
                          style={iconBtn}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Restore")}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => setConfirm(c)} aria-label={t("Delete")} className="icon-danger" style={iconBtn}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t("Delete")}</TooltipContent>
                  </Tooltip>
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
        onSetStatus={(next) => drawerFor && statusMutation.mutate({ klass: drawerFor, status: next })}
        statusSaving={statusMutation.isPending}
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

/** The card's classroom value: always one line, ellipsised when it does not fit,
 * and tooltipped with the full name ONLY when it is actually cut off — a name
 * that fits needs no bubble repeating it back.
 *
 * Overflow is read from the element itself (scrollWidth vs clientWidth) through
 * a ResizeObserver, because whether a name fits depends on the card's width, and
 * the grid reflows the cards at every breakpoint. Observing is also what keeps
 * the state update out of the effect body — it arrives from an external system,
 * including the initial callback ResizeObserver fires on observe(). */
function Classroom({ value, empty }: { value: string; empty: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px of tolerance: sub-pixel layout can leave scrollWidth a hair over
    // clientWidth on text that is in fact fully visible.
    const ro = new ResizeObserver(() => setClipped(el.scrollWidth > el.clientWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  const text = (
    <span ref={ref} style={value ? truncate : { ...truncate, color: "var(--muted-2)" }}>
      {value || empty}
    </span>
  );

  // `asChild` keeps the very same span — no extra element, so wrapping can never
  // change the measurement that decided to wrap it.
  if (!clipped || !value) return text;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent>{value}</TooltipContent>
    </Tooltip>
  );
}

/* Card meta rows — one line each, icon left, value truncated rather than wrapped
 * so a long classroom name can never change a card's height. */
const metaRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--fg-2)", minWidth: 0,
};
const metaIcon: React.CSSProperties = { display: "flex", color: "var(--muted-2)", flex: "none" };
const truncate: React.CSSProperties = {
  minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

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
