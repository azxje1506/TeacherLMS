"use client";

/* Toast helper — matches the design comp's toast treatment (card surface, hairline
 * border, --r radius, --sh shadow, toastIn animation). Exposed via useToast(). */

import React, { createContext, useCallback, useContext, useState } from "react";
import { TOAST_MS } from "@/lib/constants";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "success") => {
    const id = ++counter;
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 24, zIndex: 200,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10, pointerEvents: "none",
        }}
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--card)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: "var(--r)",
              boxShadow: "0 10px 30px rgba(9,9,11,.14)",
              padding: "11px 15px", fontSize: 13.5, fontWeight: 500,
              animation: "toastIn .22s ease both", maxWidth: "min(92vw, 460px)",
            }}
          >
            <span
              style={{
                width: 18, height: 18, minWidth: 18, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: t.kind === "error" ? "var(--accent-soft)" : t.kind === "info" ? "var(--sky-soft)" : "var(--green-soft)",
                color: t.kind === "error" ? "var(--accent)" : t.kind === "info" ? "var(--sky)" : "var(--green)",
              }}
            >
              {t.kind === "error" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              )}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) return { toast: () => {} }; // no-op outside provider (SSR safety)
  return ctx;
}
