"use client";

/* Tooltip — the official shadcn/ui (new-york) Tooltip, on @radix-ui/react-tooltip.
 * Replaces the hand-rolled tooltip this file used to hold: Radix owns the
 * positioning, collision flipping, portalling, focus/hover/dismiss behaviour and
 * the accessible description, so none of that is maintained here.
 *
 * Deliberate edits to the generated component:
 *
 *  - `Tooltip` does NOT wrap itself in a `TooltipProvider`. That is what the
 *    current generator emits, and it silently defeats `skipDelayDuration`: the
 *    "you just saw a tooltip, show the next one at once" grace period is state
 *    held BY a provider, so a provider per tooltip means every trigger is the
 *    first one you ever hovered. One shared provider lives at the app root
 *    (components/providers.tsx) and owns both timings — which is also how
 *    shadcn's own docs mount it.
 *  - the bubble is painted with this design's own tokens instead of
 *    `bg-primary text-primary-foreground`. `--primary` here is the brand red
 *    (#d42525) — a red tooltip is not what shadcn's default looks like in a
 *    neutral install. `--fg` on `--bg` gives the conventional inverted pill and
 *    stays correct in both themes. Motion reuses the comp's own `popIn`
 *    keyframe, so no animation library is pulled in for one component.
 *  - `sideOffset` is 6 rather than 0, so the arrow clears the trigger's border,
 *    and the bubble takes a max-width (see below).
 */

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/** Dwell before a tooltip opens — long enough that crossing a toolbar does not
 * strobe labels, short enough to feel immediate. */
export const TOOLTIP_DELAY_MS = 140;
/** Grace period after one closes during which the next opens instantly, so
 * sweeping along a row of icon buttons reads as one continuous label rather
 * than a series of waits (the Google Calendar feel). */
export const TOOLTIP_SKIP_DELAY_MS = 800;

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  skipDelayDuration = TOOLTIP_SKIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // max-w is added to shadcn's default: labels here can carry a class
          // name (the month-grid chip's tooltip), and w-fit alone would let one
          // long name stretch into a single very wide line.
          "z-[200] w-fit max-w-[320px] rounded-md px-2 py-1 text-xs font-medium text-balance",
          "bg-[var(--fg)] text-[var(--bg)] shadow-[0_8px_24px_rgba(9,9,11,.18)]",
          className
        )}
        // A fade with a whisper of scale, growing from the trigger's side —
        // softer than the `popIn` the other popovers use, which travels 4px and
        // reads as a jump on something this small and this frequent.
        style={{
          animation: "tooltipIn .15s cubic-bezier(.16,1,.3,1) both",
          transformOrigin: "var(--radix-tooltip-content-transform-origin)",
        }}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-[200] size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-[var(--fg)] fill-[var(--fg)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
