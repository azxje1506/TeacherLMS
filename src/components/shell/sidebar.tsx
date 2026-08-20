"use client";

/* Sidebar — ported from the design comp (aside.app-sidebar). Nav items, section
 * labels, count badges and the logout row match the design; active state and
 * routing are wired with next/navigation. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  IconDashboard, IconStudents, IconParents, IconClasses, IconLessons, IconAttendance,
  IconHomework, IconReviews, IconFinance, IconReports, IconCalendar, IconSettings, IconLogout,
} from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  Icon: (p: { size?: number }) => React.ReactElement;
  badge?: number;
}

export function Sidebar({
  collapsed, mobileOpen = false, onNavigate, counts, onLogout,
}: {
  collapsed: boolean;
  /** Below the mobile breakpoint the sidebar leaves the layout entirely and
   * slides over the page instead; this is whether it is currently slid in.
   * Ignored on desktop, where the stylesheet never takes it out of flow. */
  mobileOpen?: boolean;
  /** Called when a nav row is chosen, so the mobile overlay can close itself.
   * Absent on desktop, where the sidebar is part of the page and never covers
   * what the teacher is about to look at. */
  onNavigate?: () => void;
  counts: { students: number; classes: number };
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const { t } = useSettings();

  const main: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
    { href: "/students", label: "Students", Icon: IconStudents, badge: counts.students },
    { href: "/parents", label: "Parents", Icon: IconParents },
    { href: "/classes", label: "Classes", Icon: IconClasses, badge: counts.classes },
    { href: "/lessons", label: "Lessons", Icon: IconLessons },
    { href: "/attendance", label: "Attendance", Icon: IconAttendance },
    { href: "/homework", label: "Homework", Icon: IconHomework },
    { href: "/reviews", label: "Reviews", Icon: IconReviews },
  ];
  const insights: NavItem[] = [
    { href: "/finance", label: "Finance", Icon: IconFinance },
    { href: "/reports", label: "Reports", Icon: IconReports },
    { href: "/calendar", label: "Calendar", Icon: IconCalendar },
    { href: "/settings", label: "Settings", Icon: IconSettings },
  ];

  const sbw = collapsed ? 64 : 248;
  const hideCollapsed: React.CSSProperties = collapsed ? { display: "none" } : {};

  const sectionLabel = (text: string) => (
    <div style={{ ...hideCollapsed, fontSize: 11, fontWeight: 600, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em", padding: "8px 10px 6px" }}>{t(text)}</div>
  );

  const renderItem = ({ href, label, Icon, badge }: NavItem) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      // `asChild` puts the trigger's behaviour on the Link itself, so the row
      // keeps its own full-width layout — no wrapper element in between. The
      // label is translated here: the native `title` this replaced was showing
      // the raw English key while the row itself read Vietnamese.
      <Tooltip key={href}>
        <TooltipTrigger asChild>
          <Link
            href={href}
            onClick={onNavigate}
            style={{
              display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 10px",
              border: "none", borderRadius: 9, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer", marginBottom: 2,
              textDecoration: "none", justifyContent: collapsed ? "center" : "flex-start",
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--muted)",
              fontWeight: active ? 600 : 500,
            }}
            className="nav-item"
          >
            <span style={{ minWidth: 18, display: "flex" }}><Icon size={18} /></span>
            <span style={{ ...hideCollapsed, flex: 1, whiteSpace: "nowrap", overflow: "hidden" }}>{t(label)}</span>
            {badge != null && (
              <span style={{ ...hideCollapsed, fontSize: 11, fontWeight: 600, background: "var(--accent-soft)", color: "var(--accent)", padding: "1px 7px", borderRadius: 99 }}>{badge}</span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{t(label)}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <aside
      className="app-sidebar"
      data-mobile-open={mobileOpen ? "1" : "0"}
      style={{
        width: sbw, minWidth: sbw, background: "var(--sidebar)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh",
        overflow: "hidden", transition: "width .18s ease",
      }}
    >
      <div style={{ height: 60, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 30, width: 30, height: 30, borderRadius: 8, background: "var(--primary)", color: "var(--primary-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>E</div>
        <span className="sb-label" style={{ ...hideCollapsed, fontWeight: 600, fontSize: 14.5, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden" }}>English Tutor</span>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 12px 8px" }}>
        {sectionLabel("Main")}
        {main.map(renderItem)}
        {sectionLabel("Insights")}
        {insights.map(renderItem)}
      </nav>

      <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
        <button
          onClick={onLogout}
          className="btn-ghost"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 10px", border: "none", background: "transparent", color: "var(--muted)", borderRadius: 9, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer", justifyContent: collapsed ? "center" : "flex-start" }}
        >
          <span style={{ minWidth: 18, display: "flex" }}><IconLogout size={18} /></span>
          <span style={hideCollapsed}>{t("Log out")}</span>
        </button>
      </div>
    </aside>
  );
}
