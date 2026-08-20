"use client";

/* AppShell — the authenticated frame (sidebar + header + scrolling content),
 * ported from the design comp's "APP SHELL" section. Holds the sidebar
 * collapsed state and the logout flow; nav badge counts come from the API. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MOBILE_QUERY, useMediaQuery } from "@/lib/use-media-query";

async function fetchCounts(): Promise<{ students: number; classes: number }> {
  const res = await fetch("/api/meta/counts");
  if (!res.ok) throw new Error("counts");
  return res.json();
}

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const router = useRouter();

  /* THE TOGGLE MEANS TWO DIFFERENT THINGS, because the sidebar is two different
   * things. On a desktop it is part of the layout and the button narrows it to a
   * rail. Below the mobile breakpoint the stylesheet takes it out of flow
   * entirely — a 248px overlay over the page — because a permanent rail would
   * spend a fifth of a phone's width on navigation and leave the content in a
   * column too narrow for the design's own cards. There the button opens and
   * closes that overlay instead. */
  const isMobile = useMediaQuery(MOBILE_QUERY);

  /* The overlay is only ever open ON a phone. Anding the flag with the
   * breakpoint here — rather than clearing it in an effect when the viewport
   * changes — means a stale open flag can never reach the DOM: widen the window and
   * the scrim and the open state both simply stop being true, in the same render
   * that the sidebar rejoins the layout. */
  const navShown = isMobile && navOpen;

  const { data: counts } = useQuery({ queryKey: ["meta", "counts"], queryFn: fetchCounts });

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={navShown}
        // Navigating is the end of the errand the nav was opened for, so the tap
        // that navigates is also the one that closes it — no second dismissal.
        onNavigate={() => setNavOpen(false)}
        counts={{ students: counts?.students ?? 0, classes: counts?.classes ?? 0 }}
        onLogout={onLogout}
      />

      {/* The overlay's scrim. Rendered only while the nav is actually open on a
        * phone, so it can never sit invisibly over a desktop page. */}
      {navShown && (
        <div
          className="app-nav-scrim"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header onToggleSidebar={() => (isMobile ? setNavOpen((o) => !o) : setCollapsed((c) => !c))} user={user} />
        <main className="app-main" style={{ flex: 1, width: "100%", maxWidth: 1400, margin: "0 auto", padding: "28px 32px 48px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
