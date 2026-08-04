"use client";

/* Lessons list — ported from the design comp's "LESSONS" screen: heading + count
 * ("… · generated from class schedules"), the status filter chips and the row
 * list with its loading / error / empty / ready states. Regular lessons are
 * generated on the server (lazy ensure) — this screen never creates them, matching
 * the design (no "create" control). Clicking a row opens the read-only drawer. */

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cardStyle, chipStyle, timeRange } from "@/components/classes/class-ui";
import { LessonDrawer } from "@/components/lessons/lesson-drawer";
import {
  dateCell, lessonStatusBadgeStyle, lessonTypeLabel,
} from "@/components/lessons/lesson-ui";
import { fetchLessons, lessonKeys, type ListParams } from "@/components/lessons/api";

const STATUS_CHIPS = ["All", "Upcoming", "Completed", "Cancelled"];

/** Rows per request.
 *
 * This screen used to ask for 500 in a single page and render whatever came
 * back, on the reasoning that "the design's list has no pager". That silently
 * capped the screen at the server's MAX_PAGE_SIZE: with 1009 lessons stored, 509
 * of them — every lesson older than the 500th by date — could not be reached
 * from this screen at all, whatever the filter. Lessons are generated
 * continuously, so the collection only grows and the gap only widens.
 *
 * 50 is the API's own DEFAULT_PAGE_SIZE. It keeps the payload small (the browser
 * never holds thousands of rows) while filling the viewport. */
const PAGE_SIZE = 50;

