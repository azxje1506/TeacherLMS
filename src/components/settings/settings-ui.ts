/* Shared Settings presentation helpers.
 *
 * The imported design computes every Settings control's style at runtime — the
 * comp's markup carries `{{ o.style }}` and `{{ o.swStyle }}`, not the resolved
 * declarations — so the segment's two states are reproduced here once, in the
 * comp's own pill language and using the comp's own semantic tokens. This is
 * exactly what `attendance-ui.ts` does for the register's status segments and
 * `reviews-ui.ts` does for the rating scale; the geometry below is not invented,
 * it is the Settings card's OWN control, measured off the one button the comp
 * does spell out in full (its "Mark all read": height 34, padding 0 13, radius 9,
 * `--border` on `--card`, 13px/500).
 *
 * The LABELS are total Records keyed by the union rather than by `string`, so a
 * value added to `Appearance` or `RegionalConfig` without a label here is a
 * compile error rather than a blank button — the same reason `ATTENDANCE_COLORS`
 * is a total Record. Together with the ordered arrays in lib/constants they pin
 * the option set from both directions.
 */

import type { Appearance, RegionalConfig } from "@/lib/types";

/** Which container the segment sits in.
 *
 * `wide` is the comp's own control, unchanged. `dense` is the same control with
 * its type and padding stepped down one notch, and it exists because of
 * arithmetic rather than taste: the regional block is a two-column grid capped
 * at 560px, so a column is 271px, and three `DD/MM/YYYY` segments at the wide
 * padding need about 288px. The wide control would overflow its own group on a
 * DESKTOP, before any responsive question is asked. Surface and Density sit in
 * the 520px grid and are just as tight — `Elevated` is the longest word in
 * either. So the four regional groups and those two use `dense`; Theme (260px
 * for two) and Interface language (320px for two) have the room and do not. */
export type SettingsSegmentVariant = "wide" | "dense";

/** One segment of a Settings choice.
 *
 * Selected reads as the app's existing "on" pill — `--accent-soft` behind
 * `--accent`, the same treatment the active nav row and the register's Absent
 * segment already use — so a chosen setting looks chosen in whichever accent the
 * teacher is currently running. Unselected is the neutral `--card` control every
 * other inactive pill in the app uses. No literal colour is introduced: both
 * states are tokens that already respond to theme and accent. */
export function settingsSegmentStyle(
  active: boolean,
  variant: SettingsSegmentVariant = "wide"
): React.CSSProperties {
  const dense = variant === "dense";
  return {
    /* `1 1 auto`, NOT `1 1 0`, and `min-width:max-content` rather than 0 — the
     * two halves of one decision. `.set-seg-row` wraps, and a flex item whose
     * basis is zero has a hypothetical size of zero, so it never triggers a wrap
     * and the label spills out of its own button instead. Sizing from the
     * content means the row knows when an option no longer fits and moves it to
     * the next line, and it means no segment is ever drawn narrower than the
     * text inside it. Segments still share the slack equally, so a roomy row
     * still reads as one evenly-divided control. */
    flex: "1 1 auto", minWidth: "max-content",
    height: 34, padding: dense ? "0 8px" : "0 13px", borderRadius: 9,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--card)",
    color: active ? "var(--accent)" : "var(--muted)",
    fontSize: dense ? 12.5 : 13, fontWeight: active ? 600 : 500, fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center",
    whiteSpace: "nowrap", cursor: "pointer", outline: "none",
  };
}

/** One accent swatch.
 *
 * The FILL is not here: it comes from `.set-sw[data-sw-accent]` in globals.css,
 * beside the palette it mirrors, because a swatch has to paint an accent that is
 * NOT the one currently bound to `--accent` and there is no token for "some
 * other palette's colour". The border is what says which one is chosen, and it
 * keeps a constant width in both states so picking one never nudges the grid. */
export function accentSwatchStyle(active: boolean): React.CSSProperties {
  return {
    /* `width:100%` and no minimum: the swatch takes whatever its grid track
     * gives it, so the track — which the stylesheet owns and collapses to two
     * across on a small phone — is the only thing deciding how wide it is. A
     * floor here would be a second opinion that could overflow the card. */
    width: "100%", height: 34, borderRadius: 9, padding: 0,
    border: `2px solid ${active ? "var(--fg)" : "var(--border)"}`,
    cursor: "pointer", display: "block", outline: "none",
  };
}

export const THEME_LABEL: Record<Appearance["theme"], string> = {
  light: "Light",
  dark: "Dark",
};

export const ACCENT_LABEL: Record<Appearance["accent"], string> = {
  crimson: "Crimson",
  indigo: "Indigo",
  emerald: "Emerald",
  slate: "Slate",
};

export const SURFACE_LABEL: Record<Appearance["surface"], string> = {
  soft: "Soft",
  flat: "Flat",
  elevated: "Elevated",
};

export const DENSITY_LABEL: Record<Appearance["spacing"], string> = {
  cozy: "Cozy",
  airy: "Airy",
  tight: "Tight",
};

export const TIME_FORMAT_LABEL: Record<RegionalConfig["timeFormat"], string> = {
  "12h": "12-hour",
  "24h": "24-hour",
};

/* Date formats and currencies are their own labels — `DD/MM/YYYY` and `VND` are
 * tokens rather than copy, so they are not put through the dictionary, for the
 * same reason the review trend's `6M` / `12M` are not. Number formats have no
 * label in the comp at all and are not given an invented one: the page renders a
 * SAMPLE produced by that option's own formatter, so what the button says is
 * what choosing it does. */

/** The sample a number-format segment is labelled with. Deliberately not a
 * literal: it is `1234.56` rendered by the very formatter the option selects, so
 * the label cannot drift from the behaviour it advertises. */
export const NUMBER_FORMAT_SAMPLE = 1234.56;
