"use client";

/* Background scroll lock for modal overlays.
 *
 * Setting `overflow:hidden` on <body> removes the document scrollbar, which
 * widens the layout by the scrollbar's width (10px here — see the
 * ::-webkit-scrollbar rule in globals.css). Everything right-aligned or centred
 * then jumps sideways for as long as the overlay is open.
 *
 * Measuring the gutter that the lock is about to reclaim and adding it back as
 * padding-right keeps the content box exactly the width it was, so the sidebar,
 * header and page content stay put. Fixed-position overlays are positioned
 * against the viewport and are unaffected by the padding, so the scrim and the
 * drawer still reach the true right edge.
 *
 * Nesting is safe: a second lock measures a gutter of 0, adds nothing, and each
 * unmount restores the exact values it captured.
 */

import { useEffect } from "react";

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    body.style.overflow = "hidden";
    if (gutter > 0) {
      const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + gutter}px`;
    }

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [active]);
}
