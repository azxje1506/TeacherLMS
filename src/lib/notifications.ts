/* Notifications — the headless derivation layer.
 *
 * Run with:  npm test  (tests/notifications.test.ts)
 *
 * WHAT THIS MODULE IS. A pure function over plain values, in the same shape as
 * `lib/reviews` and `buildDashboard`: domain rows in, an ordered notification
 * list out. It renders nothing, fetches nothing, reads no clock of its own and
 * touches no storage — the device-local read/dismiss half lives next door in
 * `lib/notification-state`, and the panel that draws any of this does not exist
 * yet. Everything here can be exercised with plain objects in a Node test.
 *
 * WHAT A NOTIFICATION IS. A LIVE DERIVED VIEW, never a record (PROJECT_RULES,
 * Notifications). Nothing is stored: a notification exists for exactly as long as
 * its source keeps qualifying, and stops existing the moment it does not. That is
 * why there is no Notification model, no collection and no API — the state is
 * already owned by Billing, Lesson and Review, and a second copy could disagree
 * with the first.
 *
 * DEPENDENCY DIRECTION IS ONE-WAY. Notifications imports Billing/Lesson/Review
 * semantics; none of those may ever import this. A notification is an opinion
 * ABOUT domain state and must never become part of it.
 *
 * NOTHING HERE MUTATES ITS INPUT. Every array this module returns is one it
 * built, and every sort runs on a copy — a derivation that reorders the caller's
 * lessons would be a write dressed up as a read.
 *
 * THE COPY IS NOT HERE, AND THAT IS DELIBERATE. A notification carries domain
 * VALUES (a name, a month, a date, an amount) and no sentences. Titles are
 * translated and formatted by the surface that draws them, through the existing
 * `t()` and the bound formatter — which is also why an id can never be built out
 * of one: the same notification must keep its identity when the teacher switches
 * to English, and a title-derived id would not.
 */

import { CURRENT_MONTH, NOTIFICATION_MAX, TODAY_ISO } from "./constants";
import { monthOf } from "./recurrence";
import { REVIEW_MONTH_WINDOW, canReviewStudent, isSelectableMonth, shiftMonth } from "./reviews";
import type { Billing, BillingStatus, Klass, Lesson, Review, Student } from "./types";

/* ------------------------------------------------------------------- types */

/** The three types the contract ships. A fourth is a contract change, not a
 * feature — which is why this is a closed union and not a string. */
export type NotificationType = "tuition" | "makeup" | "review";

/** The type ranking, stated once. Lower sorts first. */
const TYPE_RANK: Record<NotificationType, number> = { tuition: 0, makeup: 1, review: 2 };

/** Where a notification opens. These are EXISTING routes, and Gate 2 records the
 * destination without navigating to it — no router is imported here. */
export type NotificationHref = "/finance" | "/calendar" | `/reviews/new?studentId=${string}`;

/** One derived notification.
 *
 * FLAT AND NULLABLE rather than a discriminated union, because the panel maps one
 * list of mixed types through one comparator and one dedup pass; a union would
 * make the common half of that generic code fight the type system for no reader's
 * benefit. Which fields a type populates is documented per field.
 *
 * `readonly` throughout: a notification is a value, and nothing downstream —
 * including the acknowledgement layer — may edit one in place. */
export interface AppNotification {
  /** The stable derived id. See `notificationId`. */
  readonly id: string;
  readonly type: NotificationType;
  /** The entity this is ABOUT: `Billing.id`, `Lesson.id`, `Student.id`. */
  readonly sourceId: string;
  /** The period that distinguishes two notifications from one source, or `null`
   * when the source id alone is already the whole identity. */
  readonly context: string | null;
  /** The name the panel shows — a stored domain value, never a translated word.
   * Falls back to the referenced id when the entity is gone, the same way the
   * Dashboard's upcoming list does, so a real unpaid bill is never silently
   * dropped because its student was deleted. */
  readonly subject: string;
  readonly studentId: string | null;
  readonly classId: string | null;
  /** `YYYY-MM` for tuition and review; `null` for makeup. */
  readonly month: string | null;
  /** ISO `YYYY-MM-DD` for makeup; `null` otherwise. */
  readonly date: string | null;
  /** 24h `HH:MM` for makeup; `null` otherwise. */
  readonly start: string | null;
  /** VND owed, tuition only. Integer VND exactly as Billing stores it — this is a
   * reference to the bill's own figure and never a recomputation of it. */
  readonly amount: number | null;
  readonly billingStatus: BillingStatus | null;
  readonly href: NotificationHref;
  /** SORT METADATA. The within-type ordering key, precomputed so the comparator
   * reads one field instead of re-deciding per type what "first" means.
   *
   * All three types happen to want ASCENDING on their own key — the oldest
   * unpaid month, the nearest makeup, the oldest outstanding review period — so
   * one ascending comparison serves all three rather than three branches. */
  readonly sortKey: string;
}

