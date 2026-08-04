"use client";

/* Calendar drag engine — the pointer-driven half of "drag a lesson onto another
 * day", extracted from the Calendar screen so the screen stays a layout.
 *
 * WHY NOT HTML5 DRAG-AND-DROP (what this replaces): the native API hands the
 * browser a bitmap of the source node and owns it from there. It cannot scale or
 * fade the thing being dragged, cannot draw a placeholder in the destination,
 * cannot refuse a drop with a reason the user can read, cannot auto-scroll a
 * calendar that is taller than the viewport, and its drop feedback is a cursor
 * badge. Every one of those is a requirement here, so the drag is driven from
 * pointer events instead and the "ghost" is an ordinary element this hook moves.
 * No drag-and-drop library is introduced (see PROJECT_RULES: no new deps).
 *
 * Pointer-based drag is MOUSE/PEN ONLY, by design: claiming touch would mean
 * taking `touch-action` away from the calendar and breaking scrolling on a phone
 * for a gesture that native HTML5 drag never delivered there either. Tapping a
 * lesson to open its drawer is unchanged on touch.
 *
 * The hook owns no lesson data. Which drops are legal (`blockedFor`) and what a
 * drop does (`onDrop`) are the screen's business; this file only knows pixels.
 *
 * RE-RENDERS: the pointer position never enters React state. A single rAF loop
 * writes the ghost's transform directly and re-reads the cell under the pointer;
 * state changes only when the destination cell (or the drag phase) actually
 * changes, so sweeping across a cell costs one render, not one per frame. */

import { useCallback, useEffect, useRef, useState } from "react";

/** Travel before a press becomes a drag — below this it is still a click. */
const DRAG_THRESHOLD = 5;

/* Auto-scroll ramp. Within EDGE px of an edge the speed eases in from a crawl
 * to MAX_SCROLL, so brushing the boundary barely moves the page and pressing
 * right into it moves fast — the Google Calendar feel, where how far you push
 * controls how quickly you travel.
 *
 * The ease is quadratic (depth²): linear ramps spend most of their range at a
 * speed that is already too fast to aim with.
 *
 * Speeds are px per SECOND and multiplied by the frame delta, so the calendar
 * scrolls at the same rate on a 60Hz and a 144Hz display. A per-frame constant
 * — which is what this replaced — is 2.4× faster on the latter. */
const EDGE = 90;
const MIN_SCROLL = 60; // px/s on first entering the zone
const MAX_SCROLL = 1500; // px/s at the edge itself (and beyond it)
/** Longest frame delta honoured, so a backgrounded tab cannot resume with one
 * enormous jump. */
const MAX_FRAME_MS = 64;
/** Ghost settle (successful drop) and bounce-back (refused drop) durations. */
export const DROP_MS = 240;
export const BOUNCE_MS = 260;

/** Is dragging offered at all on this device?
 *
 * Drag is a desktop affordance. On a phone or tablet the calendar is tap-to-open
 * and nothing else: a drag there would have to claim `touch-action`, which is
 * the same gesture the browser uses to scroll the page, so the cost of offering
 * it is a calendar you cannot scroll.
 *
 * Two independent gates, because either alone lets a case through: the pointer
 * type rejects a finger on a hybrid laptop (where the media query matches), and
 * the media query rejects a device whose browser reports touch input as "mouse"
 * (which some mobile browsers and remote-desktop clients do). */
