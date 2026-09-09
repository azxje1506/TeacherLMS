/* Notifications — the user-facing copy for one row.
 *
 * SPLIT OUT OF THE COMPONENT for the reason `settings-ui.ts` is split out of
 * `settings-screen.tsx`: this is a pure function of a notification, a translator
 * and a formatter, and keeping it here means it can be exercised directly —
 * every type, both languages, every regional preference — instead of only
 * through a render this test stack has no harness for.
 *
 * TITLE SAYS WHAT, BODY SAYS WHICH. The title names the kind of thing that needs
 * attention; the body names the one it is about. All of it goes through `t()` and
 * the bound formatter, so the month, date, time and amount follow the teacher's
 * own preferences and the whole row follows the interface language.
 *
 * THIS IS WHY IDS ARE NOT BUILT HERE. Everything below changes with the language
 * and the regional settings. A stable id derived from any of it would change with
 * them too, and a dismissal would not survive switching to English — which is
 * exactly what `lib/notifications` refuses to do.
 *
 * NO SEND, NO REMINDER, NO RECIPIENT. The tuition row states what is owed and
 * opens Finance; it offers no way to tell anybody about it. That is the Finance
 * and Reports rule holding, not an omission.
 */

import type { Formatter } from "@/lib/format";
import type { AppNotification } from "@/lib/notifications";

export interface NotificationCopy {
  title: string;
  body: string;
}

/** The separator the comp uses between the facts in a row's body. */
const SEP = " · ";

export function rowCopy(
  n: AppNotification,
  t: (s: string) => string,
  fmt: Formatter
): NotificationCopy {
  switch (n.type) {
    case "tuition": {
      /* Both titles were already in the dictionary's Finance vocabulary, so the
       * row says "unpaid" the same way every other surface does. */
      const title = n.billingStatus === "Partially Paid" ? t("Partially paid tuition") : t("Unpaid tuition");
      /* `vnd` is the app's one currency formatter despite the name — it renders
       * USD when that preference is set, over the existing fixed demo rate. The
       * stored value stays integer VND either way; only the rendering changes. */
      return { title, body: join([n.subject, month(n, fmt), n.amount != null ? fmt.vnd(n.amount) : null]) };
    }
    case "makeup":
      return {
        title: t("Upcoming makeup"),
        body: join([n.subject, n.date ? fmt.dateLabel(n.date) : null, n.start ? fmt.time12(n.start) : null]),
      };
    case "review":
      return { title: t("Review due"), body: join([n.subject, month(n, fmt)]) };
  }
}

function month(n: AppNotification, fmt: Formatter): string | null {
  return n.month ? fmt.monthLabel(n.month) : null;
}

/** Facts, in order, with the empty ones left out rather than rendered as gaps. A
 * notification whose class was deleted still reads as a sentence. */
function join(parts: readonly (string | null)[]): string {
  return parts.filter((p): p is string => p != null && p !== "").join(SEP);
}
