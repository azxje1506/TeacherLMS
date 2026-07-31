"use client";

/* Combobox — a free-text field that suggests values already in use.
 *
 * Deliberately NOT a variant of <Select>: Select is a closed listbox (the value
 * must be one of the options), while this one's value is whatever the teacher
 * types and the list only offers shortcuts. Both wear the same clothes — the
 * comp's 38px field and its `popIn` popover — so the drawer reads as one form.
 *
 * The input is the value: typing edits it directly, picking a suggestion sets
 * it, and a name that appears in no suggestion is still perfectly valid.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/settings-context";

export function Combobox({
  value, options, onChange, onBlur, placeholder, ariaLabel, invalid = false, emptyLabel,
}: {
  value: string;
  /** Existing values to suggest. Never constrains what may be entered. */
  options: string[];
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  invalid?: boolean;
  /** Shown when nothing matches what has been typed so far. */
  emptyLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Close on outside click, matching the comp's popover behaviour. Escape is
  // handled on the input itself so it never reaches the drawer and closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const typed = value.trim().toLowerCase();
  // An exact match means the field already says what the only suggestion would,
  // so the list stays out of the way instead of echoing it back.
  const matches = options.filter((o) => o.toLowerCase().includes(typed));
  const shown = matches.length === 1 && matches[0].toLowerCase() === typed ? [] : matches;

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (shown.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        if (i === -1) return step === 1 ? 0 : shown.length - 1;
        return (i + step + shown.length) % shown.length;
      });
      return;
    }
    if (e.key === "Enter" && open && active >= 0 && shown[active]) {
      e.preventDefault(); // pick the highlighted suggestion instead of submitting
      pick(shown[active]);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        className="ring"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={open && shown.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        style={{
          width: "100%", height: 38, padding: "0 11px",
          border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
          background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
        }}
      />

      {open && (shown.length > 0 || (typed !== "" && emptyLabel)) && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 90,
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 11,
            boxShadow: "0 12px 30px rgba(9,9,11,.13)", padding: 5,
            maxHeight: 200, overflowY: "auto", animation: "popIn .14s ease both",
          }}
        >
          {shown.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--muted)" }}>{t(emptyLabel ?? "")}</div>
          ) : (
            shown.map((o, i) => {
              const on = o.toLowerCase() === typed;
              return (
                <button
                  key={o}
                  type="button"
                  role="option"
                  aria-selected={on}
                  // Commit before the input's blur can close the list.
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", border: "none", borderRadius: 8, cursor: "pointer",
                    fontFamily: "inherit", fontSize: 13, textAlign: "left",
                    background: i === active ? "var(--hover)" : "transparent",
                    color: on ? "var(--accent)" : "var(--fg)",
                    fontWeight: on ? 600 : 500,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
