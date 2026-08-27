"use client";

/* The composer's loading and failure states, shared by the Create and Edit
 * routes so both answer the same way.
 *
 * A FAILURE HERE IS THE WHOLE PAGE, unlike the profile tab's inline one: there
 * is no surrounding surface to keep — the composer IS the screen — so the
 * refusal replaces it and offers the way back that the header would have given.
 *
 * THE SERVER'S SENTENCE IS WHAT IS SHOWN. "Student not found", "An archived
 * student can't be given a new review" and "Review not found" are different
 * refusals, and flattening them into one generic apology would hide which. They
 * are the API's own messages, put through the dictionary like every other string.
 */

import Link from "next/link";
import { useT } from "@/lib/settings-context";

const surface: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
  padding: "60px 24px", textAlign: "center",
};

export function ComposerFailure({ message, onRetry }: { message: string; onRetry: (() => void) | null }) {
  const t = useT();
  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <div style={surface}>
        <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
          <Link
            href="/reviews"
            className="btn-ghost"
            style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {t("Monthly reviews")}
          </Link>
          {onRetry && (
            <button
              onClick={onRetry}
              className="btn-ghost"
              style={{ height: 38, padding: "0 16px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
              {t("Try again")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The composer's shimmer, in the shape the loaded page takes — a header strip
 * over a two-pane split — so the layout does not jump when the read lands. */
export function ComposerSkeleton() {
  const bar: React.CSSProperties = {
    background: "linear-gradient(90deg,var(--border-2) 25%,var(--hover) 37%,var(--border-2) 63%)",
    backgroundSize: "200% 100%", animation: "shimmer 1.3s ease-in-out infinite",
  };
  return (
    <div className="rvc" aria-hidden="true">
      <div className="rvc-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ minWidth: 84, width: 84, height: 34, borderRadius: 9, ...bar }} />
          <div style={{ minWidth: 34, width: 34, height: 34, borderRadius: "50%", ...bar }} />
          <div style={{ flex: 1, minWidth: 0, maxWidth: 220 }}>
            <div style={{ height: 11, width: "80%", borderRadius: 6, ...bar }} />
            <div style={{ height: 9, width: "50%", borderRadius: 6, marginTop: 6, ...bar }} />
          </div>
        </div>
        <div style={{ minWidth: 108, width: 108, height: 36, borderRadius: 9, ...bar }} />
      </div>
      <div className="rvc-split">
        <div className="rvc-editor">
          <div className="rvc-editor-inner" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ height: 190, borderRadius: "var(--r)", ...bar }} />
            <div style={{ height: 34, width: "60%", borderRadius: 9, ...bar }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 34, borderRadius: 9, ...bar }} />
            ))}
          </div>
        </div>
        <div className="rvc-preview">
          <div style={{ height: 520, maxWidth: 760, margin: "0 auto", borderRadius: 12, ...bar }} />
        </div>
      </div>
    </div>
  );
}
