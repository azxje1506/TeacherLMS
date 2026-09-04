/* One tuition bill's payment.
 *
 * PATCH /api/finance/:billId -> the updated bill. Only what a payment records —
 *       status, paidAmount, paidDate, notes — may be sent; the request is
 *       refused outright if it names any other field, including `studentId`,
 *       `classId`, `month` and `fee`, which are fixed for the life of the bill.
 *
 * NO GET, deliberately, and for the reason `/api/reviews/:id` has none: the
 * month payload already carries every bill a screen can name, so a per-bill read
 * would be a second way to fetch what the client already holds — and it would be
 * the one route through which a bill left behind by a deleted student could be
 * looked up by id. PATCH refuses those with the same 404 a missing bill gets, so
 * the id space discloses nothing either way.
 *
 * NO POST and NO DELETE. Sprint 9 raises no bill and removes none: raising
 * tuition is a generation rule that does not exist yet, and deleting a bill
 * destroys financial history. There is no handler that could do either.
 *
 * NO UI CALLS THIS YET. The capability is complete — rule, validation, service
 * and endpoint — and no control is drawn for it until a payment form is
 * designed. A disabled button that suggests a working feature is worse than its
 * absence (PROJECT_RULES, Billing).
 */

import { recordPayment } from "@/lib/finance-service";
import { PAYMENT_ERROR } from "@/lib/billing";
import { billingPaymentSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ billId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { billId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = billingPaymentSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const res = await recordPayment(billId, parsed.data);
    if (!res.ok) {
      const { status, message } = PAYMENT_ERROR[res.violation];
      return error(message, status);
    }
    return json(res.row);
  });
}
