"use client";

/* Drawer — the design comp's right-side create/edit panel, ported verbatim from
 * the comp's "DRAWER (Create / Edit)" section: scrim, 460px panel, header with
 * title + subtitle + close button, scrolling body, and a two-button footer.
 * Body content is supplied per module (see CLAUDE.md: one drawer, many forms). */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/settings-context";
import { useScrollLock } from "@/lib/use-scroll-lock";

export function Drawer({
  open, title, subtitle, saveLabel, saving = false, onClose, onSave, children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  saveLabel: string;
  saving?: boolean;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Escape closes; focus moves into the panel so the form is immediately usable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const first = panelRef.current?.querySelector<HTMLElement>("input,select,textarea,button");
    first?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the drawer owns the screen (scrollbar-compensated,
  // so the layout behind it does not shift).
  useScrollLock(open);

  if (!open) return null;

  /* Portal to <body>. Each page root runs `animation: fadeUp … both`, and a
   * filling animation leaves a computed transform of matrix(1,0,0,1,0,0) rather
   * than none — which makes that element the containing block for fixed-position
   * descendants. Rendered in place, the scrim and panel would anchor to the page
   * content box instead of the viewport. */
  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(9,9,11,.42)", animation: "overlayFade .2s ease both" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 81, width: "min(460px,94vw)",
          background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 40px rgba(0,0,0,.16)",
          display: "flex", flexDirection: "column", animation: "drawerIn .26s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button
            type="button" onClick={onClose} aria-label={t("Close")} title={t("Close")} className="btn-ghost"
            style={{ minWidth: 32, width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* data-drawer-body marks the scroll container: a form section whose
          * height changes can find it and hold the scroll position steady, so
          * the fields above it never jump. */}
        <div data-drawer-body="1" style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>

        <div style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <button
            type="button" onClick={onClose} className="btn-ghost"
            style={{ flex: 1, height: 42, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button" onClick={onSave} disabled={saving} className="btn-primary"
            style={{ flex: 1, height: 42, border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
