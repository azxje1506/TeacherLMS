/* Shared Students presentation helpers.
 *
 * The design comp computes the roster's chip / badge / dot styles at runtime, so
 * they are reproduced here once — in the comp's own pill language (11.5px, 600
 * weight, 3px 9px padding, 99px radius, soft-background + solid-foreground
 * pair) — and consumed by both the list and the profile. Kept in one place so
 * the two screens can never drift.
 */

import type { StudentStatus } from "@/lib/types";
import { AVATAR_PALETTE } from "@/lib/constants";

/** Soft/solid colour pair per status, drawn from the design's semantic tokens. */
const STATUS_COLORS: Record<StudentStatus, { soft: string; color: string }> = {
  Active: { soft: "var(--green-soft)", color: "var(--green)" },
  Trial: { soft: "var(--sky-soft)", color: "var(--sky)" },
  Paused: { soft: "var(--amber-soft)", color: "var(--amber)" },
  Archived: { soft: "var(--card-2)", color: "var(--muted)" },
};

export function statusBadgeStyle(status: StudentStatus): React.CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.Archived;
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
    background: c.soft, color: c.color, whiteSpace: "nowrap",
  };
}

export function statusDotStyle(status: StudentStatus): React.CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.Archived;
  return { minWidth: 6, width: 6, height: 6, borderRadius: "50%", background: c.color };
}

/** Toolbar filter chip — the comp's 32px pill, accent-tinted when active. */
export function chipStyle(active: boolean): React.CSSProperties {
  return {
    height: 32, padding: "0 12px", borderRadius: 99, cursor: "pointer",
    fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
    border: `1px solid ${active ? "var(--accent-soft)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--card)",
    color: active ? "var(--accent)" : "var(--muted)",
    display: "flex", alignItems: "center", whiteSpace: "nowrap",
  };
}

/** Profile tab button — the comp's underlined tablist treatment. */
export function tabStyle(active: boolean): React.CSSProperties {
  return {
    height: 38, padding: "0 14px", border: "none", background: "transparent",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    color: active ? "var(--accent)" : "var(--muted)",
    fontSize: 13.5, fontWeight: active ? 600 : 500, fontFamily: "inherit",
    cursor: "pointer", whiteSpace: "nowrap", marginBottom: -1,
  };
}

/** Small square icon button used in the roster's Actions column. */
export const rowIconBtn: React.CSSProperties = {
  minWidth: 30, width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--card)", color: "var(--muted)",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

export const cardStyle: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
};

/** Avatar: uploaded image when present, otherwise the tinted initials disc. */
export function Avatar({
  name, initials, avatar, color, size, fontSize,
}: {
  name: string;
  initials: string;
  avatar: string | null;
  color: string;
  size: number;
  fontSize: number;
}) {
  return (
    <span
      style={{
        minWidth: size, width: size, height: size, borderRadius: "50%",
        background: color || AVATAR_PALETTE[0], color: "#fff",
        fontSize, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative", flexShrink: 0,
      }}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- data-URL upload from the comp's avatar field
        <img src={avatar} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials
      )}
    </span>
  );
}

/** Grade options: Kindergarten + Grades 1-12, matching the schema's 0..12 range. */
export const GRADE_OPTIONS = [
  { value: "0", label: "Kindergarten" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Grade ${i + 1}` })),
];

export const STATUS_OPTIONS: { value: StudentStatus; label: string }[] = [
  { value: "Active", label: "Active" },
  { value: "Trial", label: "Trial" },
  { value: "Paused", label: "Paused" },
  { value: "Archived", label: "Archived" },
];