function dragAvailable(pointerType: string): boolean {
  if (pointerType !== "mouse" && pointerType !== "pen") return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Attribute a day cell carries so the hook can find it under the pointer. */
export const DROP_ATTR = "data-drop-date";
/** Attribute an element carries when it is a horizontal calendar scroller. */
export const SCROLLER_ATTR = "data-cal-scroll";

type Phase = "drag" | "drop" | "cancel";

interface Ghost {
  id: string;
  phase: Phase;
  /** Source card geometry, so the ghost matches it and can bounce home. */
  width: number;
  height: number;
}

export interface CalendarDrag {
  /** The lesson currently under the pointer's control (null once released). */
  draggingId: string | null;
  /** The ISO date the pointer is over, while dragging. */
  overDate: string | null;
  /** Why the current destination refuses the drop, or null when it accepts. */
  blocked: string | null;
  /** The ghost to render, or null when nothing is in flight. */
  ghost: Ghost | null;
  /** Attach to the ghost element — the hook positions it directly. */
  ghostRef: React.RefObject<HTMLDivElement | null>;
  /** The lesson that has just landed, and where — so ONLY its card in the new
   * cell animates in. Without the date, the card still sitting in the old cell
   * (the refetch has not arrived yet) would play the arrival too. */
  landed: { id: string; date: string } | null;
  /** onPointerDown for an event card. */
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** True between drag start and the click that follows it — lets a card ignore
   * the click the browser fires after a drag finishes on the same element. */
  suppressClick: () => boolean;
}

export function useCalendarDrag({
  onDrop,
  blockedFor,
}: {
  onDrop: (id: string, date: string) => void;
  /** A message explaining why `id` may not land on `date`, or null when it may. */
  blockedFor: (id: string, date: string) => string | null;
}): CalendarDrag {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ id: string; date: string } | null>(null);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** Live pointer position + the grab offset inside the card. */
  const posRef = useRef({ x: 0, y: 0, dx: 0, dy: 0 });
  /** Where the drag started from, for the bounce-back, plus the card itself so
   * the bounce can re-measure: auto-scrolling moves that card under the pointer,
   * and the position captured at drag start would send the ghost off to where
   * the card used to be. */
  const homeRef = useRef({ x: 0, y: 0 });
  const sourceRef = useRef<HTMLElement | null>(null);
  /** The press that may become a drag. */
  const pressRef = useRef<{ id: string; x: number; y: number; node: HTMLElement } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const draggedRef = useRef(false);

  // The screen's callbacks are read through refs so the window listeners below
  // are installed once per drag and never re-installed mid-gesture.
  const onDropRef = useRef(onDrop);
  const blockedForRef = useRef(blockedFor);
  useEffect(() => { onDropRef.current = onDrop; blockedForRef.current = blockedFor; });

  /** Move the ghost to the live pointer position (no React involved). The ghost
   * mounts hidden and is revealed by its first paint, so it never flashes at the
   * top-left corner in the frame between React rendering it and this positioning
   * it. */
  const paint = useCallback(() => {
    const el = ghostRef.current;
    if (!el) return;
    const { x, y, dx, dy } = posRef.current;
    el.style.transform = `translate3d(${x - dx}px, ${y - dy}px, 0) scale(1.03)`;
    el.style.visibility = "visible";
  }, []);

  /** Scroll the page (and the week view's own scroller) when the pointer nears
   * an edge, so a lesson can be dragged to a day that is not currently visible. */
  const autoScroll = useCallback((x: number, y: number, under: HTMLElement | null, dt: number) => {
    /** `over` is how far INTO the edge zone the pointer has reached, in px.
     * Returns the distance to travel this frame. */
    const step = (over: number) => {
      const depth = Math.min(1, Math.max(0, over / EDGE));
      return (MIN_SCROLL + (MAX_SCROLL - MIN_SCROLL) * depth * depth) * (dt / 1000);
    };

    // Vertical: the document is the scroll container (see AppShell — <main> is
    // not a scroll box, the page itself scrolls).
    const h = window.innerHeight;
    let dy = 0;
    if (y < EDGE) dy = -step(EDGE - y);
    else if (y > h - EDGE) dy = step(y - (h - EDGE));
    if (dy !== 0) window.scrollBy(0, dy);

    // Horizontal: the week view's column strip, only while the pointer is in it.
    const scroller = under?.closest?.(`[${SCROLLER_ATTR}]`) as HTMLElement | null;
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const r = scroller.getBoundingClientRect();
      let dx = 0;
      if (x < r.left + EDGE) dx = -step(r.left + EDGE - x);
      else if (x > r.right - EDGE) dx = step(x - (r.right - EDGE));
      if (dx !== 0) scroller.scrollLeft += dx;
    }
  }, []);

  /** One frame: paint the ghost, auto-scroll, and re-read the cell underneath.
   * The cell is re-read every frame rather than on pointermove because auto-
   * scrolling changes what is under a pointer that has not moved at all. */
  const tick = useCallback((ts: number) => {
    const id = draggingRef.current;
    if (!id) return;

    // Frame delta, so auto-scroll travels at a rate rather than per frame.
    const last = lastTsRef.current;
    lastTsRef.current = ts;
    const dt = last === 0 ? 16 : Math.min(MAX_FRAME_MS, ts - last);

    paint();
    const { x, y } = posRef.current;
    // One hit-test per frame, shared by the auto-scroll and the drop target —
    // elementFromPoint forces layout, so it is not worth doing twice.
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    autoScroll(x, y, under, dt);

    const cell = under?.closest?.(`[${DROP_ATTR}]`) as HTMLElement | null;
    const date = cell?.getAttribute(DROP_ATTR) ?? null;
    if (date !== overRef.current) {
      overRef.current = date;
      setOverDate(date);
      setBlocked(date ? blockedForRef.current(id, date) : null);
    }
  }, [paint, autoScroll]);

  // The loop reads the tick through a ref so the rAF chain is set up once and
  // never has to be torn down and re-scheduled when a callback identity changes.
  const tickRef = useRef(tick);
  useEffect(() => { tickRef.current = tick; }, [tick]);

  const startFrames = useCallback(() => {
    lastTsRef.current = 0; // first frame of a new drag has no previous delta
    const loop = (ts: number) => {
      tickRef.current(ts);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopFrames = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  /** End the gesture: settle onto the destination, or bounce back home. */
  const finish = useCallback((commit: boolean) => {
    const id = draggingRef.current;
    const date = overRef.current;
    // Re-ask rather than reading the `blocked` state: that state is written from
    // the rAF loop, and a release in the same frame as entering a cell could
    // otherwise commit a drop the preview had already refused.
    const refused = id !== null && date !== null && blockedForRef.current(id, date) !== null;
    draggingRef.current = null;
    overRef.current = null;
    stopFrames();
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    if (!id) { setGhost(null); setOverDate(null); setBlocked(null); return; }

    const landing = commit && date !== null && !refused;
    const el = ghostRef.current;
    if (el) {
      if (landing) {
        // Slide the ghost onto the destination cell so the lesson reads as
        // MOVING there, rather than blinking out and reappearing after the
        // refetch. The refetched card then fades in underneath it.
        // The value is an ISO date, so it needs no escaping inside the quotes.
        const cell = document.querySelector(`[${DROP_ATTR}="${date}"]`) as HTMLElement | null;
        const r = cell?.getBoundingClientRect();
        el.style.transition = `transform ${DROP_MS}ms cubic-bezier(.32,.72,0,1), opacity ${DROP_MS}ms ease`;
        if (r) el.style.transform = `translate3d(${r.left + 6}px, ${r.top + 28}px, 0) scale(1)`;
        el.style.opacity = "0";
      } else {
        // Measured now, not at drag start: auto-scroll may have carried the
        // source card somewhere else on screen since.
        const src = sourceRef.current?.getBoundingClientRect();
        const home = src ? { x: src.left, y: src.top } : homeRef.current;
        el.style.transition = `transform ${BOUNCE_MS}ms cubic-bezier(.34,1.4,.64,1), opacity ${BOUNCE_MS}ms ease`;
        el.style.transform = `translate3d(${home.x}px, ${home.y}px, 0) scale(1)`;
        el.style.opacity = "0";
      }
    }
    sourceRef.current = null;

    setGhost((g) => (g ? { ...g, phase: landing ? "drop" : "cancel" } : null));
    setOverDate(null);
    setBlocked(null);
    window.setTimeout(() => setGhost(null), landing ? DROP_MS : BOUNCE_MS);

    if (landing) {
      setLanded({ id, date });
      onDropRef.current(id, date);
    }
  }, [stopFrames]);

  // Window-level listeners live for the whole press, so a drag survives the
  // pointer leaving the card it started on (which is the normal case).
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const press = pressRef.current;
      if (!press) return;

      if (!draggingRef.current) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
        // Threshold crossed — promote the press to a drag.
        const r = press.node.getBoundingClientRect();
        posRef.current = { x: e.clientX, y: e.clientY, dx: press.x - r.left, dy: press.y - r.top };
        homeRef.current = { x: r.left, y: r.top };
        sourceRef.current = press.node;
        draggingRef.current = press.id;
        draggedRef.current = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        setGhost({ id: press.id, phase: "drag", width: r.width, height: r.height });
        startFrames();
        return;
      }
      posRef.current.x = e.clientX;
      posRef.current.y = e.clientY;
    }

    function onUp() {
      if (draggingRef.current) finish(true);
      pressRef.current = null;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && draggingRef.current) { finish(false); pressRef.current = null; }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [startFrames, finish]);

  // Stop the loop if the screen unmounts mid-drag.
  useEffect(() => () => {
    stopFrames();
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, [stopFrames]);

  // The landed marker is a one-shot: it exists only long enough for the newly
  // placed card to play its entry animation once.
  useEffect(() => {
    if (!landed) return;
    const t = window.setTimeout(() => setLanded(null), 1200);
    return () => window.clearTimeout(t);
  }, [landed]);

  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    // No press is even recorded on a device without drag, so a card there is an
    // ordinary button: tap opens the drawer and nothing else can happen.
    if (e.button !== 0 || !dragAvailable(e.pointerType)) return;
    pressRef.current = { id, x: e.clientX, y: e.clientY, node: e.currentTarget as HTMLElement };
    draggedRef.current = false;
  }, []);

  /** True when the click now arriving is the tail of a drag, not a click. */
  const suppressClick = useCallback(() => {
    const dragged = draggedRef.current;
    draggedRef.current = false;
    return dragged;
  }, []);

  return {
    draggingId: ghost?.phase === "drag" ? ghost.id : null,
    overDate,
    blocked,
    ghost,
    ghostRef,
    landed,
    onPointerDown,
    suppressClick,
  };
}
