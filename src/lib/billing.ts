/* Billing — the pure domain.
 *
 * One month's tuition for one student in one class: what was asked for, what was
 * collected against it, and what is therefore still due. Every rule PROJECT_RULES
 * states about a bill lives here as a function over plain values. Nothing here
 * connects to a database.
 *
 * BILLING IS NOT REVENUE, and this module never computes revenue. Revenue is
 * money EARNED BY TEACHING — lesson-derived, attendance-aware, owned by
 * `Lesson.date`, and computed by `computeRevenue` in finance.ts. Billing is money
 * ASKED FOR AND RECEIVED, owned by `Billing.month`. Neither derives from the
 * other and they are allowed to disagree. The separation is enforced in the
 * vocabulary as well as in the code: everything here is `billed`, `collected`,
 * `outstanding` or `collectionRate`, and the word `revenue` appears in this file
 * only in sentences saying it does not belong here.
 *
 * THE HARD PART IS WHAT IS NOT KNOWN. A `Partially Paid` bill records how much
 * was collected only if somebody recorded it, and no bill predating the
 * `paidAmount` field did. For those, the collected amount is genuinely UNKNOWN —
 * it is not zero, it is not the fee, and it is emphatically not half. The dead
 * `paidAmount()` helper this module replaces returned `fee / 2` for every
 * partial, which was an invented constant with no rule behind it; it has been
 * deleted rather than moved. `null` is the representation of that ignorance, and
 * it PROPAGATES: a total over a scope containing one unknown is itself unknown,
 * and carries `unknownAmountBills` so a screen can say how many records are
 * responsible instead of quietly completing the sum with a guess. This is the
 * same distinction PROJECT_RULES already draws for an empty attendance
 * denominator — `No data`, never `0%`.
 *
 * GHOSTS ARE COUNTED HERE AND LISTED ELSEWHERE. Every aggregate below counts
 * every bill it is given, including bills whose student no longer exists,
 * because a student's later deletion must not move a closed month's reported
 * figures. Deciding WHICH bills a person-shaped list may name is a separate
 * question, answered by `partitionByStudentResolution` from a set of ids the
 * caller resolved — which keeps this module pure and keeps the two rules from
 * being tangled into one pass.
 *
 * NOTHING IS NORMALISED. A fee that disagrees with the class it came from is
 * summed exactly as stored. Correcting stored data is a separate, explicitly
 * authorised act, never a side effect of adding it up.
 *
 * NO `server-only`, for the same reason src/lib/homework.ts and
 * src/lib/attendance.ts have none: these decisions are exercised by the test
 * runner, which cannot resolve that module.
 *
 * NO BILLING FIGURE DEPENDS ON THE DATE. A bill has a month, not a deadline, and
 * a date passing settles nothing, so every calculation below is clock-free. The
 * one rule that does need a clock is the refusal of a future `paidDate`, which
 * is a property of a WRITE rather than of a figure; it lives in its own section
 * at the foot of this file and takes the app clock AS AN ARGUMENT, never as a
 * module-level import — the same discipline homework.ts states, so a test names
 * the day it means instead of tracking `TODAY_ISO`.
 *
 * GATE 3 SCOPE. Pure calculation and the pure half of payment validation. The
 * read model, the service and the API that will call these are Gate 4. */

import { TODAY_ISO } from "./constants";
import type { Billing, BillingStatus } from "./types";

/* ------------------------------------------------------------- vocabulary */

/** The three words a Billing status may be. Shared with validation and with the
 * Mongoose schema so the list is stated once.
 *
 * There is deliberately no `Overdue`: a bill has no due date to be past, and a
 * date passing changes no stored data (PROJECT_RULES, Billing). There is no
 * `Pending`, which would be indistinguishable from `Unpaid`, and no invoice or
 * receipt state, because neither exists in this system. */
export const BILLING_STATUSES = ["Paid", "Partially Paid", "Unpaid"] as const satisfies
  readonly BillingStatus[];

/** A status this build does not recognise is not a permission.
 *
 * Mirrors `UncoveredAttendanceStatus` in schemas.ts: if `BillingStatus` ever
 * gains a member, this fails to compile at the line pointing at the omission
 * rather than silently letting the new value fall through the switches below. */
export type UncoveredBillingStatus = Exclude<BillingStatus, (typeof BILLING_STATUSES)[number]>;
export const BILLING_STATUSES_ARE_EXHAUSTIVE: UncoveredBillingStatus extends never ? true : never = true;

/** The fields every calculation below reads. Narrower than `Billing` so a caller
 * may pass a projection, and so a test fixture states only what matters. */
