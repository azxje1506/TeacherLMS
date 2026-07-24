"use client";

/* Header — ported from the design comp (header.app-header). Sidebar toggle,
 * command-search trigger, quick add, theme toggle, notifications and the user
 * chip. Theme + sidebar toggles are wired; search / quick-add / notifications
 * are visual triggers to be deepened by their modules. */

import { useSettings } from "@/lib/settings-context";
import { IconSidebar, IconSearch, IconPlus, IconSun, IconMoon, IconBell } from "@/components/icons";

const iconBtn: React.CSSProperties = {
  minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function Header({ onToggleSidebar, user }: { onToggleSidebar: () => void; user: { name: string } }) {
  const { t, appearance, setAppearance } = useSettings();
  const isDark = appearance.theme === "dark";

  return (
    <header
      className="app-header"
      style={{
        height: 60, borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb,var(--bg) 82%,transparent)", backdropFilter: "blur(10px)",
        position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
      }}
    >
      <button onClick={onToggleSidebar} title={t("Toggle sidebar")} className="btn-ghost" style={{ ...iconBtn, minWidth: 34, width: 34, height: 34 }}>
        <IconSidebar size={17} />
      </button>

      <div style={{ position: "relative", flex: 1, minWidth: 170, maxWidth: 420 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)", display: "flex" }}><IconSearch size={16} /></span>
        <input
          aria-label={t("Search students, classes and lessons")}
          readOnly
          placeholder={t("Search…")}
          className="ring"
          style={{ width: "100%", height: 38, padding: "0 46px 0 36px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontFamily: "inherit", outline: "none", cursor: "pointer", textAlign: "left" }}
        />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--font-mono-stack)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 5px" }}>⌘K</span>
      </div>

      <div style={{ flex: 1 }} />

      <button className="btn-primary" style={{ height: 38, padding: "0 14px", border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", flexShrink: 0 }}>
        <IconPlus size={16} />{t("Quick add")}
      </button>

      <button onClick={() => setAppearance({ theme: isDark ? "light" : "dark" })} title={t("Toggle theme")} className="btn-ghost" style={iconBtn}>
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>

      <div style={{ position: "relative" }}>
        <button title={t("Notifications")} className="btn-ghost" style={{ ...iconBtn, position: "relative" }}>
          <IconBell size={17} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 12, borderLeft: "1px solid var(--border)", marginLeft: 2 }}>
        <div style={{ minWidth: 34, width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--sky))", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13 }}>{initials(user.name)}</div>
        <div className="hdr-user-meta" style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Teacher · Admin</div>
        </div>
      </div>
    </header>
  );
}
