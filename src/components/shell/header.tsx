"use client";

/* Header — ported from the design comp (header.app-header). Sidebar toggle,
 * search trigger, quick add, theme toggle, notifications and the user chip.
 *
 * THREE SHAPES, ONE ROW (Sprint 8 Gate 4.3 header remediation).
 *
 *   >= 1100px  the full row: the search FIELD with its ⌘K hint, Quick add with
 *              its label, and the user's name and role beside the avatar.
 *   768-1099px the field becomes a search BUTTON, and the name and role go. A
 *              tablet has room for the actions but not for a 420px field beside
 *              them and a sidebar still in the layout.
 *   < 768px    Quick add drops to its icon. Everything left is a 38px control.
 *
 * WHY THE FIELD IS REPLACED RATHER THAN SHRUNK. A search input narrow enough to
 * fit a tablet row is a box you cannot read your own query in — it is the
 * compressed, unusable field the human verification reported. The header's job
 * is to TRIGGER search; performing it belongs to the surface that opens. So
 * below 1100px the trigger takes the form every other action in this row already
 * has, and no fake input survives.
 *
 * BOTH SHAPES ARE IN THE DOM AND CSS PICKS ONE. `display:none` removes an
 * element from the accessibility tree as well as the layout, so exactly one
 * search trigger is ever announced — and there is no layout state in JS to
 * disagree with the stylesheet, and nothing to mismatch on hydration.
 *
 * THE HEADER'S BREAKPOINTS ARE ITS OWN. They are 1100px and 768px; the drawer
 * and the sidebar keep 620px. Header rules used to live in the 620px block,
 * which is why the row changed shape at exactly the width the drawer did and
 * snapped back to a desktop layout at 621px with a sidebar rail beside it.
 * Nothing in this component's stylesheet mentions 620 any more.
 *
 * SEARCH IS ONE FUNCTION. The field, the button and ⌘K all call `openSearch`
 * and nothing else, so the two visible triggers and the shortcut can never
 * diverge. What `openSearch` opens is the caller's to supply — see the prop. */

import { useCallback, useEffect } from "react";
import { useSettings } from "@/lib/settings-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconSidebar, IconSearch, IconPlus, IconSun, IconMoon, IconBell } from "@/components/icons";

const iconBtn: React.CSSProperties = {
  minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function Header({
  onToggleSidebar, navExpanded, onOpenSearch, user,
}: {
  onToggleSidebar: () => void;
  /** Is the thing this button controls currently showing? The rail expanded on a
   * desktop, the drawer open on a phone — one control, so one state. */
  navExpanded?: boolean;
  /** Open the application's search surface.
   *
   * NOT SUPPLIED YET, and deliberately so. This application has no global search
   * experience: the field this header has always drawn is `readOnly` with no
   * handler, there is no search endpoint, and the imported design comp carries
   * no palette markup — only the dictionary inherited from the design library
   * mentions one. Building that surface is a feature, not a header fix, and
   * PROJECT_RULES is explicit that a UI element the design does not contain is
   * not invented.
   *
   * So this is the seam and not the feature. Every trigger in the row already
   * routes here, which means the day a search surface is authorised it is wired
   * in one place and the shortcut, the field and the button all reach it at
   * once. Until then the triggers are inert — exactly as the `readOnly` field
   * they replace has always been, at every width. */
  onOpenSearch?: () => void;
  user: { name: string };
}) {
  const { t, appearance, setAppearance } = useSettings();
  const isDark = appearance.theme === "dark";

  /** THE ONE TRIGGER. Three gestures reach search and this is all three of them. */
  const openSearch = useCallback(() => { onOpenSearch?.(); }, [onOpenSearch]);

  /* ⌘K / Ctrl+K — the shortcut the field's own hint advertises.
   *
   * Registered only when there is something to open. A shortcut that swallows
   * the browser's own ⌘K to do nothing is worse than no shortcut: the hint would
   * be a promise the app does not keep AND the platform's default would be gone.
   * With a handler present it opens the same surface the two buttons do. */
  useEffect(() => {
    if (!onOpenSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenSearch, openSearch]);

  return (
    <header
      className="app-header"
      style={{
        height: 60, borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb,var(--bg) 82%,transparent)", backdropFilter: "blur(10px)",
        position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={onToggleSidebar} aria-label={t("Toggle sidebar")} aria-expanded={navExpanded} className="btn-ghost" style={{ ...iconBtn, minWidth: 34, width: 34, height: 34 }}>
            <IconSidebar size={17} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("Toggle sidebar")}</TooltipContent>
      </Tooltip>

      {/* The full field. Desktop only — the stylesheet hides it below 1100px.
        *
        * NO WIDTH FLOOR. The header is one non-wrapping flex row, so its
        * intrinsic minimum IS the document's minimum width, and this box used to
        * declare `minWidth: 170`. `flex: 1` with `maxWidth: 420` already gives it
        * every pixel the row can spare, so nothing moves where it fits. */}
      <div className="hdr-search" style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: 420 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)", display: "flex" }}><IconSearch size={16} /></span>
        <input
          aria-label={t("Search students, classes and lessons")}
          readOnly
          onClick={openSearch}
          placeholder={t("Search…")}
          className="ring"
          style={{ width: "100%", height: 38, padding: "0 46px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none", cursor: "pointer", textAlign: "left" }}
        />
        <span className="hdr-kbd" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono-stack)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 5px" }}>⌘K</span>
      </div>

      {/* The same trigger, as a control. Shown only below 1100px, where a field
        * would have to be too narrow to read a query in. It takes the row's own
        * 38px action geometry rather than a size invented for it, and it carries
        * the field's own accessible name so the trigger is the same thing by
        * either shape. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openSearch}
            aria-label={t("Search students, classes and lessons")}
            className="btn-ghost hdr-search-btn"
            style={iconBtn}
          >
            <IconSearch size={17} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("Search…")}</TooltipContent>
      </Tooltip>

      {/* Pushes the action group to the trailing edge at every width. It is what
        * right-aligns the group once the field is gone, so unlike before it is
        * never hidden — a flex spacer with no basis costs nothing when the row
        * is tight. */}
      <div className="hdr-spacer" style={{ flex: 1 }} />

      <button className="btn-primary hdr-quickadd" aria-label={t("Quick add")} style={{ height: 38, padding: "0 14px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", flexShrink: 0 }}>
        <IconPlus size={16} /><span className="hdr-quickadd-label">{t("Quick add")}</span>
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={() => setAppearance({ theme: isDark ? "light" : "dark" })} aria-label={t("Toggle theme")} className="btn-ghost" style={iconBtn}>
            {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("Toggle theme")}</TooltipContent>
      </Tooltip>

      <div style={{ position: "relative" }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label={t("Notifications")} className="btn-ghost" style={{ ...iconBtn, position: "relative" }}>
              <IconBell size={17} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("Notifications")}</TooltipContent>
        </Tooltip>
      </div>

      {/* The avatar is the user chip at every width; the name and role are the
        * part a tablet cannot afford, so only they are hidden below 1100px. */}
      <div className="hdr-user" style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 12, borderLeft: "1px solid var(--border)", marginLeft: 2 }}>
        <div style={{ minWidth: 34, width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--sky))", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>{initials(user.name)}</div>
        <div className="hdr-user-meta" style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Teacher · Admin</div>
        </div>
      </div>
    </header>
  );
}
