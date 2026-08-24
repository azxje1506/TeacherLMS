"use client";

/* Drawer — the design comp's right-side create/edit panel, ported verbatim from
 * the comp's "DRAWER (Create / Edit)" section: scrim, 460px panel, header with
 * title + subtitle + close button, scrolling body, and a two-button footer.
 * Body content is supplied per module (see CLAUDE.md: one drawer, many forms).
 *
 * THE DRAWER OWNS DISMISS MECHANICS; THE FORM OWNS DIRTINESS.
 *
 * Four gestures dismiss this panel — Cancel, the X, the scrim, Escape — and
 * before this they each called `onClose` directly, so a mis-tapped scrim threw
 * away everything the teacher had typed with no way back. Every one of them now
 * routes through a single `requestClose`, which is the only path out: there is
 * no fifth gesture and no unguarded alternative, because there is only one
 * function to guard.
 *
 * What this component deliberately does NOT do is look at the form. It cannot —
 * the body is arbitrary children, and a panel that tried to diff its own
 * contents would be guessing at which values are meaningful. The form knows, so
 * the form says, in one boolean. A caller that passes nothing gets the old
 * behaviour exactly.
 *
 * A SAVE IS NOT A DISMISSAL. Closing after a successful save is the caller
 * setting `open` to false, which never touches `requestClose` — so the prompt
 * cannot appear on the one path where there is nothing left to lose. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/settings-context";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Drawer({
  open, title, subtitle, saveLabel, saving = false, canSave = true, dirty = false,
  onClose, onSave, children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  saveLabel: string;
  saving?: boolean;
  /** Has the teacher changed anything since this form was opened or last reset?
   *
   * The FORM decides — it is the only thing that knows which of its values are
   * meaningful and what its baseline was. "Dirty" is never "holds a value": an
   * edit opens full of persisted text and a new review opens with ten ratings
   * already at 3, and neither of those is a change anybody made. Optional and
   * false by default, so an unguarded drawer behaves exactly as before. */
  dirty?: boolean;
  /** False when the form has nothing it is permitted to save — the footer button
   * takes the app's existing `button:disabled` treatment rather than a refusal
   * the teacher only discovers by pressing it. Optional and true by default, so
   * every existing caller is unaffected. */
  canSave?: boolean;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useT();

  /** Is the discard prompt up?
   *
   * DERIVED against `open`, the way the class drawer derives its own confirm,
   * rather than cleared by an effect: a prompt belongs to an open panel, so a
   * drawer that is shut cannot be showing one and a reopened panel cannot
   * inherit a stale one. Both of the dialog's own buttons clear the flag too, so
   * it is never left standing after a decision. */
  const [confirmRequested, setConfirmRequested] = useState(false);
  const confirming = open && confirmRequested;

  /** THE ONLY WAY OUT. Every dismissal gesture calls this and nothing else calls
   * `onClose` directly, so guarding one function guards all of them. */
  const requestClose = useCallback(() => {
    if (dirty) setConfirmRequested(true);
    else onClose();
  }, [dirty, onClose]);

  // Escape dismisses — through the guard, like every other gesture. While the
  // prompt is up the prompt owns the key (it listens in the capture phase and
  // stops propagation); the guard here states that rather than relying on it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, confirming, requestClose]);

  /* Focus moves into the panel so the form is immediately usable — but ONLY when
   * the drawer opens. This deliberately does not depend on `onClose`: callers
   * pass an inline arrow, so its identity changes on every render of the form
   * above, and any re-render (a field subscribing to RHF's `isDirty`, a query
   * resolving) would re-run this and rip focus out of whatever the teacher was
   * typing in. `open` is the only thing that should move focus. */
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
  }, [open]);

  // Lock body scroll while the drawer owns the screen (scrollbar-compensated,
  // so the layout behind it does not shift).
  useScrollLock(open);

  if (!open) return null;

  /* Portal to <body>. Each page root runs `animation: fadeUp … both`, and a
   * filling animation leaves a computed transform of matrix(1,0,0,1,0,0) rather
   * than none — which makes that element the containing block for fixed-position
   * descendants. Rendered in place, the scrim and panel would anchor to the page
   * content box instead of the viewport. */
  return createPortal(
    <>
      <div
        onClick={requestClose}
        style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(9,9,11,.42)", animation: "overlayFade .2s ease both" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="app-drawer"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 81, width: "min(460px,94vw)",
          background: "var(--bg)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 40px rgba(0,0,0,.16)",
          display: "flex", flexDirection: "column", animation: "drawerIn .26s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{subtitle}</div>}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button" onClick={requestClose} aria-label={t("Close")} className="btn-ghost"
                style={{ minWidth: 32, width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("Close")}</TooltipContent>
          </Tooltip>
        </div>

        {/* data-drawer-body marks the scroll container: a form section whose
          * height changes can find it and hold the scroll position steady, so
          * the fields above it never jump. */}
        <div className="app-drawer-body" data-drawer-body="1" style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>

        <div className="app-drawer-foot" style={{ display: "flex", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <button
            type="button" onClick={requestClose} className="btn-ghost"
            style={{ flex: 1, height: 42, border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            {t("Cancel")}
          </button>
          <button
            type="button" onClick={onSave} disabled={saving || !canSave} className="btn-primary"
            style={{ flex: 1, height: 42, border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
          >
            {saveLabel}
          </button>
        </div>
      </div>

      {/* The app's existing centre dialog, not a second modal architecture. It
        * portals itself and sits at z-index 90/91, above this panel's 80/81.
        *
        * "Keep editing" is the safe half and simply drops the prompt — the form
        * underneath is never touched, so every value and the caret are exactly
        * where they were. "Discard changes" is the destructive half and dismisses
        * for real. Neither branch saves, resets or mutates anything: this dialog
        * decides whether to leave, never what to leave behind. */}
      <ConfirmDialog
        open={confirming}
        destructive
        title={t("Discard unsaved changes?")}
        message={t("Your changes haven't been saved. If you leave now, they will be lost.")}
        cancelLabel={t("Keep editing")}
        confirmLabel={t("Discard changes")}
        onCancel={() => setConfirmRequested(false)}
        onConfirm={() => { setConfirmRequested(false); onClose(); }}
      />
    </>,
    document.body
  );
}