/** What derivation reads. A narrow structural type rather than `AllData`: this
 * module has no business knowing that attendance, homework or activity exist,
 * and a caller assembling five arrays should not have to invent the other four. */
export interface NotificationSources {
  readonly students: readonly Student[];
  readonly classes: readonly Klass[];
  readonly lessons: readonly Lesson[];
  readonly billing: readonly Billing[];
  readonly reviews: readonly Review[];
}

/** The application clock, as an argument.
 *
 * NO CLOCK OF ITS OWN, exactly as `lib/reviews` refuses one: a test states the
 * day it means instead of tracking `TODAY_ISO`, and the defaults are the same
 * canonical constants every other module already reads. Sprint 12 introduces no
 * configurable timezone and no second clock. */
export interface NotificationClock {
  /** ISO `YYYY-MM-DD`. */
  readonly today: string;
  /** `YYYY-MM`. */
  readonly month: string;
}

export const DEFAULT_NOTIFICATION_CLOCK: NotificationClock = { today: TODAY_ISO, month: CURRENT_MONTH };

/** How far ahead a makeup lesson counts as "upcoming": the next 7 calendar days,
 * INCLUSIVE, measured from the application day. */
export const MAKEUP_WINDOW_DAYS = 7;

/** Billing statuses that owe money. `Paid` is the whole of the complement, and
 * the exhaustiveness check below is what keeps that true if a fourth status is
 * ever added — a new status would otherwise silently join `Paid` in generating
 * nothing, which is the quiet kind of wrong. */
export const UNPAID_BILLING_STATUSES = ["Unpaid", "Partially Paid"] as const satisfies readonly BillingStatus[];

/** Every status is either owing or `Paid`; nothing is unclassified. */
export type UnclassifiedBillingStatus = Exclude<
  BillingStatus,
  (typeof UNPAID_BILLING_STATUSES)[number] | "Paid"
>;
export const BILLING_STATUSES_ARE_CLASSIFIED: UnclassifiedBillingStatus extends never ? true : never = true;

/* ---------------------------------------------------------------- identity */

/** The stable derived id: type, source identity, and the period only where the
 * source id is not already the whole story.
 *
 * DETERMINISTIC AND PRESENTATION-FREE. No index, no render order, no UUID, no
 * `Date.now()`, no translated or formatted text — the same qualifying source
 * produces the same id on every reload, which is the only reason a dismissed
 * item stays dismissed and a read item stays read. */
export function notificationId(type: NotificationType, sourceId: string, context: string | null = null): string {
  return context == null ? `${type}:${sourceId}` : `${type}:${sourceId}:${context}`;
}

/* --------------------------------------------------------------------- date */

/** The ISO date `days` after `iso`, through the local-midnight parse this
 * codebase already uses for date arithmetic (`lib/generate`, `lib/recurrence`),
 * so month and year rollover behave the way every other date here does. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- deriving */

/** A. UNPAID TUITION — one notification per Billing record that still owes.
 *
 * `Unpaid` and `Partially Paid` qualify; `Paid` never does. The bill's own id is
 * the whole identity, because a Billing record is already unique per student,
 * class and month — appending the month would be a second copy of a value the
 * bill owns, and a second copy is a thing that can disagree.
 *
 * ORDER: oldest month first, so the most overdue obligation leads. */
function deriveTuition(src: NotificationSources, studentName: (id: string) => string): AppNotification[] {
  const owing = new Set<string>(UNPAID_BILLING_STATUSES);
  return src.billing
    .filter((b) => owing.has(b.status))
    .map((b) => ({
      id: notificationId("tuition", b.id),
      type: "tuition" as const,
      sourceId: b.id,
      context: null,
      subject: studentName(b.studentId),
      studentId: b.studentId,
      classId: b.classId,
      month: b.month,
      date: null,
      start: null,
      amount: b.fee,
      billingStatus: b.status,
      href: "/finance" as const,
      /* `?? ""` because `Billing.month` is typed `string` but is not required by
       * the schema, and an undefined sort key threw in the comparator as soon as
       * a second notification existed for one to be compared against.
       *
       * THE BILL STILL SURFACES. Money owed is the whole point of this type and
       * the rule turns on `status`, not on the month, so a bill with no month is
       * reported rather than dropped — it sorts first, which is where an
       * anomalous record belongs, and the row simply omits the month it does not
       * have. */
      sortKey: b.month ?? "",
    }));
}