export type BillLike = Pick<Billing, "status" | "fee"> & Pick<Partial<Billing>, "paidAmount">;

/* --------------------------------------------------------- one bill at a time */

/** What was asked for. Always known: a bill without a fee is not a bill.
 *
 * Read exactly as stored. `Billing.fee` is a historical snapshot of the class's
 * fee for that period, so a bill whose fee disagrees with its class today is
 * still summed at its own value — the disagreement is a fact to surface, not an
 * error to correct on read. */
export function billedFor(bill: Pick<Billing, "fee">): number {
  return bill.fee;
}

/** What was collected, or `null` when that is not knowable.
 *
 * - `Paid` — settled in full, so the collected value IS the fee. No second copy
 *   of it is stored, and none is needed.
 * - `Unpaid` — nothing was collected. Exactly zero, and this is the only status
 *   for which zero is an answer rather than an absence.
 * - `Partially Paid` with a recorded `paidAmount` — that amount, exactly.
 * - `Partially Paid` with none — **unknown**. Every bill predating the field is
 *   here, and there is nothing in the record from which the amount could be
 *   recovered. Returning `0` would claim the family paid nothing; returning
 *   `fee / 2` would invent a number no rule supports. Both are worse than
 *   admitting the gap.
 *
 * An unrecognised status also returns `null` and never a number — failing closed
 * is the same posture the lesson lifecycle takes toward a class status it does
 * not know. */
export function collectedFor(bill: BillLike): number | null {
  switch (bill.status) {
    case "Paid":
      return bill.fee;
    case "Unpaid":
      return 0;
    case "Partially Paid":
      return typeof bill.paidAmount === "number" ? bill.paidAmount : null;
    default:
      return null;
  }
}

/** What is still due, or `null` when the collected amount is not knowable.
 *
 * Derived rather than stored, so it cannot drift from the two values it is made
 * of. Ignorance propagates: if `collectedFor` does not know, neither does this. */
export function outstandingFor(bill: BillLike): number | null {
  const collected = collectedFor(bill);
  return collected === null ? null : bill.fee - collected;
}

/** Is this bill's collected amount unknown? True only for a `Partially Paid`
 * record with no recorded amount (and for an unrecognised status).
 *
 * Exposed so a caller can count and name the records responsible for an unknown
 * total rather than presenting the total's absence as a mystery. */
export function hasUnknownAmount(bill: BillLike): boolean {
  return collectedFor(bill) === null;
}

/* ------------------------------------------------------------- aggregates */

/** How many bills carry each status. Keyed by the stored value, never by a
 * label: the enum is data and the words on screen are the design's. */
export interface BillingStatusCounts {
  paid: number;
  partiallyPaid: number;
  unpaid: number;
  /** Every bill counted, including any whose status this build does not know —
   * so `paid + partiallyPaid + unpaid` may be less than `total`, and a caller
   * that assumed otherwise finds out here rather than in a rendered figure. */
  total: number;
}

/** One scope's money. A scope is whatever set of bills the caller passed — a
 * month, a class within a month, one student's history. This module does not
 * decide what "relevant" means and never filters. */
export interface BillingTotals {
  /** Σ fee. Always known. */
  billed: number;
  /** Σ collected, or `null` if ANY bill in the scope has an unknown amount. */
  collected: number | null;
  /** `billed - collected`, or `null` when collected is. */
  outstanding: number | null;
  /** `collected / billed` as a whole percent; `null` when collected is unknown
   * OR when `billed` is 0 — an empty denominator is `No data`, never `0%`. */
  collectionRate: number | null;
  /** Bills whose collected amount could not be determined. `0` whenever
   * `collected` is a number, and the count a screen names when it is not. */
  unknownAmountBills: number;
  counts: BillingStatusCounts;
}

/** Total one scope's bills.
 *
 * EVERY BILL GIVEN IS COUNTED, ghosts included. A bill whose student no longer
 * exists still recorded money that was asked for, and dropping it here would let
 * a deletion move a closed month's reported figures — the rule Homework already
 * holds its own ghost outcomes to. Excluding a bill is a decision for the caller
 * to have made before calling, and the person-shaped lists are the only place
 * that decision belongs (see `partitionByStudentResolution`).
 *
 * ONE UNKNOWN POISONS THE TOTAL, on purpose. A scope containing a partial with
 * no recorded amount has an unknowable collected figure, and reporting the sum
 * of the rest as though it were the whole would understate collection by exactly
 * the amount nobody recorded. `unknownAmountBills` says how many records did it.
 *
 * INTEGER ARITHMETIC THROUGHOUT. Every input is integer VND and only addition
 * and subtraction are used, so no rounding happens and none is needed. The one
 * division is the rate, which is rounded once, at the end, to a whole percent. */
