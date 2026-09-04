/* One month of Finance.
 *
 * GET /api/finance?month=YYYY-MM -> the month's tuition and its lesson revenue,
 *     in two branches that are never mixed. `month` is required and must be a
 *     well-formed month; a well-formed month the teacher has never billed is a
 *     valid EMPTY payload, not an error.
 *
 * ============================================================================
 * THIS ROUTE WRITES NOTHING.
 *
 * It does not call `advanceLessonLifecycle`, does not reconcile, does not
 * generate a lesson, does not generate a bill, updates no document in any
 * collection and creates no index. `buildFinanceMonth` is a pure read over
 * narrow queries.
 *
 * THAT IS A DELIBERATE DIVERGENCE FROM `/api/dashboard`, which runs the lesson
 * lifecycle before computing and is therefore a GET that performs a `bulkWrite`.
 * That call belongs there — without it a lesson whose date has passed would
 * never resolve — but Finance REPORTS on what the lesson domain has already
 * settled and must not be the thing that settles it. `/api/reviews/composer`
 * states the same invariant. There are tests asserting that this file imports no
 * lifecycle, reconciler or generator and contains no write verb.
 * ============================================================================
 *
 * NO POST, NO PUT, NO DELETE. Sprint 9 raises no bill and removes none: there is
 * no generation rule yet, and a bill is a financial record. The absence is the
 * enforcement — there is no handler that could.
 */

import { buildFinanceMonth } from "@/lib/finance-service";
import { ISO_MONTH } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();

    /* The month is the client's explicit statement, never a substituted default:
     * the server owns the WINDOW (and returns it in the payload) but not the
     * choice. A missing or malformed month is refused rather than silently
     * becoming "this month", which is the same posture Reviews takes about a
     * payload that omitted one. */
    const month = new URL(req.url).searchParams.get("month") ?? "";
    if (!ISO_MONTH.test(month)) return error("Pick a month", 422);

    return json(await buildFinanceMonth(month));
  });
}