/** B. UPCOMING MAKEUP — a makeup lesson inside the next 7 days, inclusive.
 *
 * `status === "Upcoming"` is doing three jobs at once and is the reason there is
 * no separate cancelled or completed check: `Cancelled` is excluded because it is
 * not `Upcoming`, and a lesson already taught is `Completed` for the same reason.
 * It is the predicate the Dashboard's own upcoming list uses.
 *
 * RETIREMENT NEEDS NO PREDICATE. Retiring a lesson is a hard delete
 * (RECURRENCE_DESIGN), so a retired lesson is absent from `src.lessons` and
 * cannot be filtered — there is no `retired` flag to read, and inventing one
 * would be a schema change this sprint is forbidden.
 *
 * THE WINDOW IS INCLUSIVE AT BOTH ENDS. Today counts, because a lesson today is
 * still to be taught — the convention `isPastDate` states — and day 7 counts,
 * because the contract says the next seven days inclusive. Day 8 does not.
 * Comparison is lexicographic on ISO dates, as everywhere else here.
 *
 * THE DATE IS PART OF THE IDENTITY. A makeup moved to a different day is new
 * information the teacher has not seen, so it gets a new id and is not suppressed
 * by a dismissal of the lesson at its old date. That is the contract's "if the
 * same source later produces a genuinely new notification identity, that new item
 * is not automatically dismissed", applied to the one field a reschedule changes.
 *
 * ORDER: nearest first, by date then start time. */
function deriveMakeup(src: NotificationSources, clock: NotificationClock, className: (id: string) => string): AppNotification[] {
  const horizon = addDays(clock.today, MAKEUP_WINDOW_DAYS);
  return src.lessons
    .filter((l) => l.type === "makeup" && l.status === "Upcoming" && l.date >= clock.today && l.date <= horizon)
    .map((l) => ({
      id: notificationId("makeup", l.id, l.date),
      type: "makeup" as const,
      sourceId: l.id,
      context: l.date,
      subject: className(l.classId),
      studentId: null,
      classId: l.classId,
      month: null,
      date: l.date,
      start: l.start,
      amount: null,
      billingStatus: null,
      href: "/calendar" as const,
      sortKey: `${l.date} ${l.start}`,
    }));
}

/** C. REVIEW DUE — a completed month a reviewable student still has no review for.
 *
 * WHICH MONTHS ARE EVEN ASKED ABOUT is Reviews' own window and not a second
 * definition of one: `isSelectableMonth` is the twelve-month create window, and
 * `monthsAgo` is the same arithmetic Reviews uses everywhere. A month outside that
 * window cannot have a review written for it at all, so a notification asking for
 * one would be a promise the application cannot keep.
 *
 * COMPLETED MEANS STRICTLY BEHIND THE APPLICATION MONTH — `monthsAgo >= 1`. The
 * current month is deliberately excluded: it is still being taught, and the
 * Dashboard's `reviewsToWrite` (which counts the CURRENT month) is answering a
 * different question on purpose. Neither number is derived from the other.
 *
 * WHICH STUDENTS is `canReviewStudent`, the same gate the create path uses:
 * Archived students cannot be given a new review, so telling the teacher one is
 * due would again be a promise that cannot be kept.
 *
 * AND ONLY FOR A MONTH THAT WAS ACTUALLY TAUGHT. This is what "the EXPECTED
 * Review" turns on, and it is the difference between a useful bell and a useless
 * one: without it, every eligible student is due a review for all eleven
 * completed months in the window whether or not they were enrolled or taught, and
 * the real seed data produces 113 notifications — a badge nobody can act on. With
 * it the same data produces 36, and every one of them names a month the student
 * was genuinely taught and nobody has written up. Two existing facts bound it,
 * and neither is a new rule:
 *
 *  - the student was on the roster of a class that COMPLETED a lesson that month;
 *  - the month is not before the month the student joined.
 *
 * The second is needed because `Klass.studentIds` is the roster as it stands
 * TODAY — the data model keeps no membership history — so a recently added
 * student would otherwise inherit their class's whole taught past. `joined` is
 * the only record of when they actually arrived. Both bounds narrow which months
 * are EXPECTED and change no Reviews rule: the composer still offers all twelve
 * months for anyone, exactly as it does today.
 *
 * ORDER: oldest outstanding period first. */
