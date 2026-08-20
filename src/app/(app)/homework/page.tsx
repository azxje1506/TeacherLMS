"use client";

/* Homework list — ported from the design comp's "HOMEWORK" screen: heading and
 * "Assign homework" CTA, the class filter, and the card grid with its loading /
 * error / empty / ready states. Data is real, via React Query against
 * /api/homework.
 *
 * TWO DESIGNED SECTIONS ARE DELIBERATELY ABSENT, and their space is not filled:
 *
 *  - the four KPI tiles. Every one of their bindings is computed — label, value
 *    and colour — and no literal survives anywhere. The student profile's
 *    Total / Completed / Late / Missing counters are a plausible reading but they
 *    are a different screen, so using them here would be a guess presented as the
 *    design.
 *  - the status chip row. Three of the four status words exist as copy, but
 *    "Assigned" exists nowhere — not in the comp, not in the dictionary — and a
 *    chip row that cannot filter to Assigned would silently hide every pending
 *    assignment, which is all of the ones this screen can create.
 *
 * Both are omitted whole rather than approximated, and the layout closes over
 * them: the heading keeps its own bottom margin and the filter row keeps its own,
 * so nothing renders an empty container or a placeholder value. The count
 * subtitle goes with them — its binding is a computed string with no recoverable
 * form.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HomeworkDrawer } from "@/components/homework/homework-drawer";
import {
  cardActionStyle, homeworkBadgeStyle, homeworkCardStyle, SCOPE_LABEL,
} from "@/components/homework/homework-ui";
import {
  filterByClass, valuesFromDuplicate, type HomeworkFormValues,
} from "@/components/homework/form";
import {
  createHomework, deleteHomework, fetchHomework, homeworkKeys, updateHomework,
} from "@/components/homework/api";
import type { HomeworkListItem } from "@/lib/homework";
import type { HomeworkCreateBody, HomeworkUpdateBody } from "@/lib/schemas";

const ANY = "";

const iconEdit = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const iconDuplicate = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
const iconDelete = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" /></svg>
);

export default function HomeworkPage() {
  const { t, fmt } = useSettings();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [classFilter, setClassFilter] = useState(ANY);
  /** undefined = drawer closed. null = assigning or duplicating. */
  const [drawerFor, setDrawerFor] = useState<HomeworkListItem | null | undefined>(undefined);
  const [prefill, setPrefill] = useState<HomeworkFormValues | undefined>(undefined);
  const [confirm, setConfirm] = useState<HomeworkListItem | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: homeworkKeys.list,
    queryFn: fetchHomework,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const filterClasses = data?.filterClasses ?? [];
  const assignableClasses = data?.assignableClasses ?? [];
  const rows = useMemo(() => filterByClass(items, classFilter), [items, classFilter]);

  /** Homework moves two Dashboard widgets: a create or delete can change
   * "Homework due today", and a due-date edit can move a month's completion. The
   * list and the dashboard are the only caches involved — no class, student or
   * lesson data changes when homework does. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: homeworkKeys.all });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const closeDrawer = () => { setDrawerFor(undefined); setPrefill(undefined); };

  const createMutation = useMutation({
    mutationFn: (body: HomeworkCreateBody) => createHomework(body),
    onSuccess: () => { invalidate(); closeDrawer(); toast(t("Homework assigned")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; body: HomeworkUpdateBody }) => updateHomework(vars.id, vars.body),
    onSuccess: () => { invalidate(); closeDrawer(); toast(t("Homework updated")); },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHomework(id),
    onSuccess: () => { invalidate(); setConfirm(null); toast(t("Homework deleted")); },
    onError: (e: Error) => { setConfirm(null); toast(t(e.message), "error"); },
  });

  /** Duplicate opens the create form prefilled and writes nothing. The prefill is
   * sanitised against what is still assignable, so a copy of work set for a class
   * that has since been ended arrives with the class unset rather than with a
   * value the server would refuse. */
  const duplicate = (h: HomeworkListItem) => {
    setPrefill(valuesFromDuplicate(h, assignableClasses));
    setDrawerFor(null);
  };

  const assign = () => { setPrefill(undefined); setDrawerFor(null); };

  return (
    <div data-screen-label="Homework" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Homework")}</h1>
        <button
          onClick={assign}
          className="btn-primary"
          style={{ height: 38, padding: "0 15px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {t("Assign homework")}
        </button>
      </div>

      {/* Filter row. The class list is every class the VISIBLE work belongs to,
        * whatever its status now is — filtering it to Active classes would make a
        * past month's homework unreachable the moment its class was archived. */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 20 }} />
        <div style={{ minWidth: 150, flex: "0 1 200px" }}>
          <Select
            value={classFilter}
            onChange={setClassFilter}
            ariaLabel={t("Class")}
            options={[
              { value: ANY, label: t("All classes") },
              ...filterClasses.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
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
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load homework")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {/* The comp's own empty state, with its own sentence. */}
      {!isLoading && !isError && rows.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px dashed var(--border)", borderRadius: "var(--r)", padding: "52px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          {t("No homework matches these filters.")}
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: "var(--gap)" }}>
          {rows.map((h) => (
            <div key={h.id} style={homeworkCardStyle(h.classColor)}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>{h.title}</div>
                <span style={homeworkBadgeStyle(h.status)}>{t(h.status)}</span>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {h.description}
              </p>

              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--fg-2)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px" }}>
                  {t(SCOPE_LABEL[h.scope])}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.assigneeName}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border-2)", paddingTop: 11 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("Due")} {fmt.dateLabel(h.dueDate)}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => { setPrefill(undefined); setDrawerFor(h); }} aria-label={t("Edit")} className="btn-ghost" style={cardActionStyle()}>{iconEdit}</button>
                    </TooltipTrigger>
                    <TooltipContent>{t("Edit")}</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button onClick={() => duplicate(h)} aria-label={t("Duplicate")} className="btn-ghost" style={cardActionStyle()}>{iconDuplicate}</button>
                    </TooltipTrigger>
                    <TooltipContent>{t("Duplicate")}</TooltipContent>
                  </Tooltip>

                  {/* Settled work is a historical record. The button stays — the
                    * card's three-action row is the design — and takes the app's
                    * existing disabled treatment, which globals.css already
                    * defines. The API refuses a settled delete regardless. */}
                  <button
                    onClick={() => setConfirm(h)}
                    disabled={!h.deleteEligible}
                    aria-label={t("Delete")}
                    className="btn-ghost"
                    style={cardActionStyle()}
                  >
                    {iconDelete}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <HomeworkDrawer
        open={drawerFor !== undefined}
        homework={drawerFor ?? null}
        initialValues={prefill}
        assignableClasses={assignableClasses}
        saving={createMutation.isPending || updateMutation.isPending}
        onClose={closeDrawer}
        onCreate={(body) => createMutation.mutate(body)}
        onUpdate={(id, body) => updateMutation.mutate({ id, body })}
      />

      <ConfirmDialog
        open={!!confirm}
        destructive
        title={t("Delete homework?")}
        message={`${t("This permanently removes")} ${confirm?.title ?? ""}. ${t("This can't be undone.")}`}
        confirmLabel={t("Delete")}
        busy={deleteMutation.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && deleteMutation.mutate(confirm.id)}
      />
    </div>
  );
}

/** The card grid's loading state, in the shimmer the other list screens use. */
function SkeletonGrid() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: "var(--gap)" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={homeworkCardStyle("var(--border-2)")}>
          <div style={{ height: 14, width: "65%", borderRadius: 6, ...bar }} />
          <div style={{ height: 10, width: "100%", borderRadius: 6, ...bar }} />
          <div style={{ height: 10, width: "80%", borderRadius: 6, ...bar }} />
          <div style={{ height: 10, width: "45%", borderRadius: 6, ...bar }} />
        </div>
      ))}
    </div>
  );
}
