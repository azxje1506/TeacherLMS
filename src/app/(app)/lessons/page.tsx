"use client";

/* Lessons list — ported from the design comp's "LESSONS" screen: heading + count
 * ("… · generated from class schedules"), the status filter chips and the row
 * list with its loading / error / empty / ready states. Regular lessons are
 * generated on the server (lazy ensure) — this screen never creates them, matching
 * the design (no "create" control). Clicking a row opens the read-only drawer. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { cardStyle, chipStyle, timeRangeLabel } from "@/components/classes/class-ui";
import { LessonDrawer } from "@/components/lessons/lesson-drawer";
import {
  dateCell, lessonStatusBadgeStyle, lessonTypeLabel,
} from "@/components/lessons/lesson-ui";
import { fetchLessons, lessonKeys, type ListParams } from "@/components/lessons/api";

const STATUS_CHIPS = ["All", "Upcoming", "Completed", "Cancelled"];

export default function LessonsPage() {
  const { t, fmt, lang } = useSettings();
  const [status, setStatus] = useState("All");
  const [openId, setOpenId] = useState<string | null>(null);

  // One page holds every lesson so all types (Regular / Makeup / Extra) render —
  // the design's list has no pager. Matches the Calendar's page size (server caps
  // at MAX_PAGE_SIZE). Without this the newest 50 (all runtime-generated Regulars)
  // push Makeup/Extra onto later pages that never show.
  const params: ListParams = { status, pageSize: 500 };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: lessonKeys.list(params),
    queryFn: () => fetchLessons(params),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const countLabel = isLoading ? t("Loading…") : `${total} ${total === 1 ? t("lesson") : t("lessons")}`;

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
          <button key={c} onClick={() => setStatus(c)} style={chipStyle(status === c)}>{t(c)}</button>
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
                  {/* The full lesson time, start + duration resolved to a range —
                    * the duration itself is no longer spelled out. */}
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)", fontFamily: "'Geist Mono',monospace", whiteSpace: "nowrap" }}>
                    {timeRangeLabel(l.start, fmt.addMinutes(l.start, l.duration), fmt)}
                  </div>
                  <span style={lessonStatusBadgeStyle(l.status)}>{t(l.status)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      <LessonDrawer lessonId={openId} onClose={() => setOpenId(null)} />
    </div>
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