export function totalsFor(bills: readonly BillLike[]): BillingTotals {
  let billed = 0;
  let collectedKnown = 0;
  let unknownAmountBills = 0;
  const counts: BillingStatusCounts = { paid: 0, partiallyPaid: 0, unpaid: 0, total: 0 };

  for (const bill of bills) {
    billed += bill.fee;
    counts.total++;
    if (bill.status === "Paid") counts.paid++;
    else if (bill.status === "Partially Paid") counts.partiallyPaid++;
    else if (bill.status === "Unpaid") counts.unpaid++;

    const collected = collectedFor(bill);
    if (collected === null) unknownAmountBills++;
    else collectedKnown += collected;
  }

  const collected = unknownAmountBills > 0 ? null : collectedKnown;
  const outstanding = collected === null ? null : billed - collected;
  const collectionRate =
    collected === null || billed === 0 ? null : Math.round((collected / billed) * 100);

  return { billed, collected, outstanding, collectionRate, unknownAmountBills, counts };
}

/** One class's totals within a scope, ready to roll up. */
export interface BillingClassTotals extends BillingTotals {
  classId: string;
}

/** Group the given bills by `classId` and total each group.
 *
 * ORDER IS THE FIRST APPEARANCE of each class in the input, so the caller's own
 * ordering survives and this function invents no sort. A screen that wants
 * classes by outstanding balance sorts them itself, with a comparator that can
 * see how it wants to treat an unknown.
 *
 * The per-class figures reconcile with the scope total exactly: `Σ billed` over
 * the groups equals `totalsFor(bills).billed`, because every bill lands in
 * exactly one group and nothing is dropped or rounded. */
export function totalsByClass(bills: readonly (BillLike & { classId: string })[]): BillingClassTotals[] {
  const order: string[] = [];
  const groups = new Map<string, (BillLike & { classId: string })[]>();
  for (const bill of bills) {
    let bucket = groups.get(bill.classId);
    if (!bucket) {
      bucket = [];
      groups.set(bill.classId, bucket);
      order.push(bill.classId);
    }
    bucket.push(bill);
  }
  return order.map((classId) => ({ classId, ...totalsFor(groups.get(classId)!) }));
}

/* ---------------------------------------------------- listable vs counted */

/** A scope's bills split by whether their student still resolves.
 *
 * `listable` may be named on screen. `hidden` may not — there is no name to
 * render, and a working list of who still owes money cannot contain somebody who
 * is gone. Both halves stay countable, and callers total the WHOLE input rather
 * than `listable`, so the aggregates never move when somebody is deleted. */
export interface BillingPartition<T> {
  listable: T[];
  hidden: T[];
  /** `hidden.length`, named for what a screen does with it: the design's own
   * "+N more" affordance, which says that unlisted records contribute to the
   * total without inventing a placeholder row for a person who no longer
   * exists. */
  hiddenCount: number;
}

/** Split bills by whether their `studentId` is in the set of ids that resolved.
 *
 * The set is the CALLER'S, deliberately. Resolving a student id means reading
 * the students collection, which this module must not do; passing the answer in
 * keeps the rule testable without a database and keeps the two questions — "does
 * this person exist" and "what does this money add up to" — from being tangled
 * into one pass.
 *
 * A student's STATUS is not consulted and cannot be, from this signature. Trial,
 * Paused and Archived students' bills are all listable: archiving a person does
 * not forgive their February, and status gates no Billing rule anywhere
 * (PROJECT_RULES, Billing — a deliberate divergence from Reviews). */
export function partitionByStudentResolution<T extends { studentId: string }>(
  bills: readonly T[],
  resolvedStudentIds: ReadonlySet<string>
): BillingPartition<T> {
  const listable: T[] = [];
  const hidden: T[] = [];
  for (const bill of bills) {
    (resolvedStudentIds.has(bill.studentId) ? listable : hidden).push(bill);
  }
  return { listable, hidden, hiddenCount: hidden.length };
}

/* ------------------------------------------------------- the payment write
 *
 * WHY THIS IS SPLIT IN TWO. `paidAmount` must be strictly less than the bill's
 * fee, and `fee` is not in the payload — it is on the persisted document, and it
 * is immutable, so a request cannot supply it and must not be trusted if it
 * tries. Zod therefore validates everything that is a property of the PAYLOAD
 * ALONE (shape, legal status, ISO form, the status/field coherence, the future
 * date), and the function below validates the one rule that needs the stored
 * bill. Two layers, each answering only what it can see.
 *
 * The same shape as Homework's split, and stated there for the same reason: the
 * schema keeps a bad request out, the planner keeps a bad write in. */

