"use client";

/* ConfirmDialog — the centre dialog CLAUDE.md specifies for confirms. Built from
 * the design comp's own tokens (card surface, --r radius, hairline border) and
 * its `dialogIn` / `overlayFade` keyframes, so it reads as the drawer's
 * centre-stage sibling. Destructive confirms tint the action with --accent. */

import { useEffect, useRef } from "react";
import { useT } from "@/lib/settings-context";

export function ConfirmDialog({
  open, title, message, confirmLabel, destructive = false, busy = false, onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    confirmRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onCancel}
        style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(9,9,11,.42)", animation: "overlayFade .2s ease both" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 91,
          width: "min(420px,92vw)", background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: "var(--r)", boxShadow: "0 20px 50px rgba(9,9,11,.22)",
          padding: 22, animation: "dialogIn .2s ease both",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
          <span
            style={{
              minWidth: 38, width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center",
              background: destructive ? "var(--accent-soft)" : "var(--sky-soft)",
              color: destructive ? "var(--accent)" : "var(--sky)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</div>
            <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "6px 0 0", lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            type="button" onClick={onCancel} className="btn-ghost"
            style={{ flex: 1, height: 40, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            {t("Cancel")}
          </button>
          <button
            ref={confirmRef} type="button" onClick={onConfirm} disabled={busy} className="btn-primary"
            style={{
              flex: 1, height: 40, border: "none", borderRadius: 9,
              background: destructive ? "var(--accent)" : "var(--primary)", color: "var(--primary-fg)",
              fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
