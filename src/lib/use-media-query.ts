"use client";

/* A media query as React state.
 *
 * WHY THIS EXISTS. Almost every responsive rule in this app is CSS — the design
 * is inline styles for the desktop comp plus a `@media` layer in globals.css
 * that overrides them, and that arrangement is deliberate: it keeps the ported
 * desktop values as the visual source of truth and never asks JavaScript what
 * the layout looks like.
 *
 * The mobile navigation is the one thing CSS cannot express on its own. Below
 * the mobile breakpoint the sidebar leaves the layout entirely and becomes an
 * overlay, so the header's toggle has to mean something different than it does
 * on a desktop — "open the nav over the page" rather than "narrow the rail".
 * That is a behaviour change, not a style change, so it needs state.
 *
 * SSR-SAFE. The server has no viewport, so the first render is always `false`
 * and the desktop layout is what gets sent — matching the CSS, whose desktop
 * rules are the ones outside any `@media` block. The subscription corrects it on
 * mount, before paint (`useSyncExternalStore`), so there is no flash of the
 * wrong nav and no hydration mismatch.
 *
 * `useSyncExternalStore` rather than useState + useEffect: it is the API built
 * for exactly this — an external, mutable source read during render — and it
 * gets the server snapshot right by construction. */

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // The server renders the desktop layout, which is what the CSS does too.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The one breakpoint the shell changes shape at, stated once so the hook and
 * the stylesheet cannot drift apart. Mirrors `@media (max-width:620px)` in
 * globals.css — the project's existing narrow breakpoint, already used there to
 * collapse the header and the dashboard grids. */
export const MOBILE_QUERY = "(max-width: 620px)";