function deriveReview(src: NotificationSources, clock: NotificationClock): AppNotification[] {
  const reviewed = new Set(src.reviews.map((r) => `${r.studentId}:${r.month}`));
  const taught = taughtMonths(src);
  const out: AppNotification[] = [];

  for (const student of src.students) {
    if (!canReviewStudent(student)) continue;
    /* A STUDENT WITH NO `joined` IS SKIPPED, and this guard is not theoretical:
     * `joined` is typed `string` but the Mongoose schema does not mark it
     * required, so a document without one is legal and `monthOf(undefined)` threw
     * on `.slice`. Because derivation runs in the authenticated layout, that took
     * out every page rather than just the bell.
     *
     * SKIPPING IS THE RIGHT FAILURE, not a defensive default. The approved rule
     * requires that the student had already joined; with no join date that cannot
     * be established, and claiming a review is due would be asserting something
     * unknown. It fails closed, exactly as `canReviewStudent` and
     * `isSelectableMonth` do. */
    if (typeof student.joined !== "string" || student.joined === "") continue;
    const joinedMonth = monthOf(student.joined);

    /* Back from the month before the application month to the far edge of the
     * create window. `back` starts at 1 because month 0 is the current one, and
     * the bound is Reviews' own window constant rather than a repeated 12. */
    for (let back = 1; back < REVIEW_MONTH_WINDOW; back++) {
      const month = shiftMonth(clock.month, -back);
      if (month == null || !isSelectableMonth(month, clock.month)) continue;
      if (month < joinedMonth) continue;
      const pair = `${student.id}:${month}`;
      if (!taught.has(pair)) continue;
      if (reviewed.has(pair)) continue;
      out.push({
        id: notificationId("review", student.id, month),
        type: "review" as const,
        sourceId: student.id,
        context: month,
        subject: student.name,
        studentId: student.id,
        classId: null,
        month,
        date: null,
        start: null,
        amount: null,
        billingStatus: null,
        href: `/reviews/new?studentId=${student.id}` as const,
        sortKey: month,
      });
    }
  }
  return out;
}

/** `studentId:YYYY-MM` for every month a student was actually taught in.
 *
 * COMPLETED LESSONS ONLY. A cancelled lesson was not taught, and an upcoming one
 * has not been yet — neither creates anything to review. Membership comes from
 * the class roster, which is the only place it is recorded; see `deriveReview`
 * for why `joined` has to bound it as well. */
function taughtMonths(src: NotificationSources): Set<string> {
  const roster = new Map(src.classes.map((c) => [c.id, c.studentIds]));
  const taught = new Set<string>();
  for (const lesson of src.lessons) {
    if (lesson.status !== "Completed") continue;
    const students = roster.get(lesson.classId);
    if (!students) continue;
    const month = monthOf(lesson.date);
    for (const studentId of students) taught.add(`${studentId}:${month}`);
  }
  return taught;
}

/* ------------------------------------------------------- order / dedup / cap */

/** The total order: type rank, then the type's own ascending key, then the stable
 * id as the final tie-breaker.
 *
 * NOTHING READS INPUT ORDER. Two notifications that compare equal on rank and key
 * are separated by their ids, which are derived from source identity — so the
 * result is a function of the data alone and a shuffled input produces the same
 * list. Database natural order can never leak through. */
export function compareNotifications(a: AppNotification, b: AppNotification): number {
  const rank = TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (rank !== 0) return rank;
  /* `?? ""` on both sides even though the type says `string`. That is not
   * belt-and-braces: the domain types make the same promise about `Billing.month`
   * and the database does not keep it, so a value typed `string` reaching here as
   * `undefined` is the case that actually happened. A comparator is also the one
   * function that must never throw — `Array.prototype.sort` gives no way to
   * recover, and this one runs inside the authenticated layout. */
  const key = (a.sortKey ?? "").localeCompare(b.sortKey ?? "");
  if (key !== 0) return key;
  return a.id.localeCompare(b.id);
}

/** One logical source and context, one notification. Deduplication is on the
 * stable id and nothing else, so repeated rows, a merged double fetch or two
 * derivation passes collapse to the same single item. First occurrence wins;
 * because ids are derived from source identity, the duplicates are equal anyway. */
export function dedupeNotifications(list: readonly AppNotification[]): AppNotification[] {
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  for (const n of list) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/** THE ACTIVE SET: every currently qualifying notification, deduped and ordered.
 *
 * Not capped. The cap is a property of the panel, not of the data, and the unread
 * badge has to be able to count past it — see `presentNotifications` in
 * `lib/notification-state`. */
export function deriveNotifications(
  src: NotificationSources,
  clock: NotificationClock = DEFAULT_NOTIFICATION_CLOCK
): AppNotification[] {
  const studentById = new Map(src.students.map((s) => [s.id, s]));
  const classById = new Map(src.classes.map((c) => [c.id, c]));
  const studentName = (id: string) => studentById.get(id)?.name ?? id;
  const className = (id: string) => classById.get(id)?.name ?? id;

  const all = [
    ...deriveTuition(src, studentName),
    ...deriveMakeup(src, clock, className),
    ...deriveReview(src, clock),
  ];
  /* `dedupeNotifications` already returns a fresh array, so this sorts a list
   * this function owns and never the caller's rows. */
  return dedupeNotifications(all).sort(compareNotifications);
}

/** The presentation cap, re-exported from the one place caps live. */
export { NOTIFICATION_MAX };
