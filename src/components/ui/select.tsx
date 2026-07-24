"use client";

/* Select — the design comp's `data-cs-trigger` control: a button that opens a
 * popover listbox. The comp computes the trigger style at runtime and styles the
 * hover state globally (globals.css `[data-cs-trigger]:hover`), so the resting
 * style here reproduces the comp's field treatment: 38px tall, 1px --border,
 * 9px radius, --card surface, chevron in --muted-2. The popover uses the comp's
 * own `popIn` keyframe. */

import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

const chevron = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", color: "var(--muted-2)" }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export function Select({
  value, options, onChange, placeholder = "Select…", ariaLabel, invalid = false, height = 38,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  invalid?: boolean;
  height?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Close on outside click / Escape, matching the comp's popover behaviour.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); wrapRef.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        data-cs-trigger="1"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", height, padding: "0 11px",
          border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
          background: "var(--card)", color: current ? "var(--fg)" : "var(--muted-2)",
          fontSize: 13, fontFamily: "inherit", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? placeholder}
        </span>
        {chevron}
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 90,
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 11,
            boxShadow: "0 12px 30px rgba(9,9,11,.13)", padding: 5,
            maxHeight: 260, overflowY: "auto", animation: "popIn .14s ease both",
          }}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "8px 10px", border: "none", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 13, textAlign: "left",
                  background: on ? "var(--accent-soft)" : "transparent",
                  color: on ? "var(--accent)" : "var(--fg)",
                  fontWeight: on ? 600 : 500,
                }}
                // Only unselected rows take the ghost hover; the selected row keeps --accent-soft.
                className={on ? undefined : "btn-ghost"}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {on && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