/** The four fields a payment write may carry, after Zod has parsed them. */
export interface PaymentWriteInput {
  status: BillingStatus;
  paidAmount?: number;
  paidDate: string | null;
  notes?: string;
}

/** Why a payment write was refused. Each code names the rule it protects, so a
 * caller renders the teacher's error and a test asserts the reason rather than a
 * message string. */
export type PaymentViolation =
  | "bill-missing"
  | "amount-required"
  | "amount-not-allowed"
  | "amount-not-integer"
  | "amount-out-of-range"
  | "date-required"
  | "date-not-allowed"
  | "date-in-future";

export type PaymentCheck =
  | { ok: true; write: PaymentWriteInput }
  | { ok: false; violation: PaymentViolation };

/** Validate a parsed payment payload against the bill it settles.
 *
 * THE BILL IS THE AUTHORITY ON `fee`. Nothing in the payload can change it, and
 * the range check reads it from the stored document — which is also why a
 * missing bill is a violation here rather than something the schema could have
 * caught.
 *
 * THE RULES, one per status (PROJECT_RULES, Billing):
 *
 * - `Unpaid` — nothing was collected, so no amount and no date. Both are
 *   refused rather than ignored: a request carrying them means the caller
 *   believes something this bill does not say.
 * - `Paid` — settled in full, so the collected value IS the fee and no amount is
 *   stored; a date is required, because money arrived on a day.
 * - `Partially Paid` — an amount is REQUIRED, integer VND, strictly between zero
 *   and the fee, and a date is required. `0` would be `Unpaid` and `fee` would
 *   be `Paid`; a partial that is neither partial nor recorded is not a payment,
 *   it is a status with nothing behind it. This is the rule that stops the
 *   deleted `fee / 2` assumption from ever being needed: a new partial states
 *   its amount, and one that cannot is refused instead of guessed.
 *
 * NO FUTURE DATE. Money is not received on a day that has not happened, and the
 * application day is the boundary — a date equal to the clock is today and is
 * accepted. THIS GOVERNS WRITES ONLY: the six stored records dated ahead of the
 * clock are read back exactly as they are, because correcting them is a separate
 * and deliberate decision, not a side effect of validating something else.
 *
 * OWNERSHIP IS NOT REACHABLE FROM HERE. `id`, `studentId`, `classId`, `month`
 * and `fee` are absent from `PaymentWriteInput` entirely, so no code path exists
 * that could change one — the schema's `.strict()` refuses a request naming one,
 * and this signature could not honour it even if it slipped through.
 *
 * STUDENT STATUS IS NOT CONSULTED and cannot be, from this signature. A Trial,
 * Paused or Archived student's tuition is still owed and still settleable. What
 * a caller must refuse is a bill whose student does not resolve at all, and that
 * is the ghost rule, answered before this function is reached. */
export function checkPaymentWrite(
  input: PaymentWriteInput,
  bill: Pick<Billing, "fee"> | null | undefined,
  appClock: string = TODAY_ISO
): PaymentCheck {
  if (!bill) return { ok: false, violation: "bill-missing" };

  const hasDate = input.paidDate !== null && input.paidDate !== "";
  const hasAmount = input.paidAmount !== undefined;

  if (input.status === "Unpaid") {
    if (hasAmount) return { ok: false, violation: "amount-not-allowed" };
    if (hasDate) return { ok: false, violation: "date-not-allowed" };
    return { ok: true, write: { status: "Unpaid", paidDate: null, notes: input.notes } };
  }

  if (!hasDate) return { ok: false, violation: "date-required" };
  // String comparison is total on ISO "YYYY-MM-DD" and needs no Date object —
  // the same technique `isPastDate` uses, and it cannot drift with a timezone.
  if (input.paidDate! > appClock) return { ok: false, violation: "date-in-future" };

  if (input.status === "Paid") {
    if (hasAmount) return { ok: false, violation: "amount-not-allowed" };
    return { ok: true, write: { status: "Paid", paidDate: input.paidDate, notes: input.notes } };
  }

  // Partially Paid
  if (!hasAmount) return { ok: false, violation: "amount-required" };
  if (!Number.isInteger(input.paidAmount)) return { ok: false, violation: "amount-not-integer" };
  if (input.paidAmount! <= 0 || input.paidAmount! >= bill.fee) {
    return { ok: false, violation: "amount-out-of-range" };
  }
  return {
    ok: true,
    write: {
      status: "Partially Paid",
      paidAmount: input.paidAmount,
      paidDate: input.paidDate,
      notes: input.notes,
    },
  };
}
