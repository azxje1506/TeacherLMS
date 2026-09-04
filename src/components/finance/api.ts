/* Finance — client-side fetchers and React Query keys.
 *
 * Same pattern as Students / Parents / Classes / Lessons / Attendance /
 * Homework / Reviews. The payload TYPE comes from the server module rather than
 * being restated here, so the server cannot change the shape of a response
 * without the client failing to compile. `import type` is erased at build time,
 * so importing from a `server-only` module costs nothing at runtime — the same
 * thing components/reviews/api.ts does.
 *
 * ONE READ, AND NO WRITE. There is exactly one function here and it is a GET.
 *
 * `PATCH /api/finance/:billId` EXISTS AND IS DELIBERATELY NOT CALLED. The
 * payment capability is complete on the server — rule, validation, service and
 * endpoint — and Sprint 9 draws no control for it, because the design comp has
 * Record and Manage BUTTONS but no payment form anywhere in it, and
 * PROJECT_RULES forbids inventing missing UI. So there is no mutation, no
 * `useMutation`, no invalidation rule and no optimistic update in this module,
 * and there is a test asserting that no Finance UI file mentions the route at
 * all. A disabled button that suggests a working feature is worse than its
 * absence.
 *
 * NO `/api/dashboard`. That route runs the lesson lifecycle and therefore
 * WRITES on a GET. Finance has its own read-only endpoint and never reaches for
 * Dashboard's, not even for the Class detail card.
 */

import type { FinanceMonthPayload } from "@/lib/finance-service";

/** Query keys. One month of Finance is one cache entry, so switching months
 * refetches that month and leaves the others cached. */
export const financeKeys = {
  all: ["finance"] as const,
  month: (month: string) => ["finance", "month", month] as const,
};

export class FinanceApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceApiError";
  }
}

/** One month of Finance: tuition and lesson revenue, in two branches.
 *
 * The month is always explicit. The client never computes which months exist —
 * the payload's own `months` is the window — and never substitutes a default,
 * because the server owns that answer and a browser clock is not this
 * application's clock. */
export async function fetchFinanceMonth(month: string): Promise<FinanceMonthPayload> {
  const res = await fetch(`/api/finance?month=${encodeURIComponent(month)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new FinanceApiError(data.error || "Couldn't load finance");
  }
  return res.json();
}
