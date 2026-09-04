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
import type { Billing, BillingStatus, Klass, Student } from "./types";

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

/** Is money still owed on this bill? True for `Unpaid` and `Partially Paid`.
 *
 * A legacy partial with no recorded amount is still outstanding — SOMETHING is
 * owed, and only the amount is unknown. Saying otherwise would drop a debt
 * because nobody wrote a number down. `outstandingFor` reports the `null`. */
export function isOutstanding(bill: Pick<Billing, "status">): boolean {
  return bill.status === "Unpaid" || bill.status === "Partially Paid";
}

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
  /** Σ fee. Always known: every bill has a fee, recorded or not. */
  billed: number;
  /** Σ of the collected amounts that ARE known. Never null, never a guess: a
   * bill whose amount was never recorded contributes nothing to it. */
  knownCollected: number;
  /** Σ of the outstanding amounts that ARE known. Same rule, same reason. */
  knownOutstanding: number;
  /** `billed - knownCollected - knownOutstanding`: the slice of the billed
   * total whose split between collected and outstanding nobody can state.
   *
   * IT IS NOT A PAYMENT AMOUNT. It is the FEE of every bill with an unrecorded
   * amount — the money we know was asked for and cannot say the fate of. Zero
   * whenever `amountsComplete`. */
  unknownAmount: number;
  /** How many bills produced that gap. */
  unknownAmountBills: number;
  /** `unknownAmountBills === 0`. When true, and only then,
   * `knownCollected + knownOutstanding === billed`. */
  amountsComplete: boolean;
  /** `knownCollected / billed` as a whole percent, or `null` when `billed` is
   * 0 — an empty denominator has no share, and 0% would be a claim.
   *
   * IT IS A FLOOR, NOT A FIGURE, whenever `amountsComplete` is false: the real
   * rate is this or higher, because every unrecorded partial collected
   * SOMETHING. A caller that prints it as an exact percentage is lying, which
   * is why the flag sits beside it in the same object. */
  collectionRate: number | null;
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
 * ONE UNKNOWN NO LONGER POISONS THE TOTAL. It used to: a scope holding a single
 * partial with no recorded amount reported `collected: null`, and the screen
 * said so for the whole month. That was defensible arithmetic and unusable
 * information — production has one such record in most months, so a teacher who
 * had collected 8,550,000đ was told the month could not be counted, and the
 * 12,400,000đ nobody disputes disappeared behind one 700,000đ record.
 *
 * WHAT REPLACED IT. The scope reports the money it can actually stand behind —
 * `knownCollected` and `knownOutstanding` — and reports the gap separately
 * rather than folding it into either. Nothing is inferred: an unrecorded
 * partial contributes its FEE to `billed` (it was genuinely asked for) and
 * contributes to NEITHER known bucket, so
 *
 *     knownCollected + knownOutstanding + unknownAmount === billed
 *
 * holds always, and `unknownAmount` is exactly the part of the month whose
 * fate nobody wrote down. The identity is the honesty: a screen cannot show
 * these three and accidentally imply the month adds up to something it does not.
 *
 * `unknownAmount` IS NOT A PAYMENT. It is not "the money not collected" and it
 * is not "what the partial paid" — it is the whole fee of a bill we know was
 * partly paid and cannot split. Reading it as either is the mistake this shape
 * exists to prevent.
 *
 * INTEGER ARITHMETIC THROUGHOUT. Every input is integer VND and only addition
 * and subtraction are used, so no rounding happens and none is needed. The one
 * division is the rate, which is rounded once, at the end, to a whole percent. */
