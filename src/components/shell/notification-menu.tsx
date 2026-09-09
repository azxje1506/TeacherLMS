"use client";

/* NotificationMenu — the header bell, its unread badge and the dropdown panel,
 * ported from the design comp's `data-notif` block.
 *
 * WHAT THIS COMPONENT OWNS, AND WHAT IT DOES NOT. It owns open/closed and the
 * acknowledgement snapshot; it owns no business rule. Which notifications exist,
 * what order they come in, which of them are visible and how many are unread are
 * all answered by `lib/notifications` and `lib/notification-state` — this file
 * calls them and draws the result. There is no second cap, no second unread
 * count and no second sort here, deliberately: every one of those would be a
 * place the panel could disagree with the engine.
 *
 * ACKNOWLEDGEMENT IS NOT A SETTING, so it is not in `SettingsProvider`. It is
 * per-item state with no enumeration and no default worth showing, and putting it
 * in the preferences store would have made it a tenth setting by accident. It is
 * read and written through `lib/notification-ack-store`, which is the same
 * `useSyncExternalStore` shape the settings store uses and for the same reason:
 * the value is owned by the browser, the server renders this component too, and
 * seeding from `localStorage` any other way either tears hydration or cascades
 * renders. That module's header explains the choice in full.
 *
 * NON-MODAL POPOVER, NOT A DIALOG. There is no focus trap and no scrim: the rest
 * of the application stays reachable while the panel is open, which is the
 * contract's own instruction. Dismissal is the three the comp implies and the
 * shared `ui/select` already implements — the trigger, Escape, and a pointer
 * outside the wrapper.
 *
 * ROW COPY LIVES IN `notification-copy`, beside this file the way `settings-ui`
 * sits beside the Settings screen — it is a pure function of a notification, a
 * translator and a formatter, so it can be exercised directly rather than only
 * through a render this test stack has no harness for.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { IconBell, IconX, IconRevenue, IconCalendar, IconReviews } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/lib/settings-context";
import type { AppNotification, NotificationType } from "@/lib/notifications";
import {
  commitAcknowledgement,
  getAcknowledgementServerSnapshot,
  getAcknowledgementSnapshot,
  subscribeAcknowledgement,
} from "@/lib/notification-ack-store";
import {
  dismiss as dismissId,
  markAllRead,
  markRead,
  markableIds,
  presentNotifications,
} from "@/lib/notification-state";
import type { AcknowledgementState } from "@/lib/notification-state";
import { rowCopy } from "./notification-copy";

/** The bell, in the shape every other icon control in the header already has. */
const iconBtn: React.CSSProperties = {
  minWidth: 38, width: 38, height: 38, border: "1px solid var(--border)", borderRadius: 9,
  background: "var(--card)", color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

/** One icon per type, from the existing set — Finance, Calendar and Reviews, the
 * three destinations the rows open. The icon says where you are going. */
const TYPE_ICON: Record<NotificationType, (p: { size?: number }) => React.ReactElement> = {
  tuition: IconRevenue,
  makeup: IconCalendar,
  review: IconReviews,
};

/** The comp tints each row's icon tile with a soft/solid pair. These are the
 * existing semantic tokens, so both themes and every accent follow along and no
 * colour is hard-coded. */
const TYPE_TINT: Record<NotificationType, { soft: string; solid: string }> = {
  tuition: { soft: "var(--amber-soft)", solid: "var(--amber)" },
  makeup: { soft: "var(--sky-soft)", solid: "var(--sky)" },
  review: { soft: "var(--accent-soft)", solid: "var(--accent)" },
};

export function NotificationMenu({ notifications }: { notifications: readonly AppNotification[] }) {
  const { t, fmt } = useSettings();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  /* Acknowledgement is owned by the browser, so it is READ through
   * `useSyncExternalStore` rather than seeded in an effect — see
   * `lib/notification-ack-store` for why that is the only option that neither
   * tears hydration nor cascades renders. Writing goes back through the same
   * store, so persisting can never be forgotten at one call site and remembered
   * at another. */
  const ack: AcknowledgementState = useSyncExternalStore(
    subscribeAcknowledgement,
    getAcknowledgementSnapshot,
    getAcknowledgementServerSnapshot
  );
  const commit = commitAcknowledgement;

  /* THE ONE PLACE THE LISTS COME FROM. `visible` is already capped and already
   * has dismissals applied, and `unreadCount` already counts the whole live set
   * rather than the twenty on screen — so nothing below slices or counts again. */
  const view = useMemo(() => presentNotifications(notifications, ack), [notifications, ack]);

  /* Close on Escape or a pointer outside, matching `ui/select`'s popover
   * behaviour. Escape returns focus to the bell, so the keyboard does not lose
   * its place. Bound only while open, so no listener outlives the panel. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); bellRef.current?.focus(); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Opening a notification marks THAT ONE read and then navigates. Opening the
   * PANEL marks nothing — the contract is explicit, and it is the difference
   * between a badge that reflects what was looked at and one that clears itself
   * for being glanced at. */
  const openNotification = useCallback((n: AppNotification) => {
    commit(markRead(ack, n.id));
    setOpen(false);
    router.push(n.href);
  }, [ack, commit, router]);

  /** Mark all read reaches the WHOLE live set, cap included — `markableIds`
   * returns `undismissed` rather than `visible` for exactly that reason. It
   * dismisses nothing. */
  const onMarkAll = useCallback(() => {
    commit(markAllRead(ack, markableIds(view)));
  }, [ack, commit, view]);

  /** Dismiss hides one row and touches no source entity. Item 21 moves up on the
   * next render because the cap is applied after dismissal, not before. */
  const onDismiss = useCallback((id: string) => {
    commit(dismissId(ack, id));
  }, [ack, commit]);

  const label = view.unreadCount > 0 ? `${t("Notifications")} (${view.unreadCount})` : t("Notifications");

  return (
    <div ref={wrapRef} data-notif="1" style={{ position: "relative" }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={bellRef}
            type="button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="notif-bell"
            className="btn-ghost"
            style={{ ...iconBtn, position: "relative" }}
            onClick={() => setOpen((o) => !o)}
          >
            <IconBell size={17} />
            {/* The badge repeats a count the button's own label already carries,
              * so it is hidden from assistive technology rather than announced
              * twice. Drawn only when there is something unread. */}
            {view.unreadCount > 0 && (
              <span
                aria-hidden="true"
                data-testid="notif-badge"
                style={{
                  position: "absolute", top: 5, right: 6, minWidth: 16, height: 16, padding: "0 4px",
                  /* `--primary-fg` and not the comp's `#fff`. It is the existing
                   * semantic "text on the accent family" token — no new token is
                   * invented — and it is white in seven of the eight
                   * theme/accent combinations, so this changes nothing visible in
                   * any of them. The eighth is Dark + Slate, where `--accent` is
                   * a pale `#94a3b8`: white on it measures about 2:1, which is
                   * unreadable for 10px bold digits, and the token already
                   * carries the dark ink that case needs. */
                  borderRadius: 99, background: "var(--accent)", color: "var(--primary-fg)", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid var(--card)",
                }}
              >
                {view.unreadCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("Notifications")}</TooltipContent>
      </Tooltip>

      {open && (
        <div
          className="notif-panel"
          role="menu"
          aria-label={t("Notifications")}
          data-testid="notif-panel"
          /* GEOMETRY IS NOT HERE. Position, anchoring, width and the mobile clamp
           * all live on `.notif-panel` in globals.css, because every one of them
           * changes below 768px and an inline declaration would outrank the media
           * query that has to change it. What stays inline is the part that never
           * varies by width — the comp's surface. */
          style={{
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14,
            boxShadow: "0 18px 48px rgba(0,0,0,.20)", zIndex: 120, overflow: "hidden",
            animation: "fadeUp .16s ease both",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "13px 16px", borderBottom: "1px solid var(--border-2)",
          }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {t("Notifications")}
              {view.unreadCount > 0 && (
                <span style={{ color: "var(--muted-2)", fontWeight: 500, fontSize: 12.5 }}> · {view.unreadCount}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onMarkAll}
              data-testid="notif-mark-all"
              className="notif-markall"
              style={{
                fontSize: 12, fontWeight: 500, color: "var(--accent)", background: "none", border: "none",
                cursor: "pointer", fontFamily: "inherit", padding: "2px 4px",
              }}
            >
              {t("Mark all read")}
            </button>
          </div>

          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {view.visible.length === 0 ? (
              <div style={{ padding: "34px 20px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                {t("You're all caught up.")}
              </div>
            ) : (
              view.visible.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  t={t}
                  fmt={fmt}
                  onOpen={() => openNotification(n)}
                  onDismiss={() => onDismiss(n.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One row: the tinted type icon, the title and body, and the dismiss control.
 *
 * THE ROW IS TWO BUTTONS AND NOT A CLICKABLE DIV, exactly as the comp draws it.
 * That is what makes both actions reachable by keyboard without inventing any
 * role or key handling, and what keeps dismiss from ever triggering the row's
 * navigation — they are siblings, so there is no bubbling to stop. */
function NotificationRow({
  n, t, fmt, onOpen, onDismiss,
}: {
  n: AppNotification;
  t: (s: string) => string;
  fmt: ReturnType<typeof useSettings>["fmt"];
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const Icon = TYPE_ICON[n.type];
  const tint = TYPE_TINT[n.type];
  const { title, body } = rowCopy(n, t, fmt);

  return (
    <div
      data-testid="notif-row"
      data-notif-id={n.id}
      style={{
        display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 14px",
        borderTop: "1px solid var(--border-2)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          minWidth: 30, width: 30, height: 30, borderRadius: 9, background: tint.soft, color: tint.solid,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
        }}
      >
        <Icon size={15} />
      </span>

      <button
        type="button"
        role="menuitem"
        onClick={onOpen}
        data-testid="notif-open"
        className="notif-open"
        style={{
          flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
          cursor: "pointer", fontFamily: "inherit", padding: 0,
        }}
      >
        {/* The title WRAPS rather than truncating — it is the row's whole point,
          * and the comp only ellipsizes the body beneath it. `overflowWrap`
          * covers the one case wrapping alone cannot: a long unbroken token (a
          * class code, a pasted name) has no space to break at, would overflow
          * this button's box and would run under the dismiss control. */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere" }}>{title}</div>
        <div style={{
          fontSize: 12, color: "var(--muted)", marginTop: 1,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {body}
        </div>
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("Dismiss")}
        data-testid="notif-dismiss"
        className="icon-action"
        style={{
          minWidth: 24, width: 24, height: 24, border: "none", borderRadius: 7, background: "transparent",
          color: "var(--muted-2)", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", flexShrink: 0,
        }}
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