export default function LessonsPage() {
  const { t, fmt, lang } = useSettings();
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  /** Changing a filter re-shapes the result set, so any page number carried over
   * from the previous filter is meaningless — start again at the first page. */
  function filterBy(next: string) {
    setStatus(next);
    setPage(1);
  }

  const params: ListParams = { status, pageSize: PAGE_SIZE, page };
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: lessonKeys.list(params),
    queryFn: () => fetchLessons(params),
    // Keep the previous page on screen while the next one loads, so paging does
    // not flash the skeleton and collapse the page's scroll position.
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  // The server clamps the page it serves and reports it back; trust that over
  // local state so an out-of-range page can never render as "no results".
  const currentPage = data?.page ?? page;
  const pageCount = Math.max(1, Math.ceil(total / (data?.pageSize ?? PAGE_SIZE)));
  const firstRow = total === 0 ? 0 : (currentPage - 1) * (data?.pageSize ?? PAGE_SIZE) + 1;
  const lastRow = Math.min(total, firstRow + rows.length - 1);

  const countLabel = isLoading
    ? t("Loading…")
    : total === 0
      ? `0 ${t("lessons")}`
      // "Showing 51–100 of 1009 lessons" — the range is what tells a teacher
      // where they are in a collection this size; the bare total did not.
      : `${t("Showing")} ${firstRow}–${lastRow} ${t("of")} ${total} ${total === 1 ? t("lesson") : t("lessons")}`;

  function goPage(next: number) {
    setPage(Math.min(pageCount, Math.max(1, next)));
    // A new page starts at the top of the list, not wherever the last one ended.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div data-screen-label="Lessons" style={{ animation: "fadeUp .3s ease both" }}>
      {/* Heading */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>{t("Lessons")}</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>{countLabel} · {t("generated from class schedules")}</p>
      </div>

      {/* Status chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {STATUS_CHIPS.map((c) => (
          <button key={c} onClick={() => filterBy(c)} style={chipStyle(status === c)}>{t(c)}</button>
        ))}
      </div>

      {isLoading && <SkeletonList />}

      {!isLoading && isError && (
        <div style={{ ...cardStyle, padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("Couldn't load lessons")}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 360, margin: "6px auto 18px" }}>
            {t("Something went wrong while fetching the list. Check your connection and try again.")}
          </p>
          <button onClick={() => refetch()} className="btn-ghost" style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
            {t("Try again")}
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "56px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>{t("No lessons match this filter.")}</div>
          ) : (
            rows.map((l) => {
              const dc = dateCell(l.date, lang);
              return (
                <div
                  key={l.id}
                  onClick={() => setOpenId(l.id)}
                  className="row-hover"
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: "1px solid var(--border-2)", cursor: "pointer" }}
                >
                  <div style={{ minWidth: 46, height: 46, borderRadius: 10, background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    <span style={{ fontSize: 9.5, color: "var(--muted-2)", fontWeight: 600, textTransform: "uppercase" }}>{dc.dayLabel}</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{dc.dateNum}</span>
                    <span style={{ fontSize: 8.5, color: "var(--muted-2)", textTransform: "uppercase" }}>{dc.monLabel}</span>
                  </div>
                  <div style={{ width: 3, height: 34, borderRadius: 2, background: l.classColor }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.className}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
                      {t(lessonTypeLabel(l.type))}{l.classroom ? ` · ${l.classroom}` : ""}
                    </div>
                  </div>
                  {/* The full lesson time, through the one shared range
                    * formatter — the duration itself is no longer spelled out. */}
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)", fontFamily: "'Geist Mono',monospace", whiteSpace: "nowrap" }}>
                    {timeRange(l, fmt)}
                  </div>
                  <span style={lessonStatusBadgeStyle(l.status)}>{t(l.status)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {!isLoading && !isError && pageCount > 1 && (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          busy={isFetching}
          onGo={goPage}
          t={t}
        />
      )}

      <LessonDrawer lessonId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** The list's pager.
 *
 * The imported design has no pager, because it was drawn against a handful of
 * demo lessons. Lessons are generated continuously, so the screen needs one to
 * remain usable at all — this is built from controls the design already
 * contains rather than from a new visual language: the Calendar's 34px square
 * nav buttons, and the same muted 12.5px meta type the list header uses.
 *
 * First / last are included alongside prev / next deliberately. With 50 rows a
 * page and a collection in the thousands, prev-and-next alone technically
 * reaches every lesson but takes twenty clicks to do it. */
function Pager({
  page, pageCount, busy, onGo, t,
}: {
  page: number;
  pageCount: number;
  busy: boolean;
  onGo: (page: number) => void;
  t: (s: string) => string;
}) {
  const first = page <= 1;
  const last = page >= pageCount;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
        {t("Page")} {page} {t("of")} {pageCount}
      </div>
      <div style={{ display: "flex", gap: 6, opacity: busy ? 0.6 : 1 }}>
        <PageBtn label={t("First page")} disabled={first} onClick={() => onGo(1)}>
          <path d="M11 17l-5-5 5-5" /><path d="M18 17l-5-5 5-5" />
        </PageBtn>
        <PageBtn label={t("Previous")} disabled={first} onClick={() => onGo(page - 1)}>
          <path d="M15 18l-6-6 6-6" />
        </PageBtn>
        <PageBtn label={t("Next")} disabled={last} onClick={() => onGo(page + 1)}>
          <path d="M9 18l6-6-6-6" />
        </PageBtn>
        <PageBtn label={t("Last page")} disabled={last} onClick={() => onGo(pageCount)}>
          <path d="M13 17l5-5-5-5" /><path d="M6 17l5-5-5-5" />
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="btn-ghost"
      style={{
        minWidth: 34, width: 34, height: 34, border: "1px solid var(--border)", borderRadius: 8,
        background: "var(--card)", color: "var(--fg-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
  // A disabled control never fires the pointer events Radix listens for, so it
  // would hold a tooltip open after the click that disabled it.
  if (disabled) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SkeletonList() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div style={{ ...cardStyle, overflow: "hidden" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: i ? "1px solid var(--border-2)" : "none" }}>
          <div style={{ minWidth: 46, height: 46, borderRadius: 10, ...bar }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 12, width: "45%", borderRadius: 6, ...bar }} />
            <div style={{ height: 10, width: "65%", borderRadius: 6, ...bar }} />
          </div>
          <div style={{ height: 20, width: 64, borderRadius: 99, ...bar }} />
        </div>
      ))}
    </div>
  );
}
