/* Reports — the client-side fetcher and its React Query keys.
 *
 * Same pattern as Finance, Reviews and every other module here. The payload TYPE
 * comes from the server module rather than being restated, so the server cannot
 * change the shape of a response without the client failing to compile.
 * `import type` is erased at build time, so importing from a module that is not
 * itself server-only costs nothing at runtime.
 *
 * ONE READ, AND NO WRITE. There is exactly one function here and it is a GET.
 * There is no `useMutation`, no invalidation rule and no optimistic update
 * anywhere in Reports, because Reports writes nothing: a report is generated per
 * request and thrown away (PROJECT_RULES, Reports).
 *
 * NO `/api/dashboard` AND NO `/api/lessons`. The first runs the lesson lifecycle
 * and therefore WRITES on a GET; the second generates lessons. Reports has its
 * own read-only endpoint and never reaches for either.
 *
 * NO RECOMPUTATION. Nothing in the Reports client re-derives revenue, tuition,
 * an attendance rate or a completion figure. Every number on the screen is one
 * the payload already carried.
 */

import type { ReportPayload, ReportType } from "@/lib/reports";
import { reportQuery } from "@/components/reports/reports-ui";

/** Query keys. One selection is one cache entry, so changing a filter refetches
 * that selection and leaves the previous one cached — which is what lets the
 * preview hold the last good report while the next one loads instead of
 * flashing empty. */
export const reportKeys = {
  all: ["reports"] as const,
  one: (type: ReportType, month: string, classId: string, studentId: string) =>
    ["reports", type, month, classId, studentId] as const,
};

export class ReportApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportApiError";
  }
}

/** One report.
 *
 * Every part of the selection is explicit. The client never computes which
 * months exist — the payload's own `months` is the window — and never
 * substitutes a default, because the server owns that answer and a browser clock
 * is not this application's clock. */
export async function fetchReport(
  type: ReportType,
  month: string,
  classId: string,
  studentId: string
): Promise<ReportPayload> {
  const res = await fetch(`/api/reports?${reportQuery(type, month, classId, studentId)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ReportApiError(data.error || "Couldn't load report");
  }
  return res.json();
}
