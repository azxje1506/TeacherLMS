"use client";

/* Switch — a two-state mode control, built from the same tokens the comp's other
 * controls use (--accent when on, --border / --card-2 when off, the .ring focus
 * treatment, 99px pill radius). Used where a choice flips the shape of the form
 * rather than setting a boolean field. */

export function Switch({
  checked, onChange, ariaLabel, disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ring"
      style={{
        minWidth: 38, width: 38, height: 22, padding: 2, flex: "none",
        border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`, borderRadius: 99,
        background: checked ? "var(--accent)" : "var(--card-2)",
        display: "flex", alignItems: "center", cursor: disabled ? "default" : "pointer", outline: "none",
        transition: "background .16s ease, border-color .16s ease",
      }}
    >
      <span
        style={{
          display: "block", width: 16, height: 16, borderRadius: 99,
          background: checked ? "#fff" : "var(--muted-2)",
          transform: `translateX(${checked ? 16 : 0}px)`,
          transition: "transform .16s ease, background .16s ease",
        }}
      />
    </button>
  );
}
