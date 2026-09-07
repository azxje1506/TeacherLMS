/* One report.
 *
 * GET /api/reports?type=…&month=YYYY-MM[&classId=…][&studentId=…]
 *     -> the generic Reports document for that selection: masthead metadata, the
 *     server-owned month window, the summary tiles, one generic table, and — only
 *     where the owning domain supplies them — a hidden-record count, completeness
 *     metadata and attendance coverage.
 *
 *     `type` and `month` are required. Both are the client's explicit statement:
 *     the server owns the WINDOW and returns it in the payload, but never the
 *     choice, so a missing month is refused rather than silently becoming "this
 *     month". A well-formed month the teacher has no data for is a valid EMPTY
 *     payload, not an error and not a 404.
 *
 * ============================================================================
 * THIS ROUTE WRITES NOTHING.
 *
 * It does not call `advanceLessonLifecycle`, does not reconcile, does not
 * generate a lesson, does not generate a bill, updates no document in any
 * collection and creates no index. It persists no report and produces no
 * server-side file: a report is generated per request and thrown away
 * (PROJECT_RULES, Reports).
 *
 * THAT IS A DELIBERATE DIVERGENCE FROM `/api/dashboard`, which runs the lesson
 * lifecycle before computing and is therefore a GET that performs a `bulkWrite`.
 * That call belongs there — without it a lesson whose date has passed would
 * never resolve — but Reports REPORTS on what the owning domains have already
 * settled and must not be the thing that settles them. `/api/finance` and
 * `/api/reviews/composer` state the same invariant. There are tests asserting
 * that this file imports no lifecycle, reconciler or generator and contains no
 * write verb.
 * ============================================================================
 *
 * NO POST, NO PUT, NO PATCH, NO DELETE. There is no Report entity to create,
 * edit or remove, so there is no handler that could — the absence is the
 * enforcement.
 */

import { buildReport } from "@/lib/reports-service";
import { REPORT_ERROR, isReportType } from "@/lib/reports";
import { ISO_MONTH } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();

    const params = new URL(req.url).searchParams;

    const type = params.get("type") ?? "";
    if (!isReportType(type)) {
      const e = REPORT_ERROR["type-unknown"];
      return error(e.message, e.status);
    }

    const month = params.get("month") ?? "";
    if (!ISO_MONTH.test(month)) {
      const e = REPORT_ERROR["month-malformed"];
      return error(e.message, e.status);
    }

    /* An absent filter is the sentinel — "all classes", "all students" — and not
     * an omission to complain about. An empty string is the same thing a select
     * sends for its own sentinel, so it is read as absent rather than as an id
     * that will fail to resolve. */
    const classId = params.get("classId") || null;
    const studentId = params.get("studentId") || null;

    const result = await buildReport({ type, month, classId, studentId });
    if (!result.ok) {
      const e = REPORT_ERROR[result.violation];
      return error(e.message, e.status);
    }

    return json(result.payload);
  });
}