export function totalsFor(bills: readonly BillLike[]): BillingTotals {
  let billed = 0;
  let knownCollected = 0;
  let knownOutstanding = 0;
  let unknownAmount = 0;
  let unknownAmountBills = 0;
  const counts: BillingStatusCounts = { paid: 0, partiallyPaid: 0, unpaid: 0, total: 0 };

  for (const bill of bills) {
    billed += bill.fee;
    counts.total++;
    /* `paid` counts bills SETTLED IN FULL and nothing else. A partial that
     * moved real money still does not make this number bigger — the caption it
     * feeds says "x of y bills paid", which is a statement about bills, while
     * its money is already in `knownCollected`. */
    if (bill.status === "Paid") counts.paid++;
    else if (bill.status === "Partially Paid") counts.partiallyPaid++;
    else if (bill.status === "Unpaid") counts.unpaid++;

    const collected = collectedFor(bill);
    if (collected === null) {
      unknownAmountBills++;
      unknownAmount += bill.fee;
    } else {
      knownCollected += collected;
      knownOutstanding += bill.fee - collected;
    }
  }

  const amountsComplete = unknownAmountBills === 0;
  const collectionRate = billed === 0 ? null : Math.round((knownCollected / billed) * 100);

  return {
    billed, knownCollected, knownOutstanding, unknownAmount, unknownAmountBills,
    amountsComplete, collectionRate, counts,
  };
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

/* ---------------------------------------------------------- the read model
 *
 * WHY THE SHAPING IS HERE AND NOT IN THE SERVICE. "Which bills raise a row,
 * which stay in the totals, and what does a row disclose" is the whole of the
 * ghost rule, and it is only provably correct if a test can reach it without a
 * database in the loop. So `finance-service.ts` fetches, hands the documents to
 * the function below, and returns what it gets back — the same split
 * `reviews.ts` / `reviews-service.ts` already draw with `buildReviewCards`.
 *
 * THE RESOLUTION IS THE CALLER'S. Students, classes and living parent ids arrive
 * already looked up, so this module still reaches no database. */

/** One bill, as a client may see it. Only bills whose student resolves become
 * one of these, so every field is safe to render. */
export interface BillingRow {
  billId: string;
  studentId: string;
  studentName: string;
  initials: string;
  avatarColor: string;
  classId: string;
  className: string;
  classColor: string;
  /** Integer VND, exactly as stored — a historical snapshot, never reconciled
   * with the class's fee today. */
  fee: number;
  status: BillingStatus;
  /** Recorded amount for a partial, or `null` when it was never recorded. */
  paidAmount: number | null;
  /** THIS null IS NOT THE AGGREGATE'S OLD null. A scope's totals never go null
   * any more — they report what is known and count what is not. A ROW is one
   * bill, and for one bill "the amount was never recorded" is an exact,
   * unambiguous fact with nothing to add up around it. The screen names the two
   * halves separately: nothing was written down (`Paid`), and so this cannot be
   * worked out (`Remaining`). Never a half, never a zero. */
  collected: number | null;
  outstanding: number | null;
  paidDate: string | null;
  notes: string;
  /** Whether this student's `parentId` resolves to a real Parent. Informational
   * only — it blocks nothing. No parent name, phone or email is carried, because
   * "is there somebody to talk to about this bill" is a boolean. */
  parentLinked: boolean;
}

/** How a scope's unrecorded partials split by whether their student resolves.
 *
 * TWO COUNTS BECAUSE THEY NEED TWO SENTENCES. "A partial payment has no
 * recorded amount" is something a teacher can go and fix; the same fact about a
 * record whose student is gone is a closed historical entry they cannot act on.
 * The screen says which, and says nothing at all about WHY the student is
 * missing — deleted, moved on, cleaned up, the data does not know and neither
 * does this module. */
export interface UnknownAmountSplit {
  /** Unrecorded partials belonging to students who still exist. */
  unknownLiveAmountBills: number;
  /** Unrecorded partials whose student no longer resolves. No id, no name. */
  unknownHistoricalAmountBills: number;
}

/** One class's tuition within the scope, plus the bills that may be named. */
export interface BillingClassBlock extends BillingTotals, UnknownAmountSplit {
  classId: string;
  className: string;
  classColor: string;
  /** Bills whose student resolves. Ghost bills are absent here and present in
   * every figure above. */
  rows: BillingRow[];
  hiddenRecords: number;
}

/** One student who still owes money. Live students only. */
export interface OutstandingStudentRow {
  billId: string;
  studentId: string;
  studentName: string;
  initials: string;
  avatarColor: string;
  classId: string;
  className: string;
  month: string;
  /** `fee` when Unpaid, `fee - paidAmount` for a recorded partial, and `null`
   * for a partial whose amount was never recorded — never a guess. */
  amount: number | null;
  parentLinked: boolean;
}

export interface FinanceBillingBranch extends BillingTotals, UnknownAmountSplit {
  perClass: BillingClassBlock[];
  outstandingStudents: OutstandingStudentRow[];
  rows: BillingRow[];
  /** Bills counted in every total above but named in no list, because their
   * student no longer resolves. What the design's "+N more" renders. */
  hiddenRecords: number;
}

/** Just enough of a Student to render a row. Narrower than `Student` so this
 * module cannot reach a field it has no business showing. */
export type BillingStudentRef = Pick<Student, "id" | "name" | "initials" | "avatarColor" | "parentId">;
/** Just enough of a Class. */
export type BillingClassRef = Pick<Klass, "id" | "name" | "color">;

export interface BillingResolution {
  students: readonly BillingStudentRef[];
  classes: readonly BillingClassRef[];
  /** Ids of Parent documents that actually exist. A `parentId` outside this set
   * is not a link (PROJECT_RULES, Student & Parents). */
  livingParentIds: ReadonlySet<string>;
}

const FALLBACK_COLOR = "var(--accent)";

/** Shape one scope's bills into the branch a Finance screen renders.
 *
 * TOTALS COUNT EVERY BILL; LISTS NAME ONLY THE RESOLVED ONES. That asymmetry is
 * the ghost rule, and it is deliberate: a deletion must not move a closed
 * month's figures, and a working list of who owes money cannot contain somebody
 * who is gone. The difference between the two is `hiddenRecords`, which is the
 * only thing about a ghost that ever reaches a client — no id, no name, no
 * former parent, and no placeholder row.
 *
 * NOTHING IS NORMALISED. A fee is summed and rendered exactly as stored, even
 * where it disagrees with its class's fee today. */
export function buildBillingBranch(
  bills: readonly Billing[],
  resolution: BillingResolution
): FinanceBillingBranch {
  const studentById = new Map(resolution.students.map((s) => [s.id, s]));
  const classById = new Map(resolution.classes.map((c) => [c.id, c]));
  const resolvedStudentIds = new Set(resolution.students.map((s) => s.id));
  const parentLinkedFor = (s: BillingStudentRef | undefined) =>
    !!s?.parentId && resolution.livingParentIds.has(s.parentId);

  const toRow = (b: Billing): BillingRow => {
    const s = studentById.get(b.studentId);
    const c = classById.get(b.classId);
    return {
      billId: b.id,
      studentId: b.studentId,
      studentName: s?.name ?? "",
      initials: s?.initials ?? "",
      avatarColor: s?.avatarColor || FALLBACK_COLOR,
      classId: b.classId,
      className: c?.name ?? b.classId,
      classColor: c?.color || FALLBACK_COLOR,
      fee: b.fee,
      status: b.status,
      paidAmount: typeof b.paidAmount === "number" ? b.paidAmount : null,
      collected: collectedFor(b),
      outstanding: outstandingFor(b),
      paidDate: b.paidDate ?? null,
      notes: b.notes ?? "",
      parentLinked: parentLinkedFor(s),
    };
  };

  /* Which of a scope's unrecorded partials a teacher could still go and fix,
   * and which are closed history. Counted here rather than in `totalsFor`,
   * because it needs the resolution and that module must not know about it. */
  const unknownSplit = (scope: readonly Billing[]): UnknownAmountSplit => {
    let unknownLiveAmountBills = 0;
    let unknownHistoricalAmountBills = 0;
    for (const b of scope) {
      if (!hasUnknownAmount(b)) continue;
      if (resolvedStudentIds.has(b.studentId)) unknownLiveAmountBills++;
      else unknownHistoricalAmountBills++;
    }
    return { unknownLiveAmountBills, unknownHistoricalAmountBills };
  };

  const totals = totalsFor(bills);
  const { listable, hiddenCount } = partitionByStudentResolution(bills, resolvedStudentIds);

  const perClass: BillingClassBlock[] = totalsByClass(bills).map((t) => {
    const c = classById.get(t.classId);
    const ofClass = bills.filter((b) => b.classId === t.classId);
    const split = partitionByStudentResolution(ofClass, resolvedStudentIds);
    return {
      ...t,
      ...unknownSplit(ofClass),
      className: c?.name ?? t.classId,
      classColor: c?.color || FALLBACK_COLOR,
      rows: split.listable.map(toRow),
      hiddenRecords: split.hiddenCount,
    };
  });

  const outstandingStudents: OutstandingStudentRow[] = listable
    .filter(isOutstanding)
    .map((b) => {
      const s = studentById.get(b.studentId);
      const c = classById.get(b.classId);
      return {
        billId: b.id,
        studentId: b.studentId,
        studentName: s?.name ?? "",
        initials: s?.initials ?? "",
        avatarColor: s?.avatarColor || FALLBACK_COLOR,
        classId: b.classId,
        className: c?.name ?? b.classId,
        month: b.month,
        amount: outstandingFor(b),
        parentLinked: parentLinkedFor(s),
      };
    });

  return {
    ...totals,
    ...unknownSplit(bills),
    perClass,
    outstandingStudents,
    rows: listable.map(toRow),
    hiddenRecords: hiddenCount,
  };
}

/* ------------------------------------------------- two deferred decisions
 *
 * Recorded here because both are DOMAIN questions this module would be the one
 * to answer, and because a rule that exists only in a gate transcript is a rule
 * the next person re-invents differently.
 *
 * 1. THE PAYMENT FORM'S CONTRACT, for the sprint that draws one. The comp has
 *    Record and Manage buttons and no form behind them, so no UI ships; the
 *    shape it must take is already fixed by the write rules below:
 *
 *      Unpaid          — collected is zero. No amount input at all: there is
 *                        nothing to type, and a field accepting one would be a
 *                        way to record a payment against a bill that had none.
 *      Partially Paid  — an amount is REQUIRED. One input, "Amount paid" /
 *                        "Số tiền đã trả", integer VND, strictly between zero
 *                        and the fee, beside a READ-ONLY remaining figure of
 *                        `fee - paidAmount`. Remaining is shown and never
 *                        typed: two independent inputs for one arithmetic
 *                        relationship is how records that contradict
 *                        themselves get written.
 *      Paid            — collected IS the fee. No amount input, for the same
 *                        reason as Unpaid and with the same consequence: the
 *                        value is derived from the status, not restated beside
 *                        it.
 *
 *    Every future partial is therefore exactly calculable, and the legacy
 *    records with no amount stay the only incomplete ones in the collection.
 *    They are not backfilled: nobody knows what those students paid.
 *
 * 2. WAIVED / EXEMPT TUITION IS NOT MODELLED, and must not be faked. A bill
 *    that will never be collected — waived, a student who stopped studying
 *    mid-month, a month a student was not billable for — is today indistinguishable
 *    from one that is simply unpaid, and `Unpaid` must not be overloaded to
 *    mean any of them: it would put money in `knownOutstanding` that nobody is
 *    ever going to chase, and no screen could tell the two apart afterwards.
 *
 *    Nor may a waiver be inferred from a MISSING STUDENT. A bill whose student
 *    no longer resolves proves only that: the student record is gone. Deleted,
 *    left, merged, cleaned up — the data says nothing, so neither does the UI.
 *
 *    A future sprint gives this its own field, e.g.
 *    `billingApplicability: "Billable" | "Waived"`, with its own write rules and
 *    its own effect on the totals above. Until then the honest answer is that
 *    the model cannot express it. */

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

/** What a teacher reads when a payment is refused, and the status it carries.
 *
 * `bill-missing` is the one 404 — and it is the SAME 404 a ghost bill gets, so
 * the id space discloses nothing. Everything else is a 422: the request named a
 * bill that exists and asked it to hold something it may not. */
export const PAYMENT_ERROR: Record<PaymentViolation, { status: number; message: string }> = {
  "bill-missing": { status: 404, message: "Bill not found" },
  "amount-required": { status: 422, message: "Enter how much was collected" },
  "amount-not-allowed": { status: 422, message: "Only a partial payment records an amount" },
  "amount-not-integer": { status: 422, message: "Enter a whole amount in VND" },
  "amount-out-of-range": { status: 422, message: "A partial payment must be more than zero and less than the fee" },
  "date-required": { status: 422, message: "Pick a payment date" },
  "date-not-allowed": { status: 422, message: "An unpaid bill has no payment date" },
  "date-in-future": { status: 422, message: "A payment date can't be in the future" },
};

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
