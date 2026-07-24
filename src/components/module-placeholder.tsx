"use client";

/* Shown for modules that are wired into navigation but whose UI is being built
 * incrementally. Uses the design comp's own "not available yet" copy. */

import { useT } from "@/lib/settings-context";

export function ModulePlaceholder({ title }: { title: string }) {
  const t = useT();
  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: "0 0 22px" }}>{t(title)}</h1>
      <div
        style={{
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)",
          padding: "56px 32px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        }}
      >
        <div style={{ width: 46, height: 46, borderRadius: 12, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="9" /></svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t(title)}</div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 420, margin: 0 }}>
          {t("This module isn't available yet. It's wired into navigation and ready to build next.")}
        </p>
      </div>
    </div>
  );
}
