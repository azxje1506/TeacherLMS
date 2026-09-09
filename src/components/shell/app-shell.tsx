"use client";

/* AppShell — the authenticated frame (sidebar + header + scrolling content),
 * ported from the design comp's "APP SHELL" section. Holds the sidebar
 * collapsed state and the logout flow; nav badge counts come from the API. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useSettings } from "@/lib/settings-context";
import { MOBILE_QUERY, TABLET_QUERY, useMediaQuery } from "@/lib/use-media-query";

async function fetchCounts(): Promise<{ students: number; classes: number }> {
  const res = await fetch("/api/meta/counts");
  if (!res.ok) throw new Error("counts");
  return res.json();
}

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  /* THE COLLAPSE PREFERENCE, AND WHAT `null` MEANS.
   *
   * `null` is "follow this width's default" — expanded on a desktop, an icon
   * rail on a tablet, where a 248px panel would take a third of the screen.
   * `true`/`false` is the teacher having said otherwise, and it outranks the
   * default at every width.
   *
   * ONE PREFERENCE, NOT A THIRD STATE. The sidebar still has exactly two
   * presentations; the breakpoint only supplies the starting one. Before this,
   * `collapsed` began `false` everywhere and the tablet stylesheet pinned the
   * rail with `!important` — so at 768px the toggle flipped a flag that nothing
   * could act on, and the button was a no-op the human pass reported. */
  const [collapsePref, setCollapsePref] = useState<boolean | null>(null);
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

  /* AND THE COLLAPSED FLAG IS ANDED THE OTHER WAY, for the same reason.
   *
   * `collapsed` is a statement about the DESKTOP rail — "narrow it to icons" —
   * and below the breakpoint there is no rail to narrow: the stylesheet has
   * already taken the sidebar out of flow and made it a 248px overlay that is
   * full-labelled "because there is room for labels again". But the component
   * expresses collapsed as INLINE `display:none` on every label, badge and
   * section heading, and an inline style beats a media query — so a teacher who
   * collapsed the rail at a wider width and then narrowed the window opened the
   * overlay to find a 248px panel containing nothing but centred icons.
   *
   * Anding it here is the same fix the line above makes, in the same file, for
   * the same class of bug: a flag that means one thing on a desktop must not
   * reach the DOM at a width where it means nothing. */
  const isTablet = useMediaQuery(TABLET_QUERY);
  const railCollapsed = !isMobile && (collapsePref ?? isTablet);

  /* WHAT THE STYLESHEET NEEDS TO KNOW, AND WHY IT IS THIS AND NOT `collapsed`.
   *
   * The tablet rail is the DEFAULT there, so the stylesheet states it — and the
   * server sends that stylesheet, which is what keeps a tablet from painting a
   * 248px sidebar for one frame before hydration tells it the width. The one
   * thing CSS cannot know is that the teacher has since asked for the panel, so
   * that — and only that — is published here. `null` and `true` both leave the
   * default in charge, which is why this is an equality test and not `!`. */
  const railExpanded = collapsePref === false;

  /* Escape closes the nav, the third of the drawer's three dismissals and the
   * same listener `ui/drawer.tsx` uses. Bound only while the nav is actually
   * open, so no key handler outlives the overlay. */
  useEffect(() => {
    if (!navShown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navShown]);

  const { data: counts } = useQuery({ queryKey: ["meta", "counts"], queryFn: fetchCounts });

  /* WHETHER THE WORKSPACE MAY BE SHOWN YET (Gate 6.3, finding A).
   *
   * THE DEFECT. The interface language is not CSS. `ThemeScript` can settle the
   * appearance before first paint because appearance IS css variables on <html>,
   * but the language is the TEXT of every page, chosen while the server renders
   * — and the server cannot read `localStorage`. So with English persisted the
   * server still ships Vietnamese, the browser paints it, and React swaps it a
   * render later. Nothing consulted during hydration can un-paint that.
   *
   * WHY IT IS HERE AND NOT ON A PAGE. Gate 6.2 hid the Settings screen until the
   * store was readable, which fixed /settings and nothing else: the sidebar, the
   * header, page headings, descriptions, inputs and tabs are all outside that
   * page and all of them still flashed. This is the smallest boundary that
   * contains every one of them — `(app)/layout.tsx` renders exactly this
   * component for every authenticated route, and nothing else does.
   *
   * WHAT REACHES THE DOM. An attribute, because the SERVER has to emit it: a
   * value only React consults is a value that arrives too late. `hydrated` is
   * false on the server AND for the hydrating render, so both produce `"0"` and
   * the markup matches; it flips to `"1"` in the same commit that brings the
   * stored language, and the stylesheet reveals the whole workspace at once,
   * already correct. See [data-workspace-ready] in globals.css for why that is
   * `visibility:hidden` rather than an unmount or a spinner.
   *
   * NO SECOND SOURCE. This is read out of the shared store like every other
   * preference in the app — no `localStorage` call here, in the Header or in the
   * Sidebar, and no `useState` mirror of the language anywhere. */
  const { hydrated } = useSettings();

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div data-workspace-ready={hydrated ? "1" : "0"} style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar
        collapsed={railCollapsed}
        railExpanded={railExpanded}
        mobileOpen={navShown}
        // Navigating is the end of the errand the nav was opened for, so the tap
        // that navigates is also the one that closes it — no second dismissal.
        onNavigate={() => setNavOpen(false)}
        // The drawer's own dismissal, so closing it never depends on finding the
        // scrim. Ignored above the mobile breakpoint, where the control is not drawn.
        onCloseNav={() => setNavOpen(false)}
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
        <Header
          /* One control, two meanings, and at every width it now changes
           * something: open/close the drawer on a phone, and everywhere else
           * settle the preference AGAINST WHAT IS CURRENTLY SHOWN — which is
           * what makes the first press work at tablet, where the shown state is
           * the breakpoint default rather than anything in state. */
          onToggleSidebar={() => (isMobile ? setNavOpen((o) => !o) : setCollapsePref(!railCollapsed))}
          navExpanded={isMobile ? navShown : !railCollapsed}
          user={user}
        />
        <main className="app-main" style={{ flex: 1, width: "100%", maxWidth: 1400, margin: "0 auto", padding: "28px 32px 48px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
