/* Shared Homework presentation helpers.
 *
 * The design comp computes each card's status badge at runtime, so the mapping is
 * reproduced here once, in the comp's own token language, and consumed by the
 * card. Kept in one place so nothing can drift.
 */

import type { HomeworkStatus } from "@/lib/types";

/** Soft/solid colour pair per status.
 *
 * THREE OF THE FOUR ARE RECOVERED, not chosen. The imported design's student
 * profile draws its homework counters in exactly these tokens — Completed in
 * `--green`, Late in `--amber`, Missing in `--accent`, each over its `-soft`
 * companion — and the "Missing homework" and "Late homework" panels repeat the
 * pairing. This is the comp's own homework colour language, reused.
 *
 * `Assigned` appears nowhere in the design and has no pair to recover. It takes
 * the design system's existing NEUTRAL treatment — the muted grey over `--card-2`
 * that the class badge already uses for a status that is simply not eventful —
 * rather than a new colour invented to sit beside the other three. Pending work
 * is not a warning and not a success, and nothing in the design says it is.
 *
 * Typed as a total Record on purpose: adding a status to `HomeworkStatus` without
 * a pair here is a compile error, so no status can reach a card with no badge. */
const STATUS_COLORS: Record<HomeworkStatus, { soft: string; color: string }> = {
  Assigned: { soft: "var(--card-2)", color: "var(--muted)" },
  Completed: { soft: "var(--green-soft)", color: "var(--green)" },
  Late: { soft: "var(--amber-soft)", color: "var(--amber)" },
  Missing: { soft: "var(--accent-soft)", color: "var(--accent)" },
};

/** The card's status pill, in the comp's badge geometry. */
export function homeworkBadgeStyle(status: HomeworkStatus): React.CSSProperties {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.Assigned;
  return {
    display: "inline-flex", alignItems: "center",
    fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
    background: c.soft, color: c.color, whiteSpace: "nowrap",
  };
}

/** The scope label, as a dictionary key — used by the card's pill and by the
 * drawer's selector, so the two say the same word for the same thing.
 *
 * RECOVERED, not chosen. The imported design's dictionary carries `Assign to`,
 * `Entire class` and `Individual student` as three consecutive entries beside
 * `Select a class`. That is this control's own vocabulary: the scope has exactly
 * two values, the drawer's subtitle is "Assign work to a class or a single
 * student", and these are the two phrases the design wrote for it. */
export const SCOPE_LABEL: Record<"class" | "student", string> = {
  class: "Entire class",
  student: "Individual student",
};

/** The scope field's own label, likewise from the design's dictionary. */
export const SCOPE_FIELD_LABEL = "Assign to";

/** The card surface — the comp's card, with its class-coloured left edge.
 *
 * `minWidth: 0` because this is a GRID ITEM, and a grid item defaults to
 * `min-width: auto` — it refuses to shrink below its own content. Without it a
 * long title or assignee name would push the card wider than its track and give
 * the page horizontal overflow on a narrow screen. It changes nothing at any
 * width where the content already fits, so no desktop geometry moves. */
export function homeworkCardStyle(color: string): React.CSSProperties {
  return {
    minWidth: 0,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${color}`,
    borderRadius: "var(--r)",
    boxShadow: "var(--sh)",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 11,
  };
}

/** One of the card's three 30px icon buttons. `danger` is the delete tint the
 * comp gives its own delete control on hover. */
export function cardActionStyle(): React.CSSProperties {
  return {
    minWidth: 30, width: 30, height: 30,
    border: "1px solid var(--border)", borderRadius: 8,
    background: "var(--card)", color: "var(--muted)",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  };
}
