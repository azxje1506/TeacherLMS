/* Notifications — the headless derivation engine.
 *
 * Run with:  npm test
 *
 * NO BROWSER, NO DOM, NO DATABASE, NO RENDER. `deriveNotifications` is a pure
 * function over plain values and takes its clock as an argument, so every rule
 * below is driven with hand-built rows and an explicit application day — a test
 * states the month it means rather than tracking `CURRENT_MONTH`, which is the
 * convention `lib/reviews` set and the reason its own tests survive the calendar.
 *
 * FIXTURES ARE DEEP-FROZEN. The contract's hardest promise is that a notification
 * is a READ: derivation must not reorder, edit or otherwise touch the caller's
 * rows. A frozen fixture turns "we did not mutate" from a claim into a throw, and
 * `.sort()` on a caller's array is exactly the accident it catches.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_NOTIFICATION_CLOCK,
  MAKEUP_WINDOW_DAYS,
  NOTIFICATION_MAX,
  UNPAID_BILLING_STATUSES,
  addDays,
  compareNotifications,
  dedupeNotifications,
  deriveNotifications,
  notificationId,
} from "../src/lib/notifications";
import type { AppNotification, NotificationSources } from "../src/lib/notifications";
import { CURRENT_MONTH, TODAY_ISO } from "../src/lib/constants";
import type { Billing, BillingStatus, Klass, Lesson, LessonStatus, LessonType, Review, Student } from "../src/lib/types";

/* --------------------------------------------------------------- fixtures */

/** The application day every test below reasons from, stated rather than read. */
const TODAY = "2026-07-10";
const MONTH = "2026-07";
const CLOCK = { today: TODAY, month: MONTH } as const;

/** Recursively frozen, so any in-place write throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function student(id: string, over: Partial<Student> = {}): Student {
  return {
    id, first: id, last: "X", name: `Name ${id}`, initials: "NX", birthday: "2015-01-01", age: 11,
    school: "S", grade: 3, gradeLabel: "Grade 3", parentId: "p1", parentName: "P", phone: "",
    status: "Active", notes: "", joined: "2020-01-01", ...over,
  } as Student;
}

function klass(id: string, studentIds: string[], over: Partial<Klass> = {}): Klass {
  return { id, name: `Class ${id}`, studentIds, status: "Active", ...over } as Klass;
}

function lesson(id: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id, classId: "c1", type: "makeup" as LessonType, date: TODAY, start: "09:00", duration: 60,
    classroom: "R1", status: "Upcoming" as LessonStatus, ...over,
  } as Lesson;
}

function bill(id: string, over: Partial<Billing> = {}): Billing {
  return {
    id, studentId: "s1", classId: "c1", month: "2026-06", fee: 1_500_000,
    status: "Unpaid" as BillingStatus, paidDate: null, ...over,
  } as Billing;
}

function review(studentId: string, month: string): Review {
  return { id: `r-${studentId}-${month}`, studentId, month, skills: {}, comment: "c", strengths: "", improvements: "", goals: "", parentNotes: "" };
}

/** A source set with everything empty unless the test supplies it. */
function sources(over: Partial<NotificationSources> = {}): NotificationSources {
  return deepFreeze({ students: [], classes: [], lessons: [], billing: [], reviews: [], ...over });
}

/** A class that completed a lesson in `month`, so its roster counts as taught
 * then — the precondition every review-due test needs. */
function taughtIn(months: string[], classId = "c1"): Lesson[] {
  return months.map((m, i) => lesson(`taught-${classId}-${m}-${i}`, { classId, type: "regular", date: `${m}-15`, status: "Completed" }));
}

const ids = (list: readonly AppNotification[]) => list.map((n) => n.id);

/* ================================================================ identity */

describe("Notifications · stable derived identity", () => {
  it("1. the id is type, source and period — and nothing else", () => {
    assert.equal(notificationId("tuition", "B-1"), "tuition:B-1");
    assert.equal(notificationId("makeup", "L-1", "2026-07-12"), "makeup:L-1:2026-07-12");
    assert.equal(notificationId("review", "s1", "2026-06"), "review:s1:2026-06");
  });

  it("2. deriving twice from the same data produces identical ids", () => {
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      lessons: [...taughtIn(["2026-06"]), lesson("L1", { date: "2026-07-12" })],
      billing: [bill("B1")],
    });
    assert.deepEqual(ids(deriveNotifications(src, CLOCK)), ids(deriveNotifications(src, CLOCK)));
  });

  it("3. ids survive a shuffled input unchanged, in the same order", () => {
    const students = [student("s1"), student("s2"), student("s3")];
    const classes = [klass("c1", ["s1", "s2", "s3"])];
    const lessons = [...taughtIn(["2026-04", "2026-05", "2026-06"]), lesson("L1", { date: "2026-07-11" }), lesson("L2", { date: "2026-07-14" })];
    const billing = [bill("B1", { month: "2026-03" }), bill("B2", { month: "2026-05" }), bill("B3", { month: "2026-06" })];
    const forward = deriveNotifications(sources({ students, classes, lessons, billing }), CLOCK);
    const reversed = deriveNotifications(
      sources({ students: [...students].reverse(), classes, lessons: [...lessons].reverse(), billing: [...billing].reverse() }),
      CLOCK
    );
    assert.deepEqual(ids(forward), ids(reversed));
    assert.ok(forward.length > 5, "the fixture is big enough for order to matter");
  });

  it("4. no id contains a translated or formatted string", () => {
    /* The subject IS a stored name, and a name must never leak into an id — that
     * is what would break when the teacher switches to English. */
    const src = sources({
      students: [student("s1", { name: "Nguyễn Văn A" })], classes: [klass("c1", ["s1"])],
      lessons: taughtIn(["2026-06"]), billing: [bill("B1")],
    });
    for (const n of deriveNotifications(src, CLOCK)) {
      assert.ok(!n.id.includes(n.subject), `${n.id} must not embed the subject`);
      assert.match(n.id, /^(tuition|makeup|review):[\w.:-]+$/, `${n.id} is machine-shaped`);
    }
  });

  it("5. different review periods produce different ids for one student", () => {
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      lessons: taughtIn(["2026-05", "2026-06"]),
    });
    const got = ids(deriveNotifications(src, CLOCK));
    assert.deepEqual(got, ["review:s1:2026-05", "review:s1:2026-06"]);
  });

  it("6. a makeup moved to another day is a NEW identity", () => {
    const at = (date: string) => deriveNotifications(sources({ classes: [klass("c1", [])], lessons: [lesson("L1", { date })] }), CLOCK);
    assert.deepEqual(ids(at("2026-07-12")), ["makeup:L1:2026-07-12"]);
    assert.deepEqual(ids(at("2026-07-14")), ["makeup:L1:2026-07-14"]);
  });
});

/* ================================================================= tuition */

describe("Notifications · unpaid tuition", () => {
  const withBills = (billing: Billing[]) =>
    deriveNotifications(sources({ students: [student("s1")], classes: [klass("c1", ["s1"])], billing }), CLOCK);

  it("7. Unpaid qualifies", () => {
    assert.deepEqual(ids(withBills([bill("B1", { status: "Unpaid" })])), ["tuition:B1"]);
  });

  it("8. Partially Paid qualifies", () => {
    assert.deepEqual(ids(withBills([bill("B1", { status: "Partially Paid" })])), ["tuition:B1"]);
  });

  it("9. Paid never qualifies", () => {
    assert.deepEqual(withBills([bill("B1", { status: "Paid" })]), []);
  });

  it("10. the owing set is exactly the two statuses, and Paid is the whole complement", () => {
    assert.deepEqual([...UNPAID_BILLING_STATUSES], ["Unpaid", "Partially Paid"]);
  });

  it("11. one qualifying record produces at most one notification", () => {
    assert.equal(withBills([bill("B1")]).length, 1);
  });

  it("12. it disappears when the record stops qualifying", () => {
    assert.equal(withBills([bill("B1", { status: "Unpaid" })]).length, 1);
    assert.equal(withBills([bill("B1", { status: "Paid" })]).length, 0);
  });

  it("13. older months come first", () => {
    const got = withBills([
      bill("B-new", { month: "2026-06" }), bill("B-old", { month: "2026-02" }), bill("B-mid", { month: "2026-04" }),
    ]);
    assert.deepEqual(got.map((n) => n.month), ["2026-02", "2026-04", "2026-06"]);
  });

  it("14. same month falls back to the stable id, never to input order", () => {
    const forward = withBills([bill("B-z", { month: "2026-05" }), bill("B-a", { month: "2026-05" })]);
    const back = withBills([bill("B-a", { month: "2026-05" }), bill("B-z", { month: "2026-05" })]);
    assert.deepEqual(ids(forward), ["tuition:B-a", "tuition:B-z"]);
    assert.deepEqual(ids(forward), ids(back));
  });

  it("15. it carries the bill's own figures and never recomputes them", () => {
    const [n] = withBills([bill("B1", { fee: 2_400_000, status: "Partially Paid" })]);
    assert.equal(n!.amount, 2_400_000);
    assert.equal(n!.billingStatus, "Partially Paid");
    assert.equal(n!.href, "/finance");
  });

  it("16. a bill whose student is gone still surfaces, named by the id it references", () => {
    const got = deriveNotifications(sources({ billing: [bill("B1", { studentId: "ghost" })] }), CLOCK);
    assert.equal(got.length, 1, "real money owed is never dropped for a missing name");
    assert.equal(got[0]!.subject, "ghost");
  });
});

/* ================================================================== makeup */

describe("Notifications · upcoming makeup", () => {
  const at = (over: Partial<Lesson>) =>
    deriveNotifications(sources({ classes: [klass("c1", [])], lessons: [lesson("L1", over)] }), CLOCK);

  it("17. the window is 7 days", () => {
    assert.equal(MAKEUP_WINDOW_DAYS, 7);
  });

  it("18. today qualifies — a lesson today is still to be taught", () => {
    assert.deepEqual(ids(at({ date: TODAY })), ["makeup:L1:2026-07-10"]);
  });

  it("19. +1 day qualifies", () => {
    assert.equal(at({ date: "2026-07-11" }).length, 1);
  });

  it("20. +7 days qualifies — the window is inclusive", () => {
    assert.equal(addDays(TODAY, 7), "2026-07-17");
    assert.equal(at({ date: "2026-07-17" }).length, 1);
  });

  it("21. +8 days does not", () => {
    assert.equal(at({ date: "2026-07-18" }).length, 0);
  });

  it("22. an already-passed lesson does not", () => {
    assert.equal(at({ date: "2026-07-09" }).length, 0);
  });

  it("23. a cancelled lesson does not", () => {
    assert.equal(at({ date: "2026-07-12", status: "Cancelled" }).length, 0);
  });

  it("24. a completed lesson does not, even dated inside the window", () => {
    assert.equal(at({ date: "2026-07-12", status: "Completed" }).length, 0);
  });

  it("25. a retired lesson does not — because a retired lesson is not in the data", () => {
    /* Retirement is a hard delete (RECURRENCE_DESIGN), so there is no flag to
     * filter on. The absence of the row IS the exclusion, and this states it so
     * nobody later adds a `retired` field believing one was missed. */
    assert.equal(deriveNotifications(sources({ classes: [klass("c1", [])], lessons: [] }), CLOCK).length, 0);
  });

  it("26. a regular or extra lesson never qualifies, however near", () => {
    assert.equal(at({ date: "2026-07-12", type: "regular" }).length, 0);
    assert.equal(at({ date: "2026-07-12", type: "extra" }).length, 0);
  });

  it("27. nearest first, then by start time", () => {
    const got = deriveNotifications(sources({
      classes: [klass("c1", [])],
      lessons: [
        lesson("L-late", { date: "2026-07-16", start: "09:00" }),
        lesson("L-soon-pm", { date: "2026-07-11", start: "16:00" }),
        lesson("L-soon-am", { date: "2026-07-11", start: "08:00" }),
      ],
    }), CLOCK);
    assert.deepEqual(ids(got), ["makeup:L-soon-am:2026-07-11", "makeup:L-soon-pm:2026-07-11", "makeup:L-late:2026-07-16"]);
  });

  it("28. it carries the class name and opens the calendar", () => {
    const [n] = deriveNotifications(sources({
      classes: [klass("c1", [], { name: "Advanced B2" })], lessons: [lesson("L1", { date: "2026-07-12" })],
    }), CLOCK);
    assert.equal(n!.subject, "Advanced B2");
    assert.equal(n!.href, "/calendar");
    assert.equal(n!.date, "2026-07-12");
  });

  it("29. addDays crosses a month and a year boundary the way the rest of the app does", () => {
    assert.equal(addDays("2026-07-28", 7), "2026-08-04");
    assert.equal(addDays("2026-12-29", 7), "2027-01-05");
    assert.equal(addDays("2028-02-26", 7), "2028-03-04", "a leap year is still 29 days");
  });
});

/* ============================================================== review due */

describe("Notifications · review due", () => {
  const forStudent = (over: Partial<Student> = {}, reviews: Review[] = [], months = ["2026-06"]) =>
    deriveNotifications(sources({
      students: [student("s1", over)], classes: [klass("c1", ["s1"])], lessons: taughtIn(months), reviews,
    }), CLOCK);

  it("30. a completed month with no review appears", () => {
    assert.deepEqual(ids(forStudent()), ["review:s1:2026-06"]);
  });

  it("31. an existing review removes it", () => {
    assert.deepEqual(forStudent({}, [review("s1", "2026-06")]), []);
  });

  it("32. the CURRENT month is never due — it is still being taught", () => {
    assert.deepEqual(forStudent({}, [], ["2026-07"]), [], "July is the application month");
  });

  it("33. a month the student was not taught in is not due", () => {
    /* Taught in June only; May is inside the window and unreviewed, and still
     * produces nothing because nothing happened in it. */
    assert.deepEqual(ids(forStudent({}, [], ["2026-06"])), ["review:s1:2026-06"]);
  });

  it("34. a month before the student joined is not due", () => {
    const got = forStudent({ joined: "2026-06-01" }, [], ["2026-05", "2026-06"]);
    assert.deepEqual(ids(got), ["review:s1:2026-06"], "May pre-dates the student");
  });

  it("35. an Archived student is never due — a new review cannot be written", () => {
    assert.deepEqual(forStudent({ status: "Archived" }), []);
  });

  it("36. Active, Trial and Paused students are all due", () => {
    for (const status of ["Active", "Trial", "Paused"] as const) {
      assert.equal(forStudent({ status }).length, 1, status);
    }
  });

  it("37. a month outside Reviews' own 12-month window is not due", () => {
    /* 2025-07 is twelve months back from 2026-07 and cannot be written at all, so
     * asking for it would be a promise the composer could not keep. */
    const got = forStudent({ joined: "2020-01-01" }, [], ["2025-07", "2025-08", "2026-06"]);
    assert.ok(!ids(got).includes("review:s1:2025-07"), "the far edge is excluded");
    assert.ok(ids(got).includes("review:s1:2025-08"), "eleven months back is still inside");
  });

  it("38. multiple due periods sort oldest first", () => {
    const got = forStudent({}, [], ["2026-06", "2026-03", "2026-05"]);
    assert.deepEqual(got.map((n) => n.month), ["2026-03", "2026-05", "2026-06"]);
  });

  it("39. a saved review generates nothing of its own", () => {
    /* Every month taught AND reviewed: the reviews themselves must not become a
     * notification telling the teacher about work they just did. */
    assert.deepEqual(forStudent({}, [review("s1", "2026-06"), review("s1", "2026-05")], ["2026-05", "2026-06"]), []);
  });

  it("40. it opens the existing composer for that student and creates nothing", () => {
    const [n] = forStudent();
    assert.equal(n!.href, "/reviews/new?studentId=s1");
    assert.equal(n!.studentId, "s1");
    assert.equal(n!.month, "2026-06");
  });

  it("41. only completed lessons count as taught", () => {
    const notTaught = (status: LessonStatus) => deriveNotifications(sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      lessons: [lesson("L1", { classId: "c1", type: "regular", date: "2026-06-15", status })],
    }), CLOCK);
    assert.equal(notTaught("Completed").length, 1);
    assert.equal(notTaught("Cancelled").length, 0, "a cancelled lesson was not taught");
    assert.equal(notTaught("Upcoming").length, 0, "an upcoming lesson has not been taught yet");
  });
});

/* ================================================================== dedupe */

describe("Notifications · deduplication", () => {
  it("42. a repeated source row produces one notification", () => {
    const got = deriveNotifications(sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      billing: [bill("B1"), bill("B1"), bill("B1")],
    }), CLOCK);
    assert.deepEqual(ids(got), ["tuition:B1"]);
  });

  it("43. a duplicated review period produces one notification", () => {
    const got = deriveNotifications(sources({
      students: [student("s1"), student("s1")], classes: [klass("c1", ["s1"])], lessons: taughtIn(["2026-06"]),
    }), CLOCK);
    assert.deepEqual(ids(got), ["review:s1:2026-06"]);
  });

  it("44. dedupe is on the stable id and keeps the first occurrence", () => {
    const a = { id: "x", subject: "first" } as unknown as AppNotification;
    const b = { id: "x", subject: "second" } as unknown as AppNotification;
    const got = dedupeNotifications([a, b]);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.subject, "first");
  });

  it("45. dedupe returns a fresh array and never edits the one it was given", () => {
    const input = deepFreeze([{ id: "a" }, { id: "b" }] as unknown as AppNotification[]);
    const got = dedupeNotifications(input);
    assert.notEqual(got, input);
    assert.deepEqual(ids(got), ["a", "b"]);
  });
});

/* ================================================================== order */

describe("Notifications · global ordering", () => {
  const mixed = () => sources({
    students: [student("s1")],
    classes: [klass("c1", ["s1"])],
    lessons: [...taughtIn(["2026-05"]), lesson("L1", { date: "2026-07-12" })],
    billing: [bill("B1", { month: "2026-04" })],
  });

  it("46. tuition, then makeup, then review", () => {
    const got = deriveNotifications(mixed(), CLOCK);
    assert.deepEqual(got.map((n) => n.type), ["tuition", "makeup", "review"]);
  });

  it("47. type rank beats the within-type key", () => {
    /* The review period (2026-05) is OLDER than the bill's month (2026-04)? No —
     * but the makeup's July date sorts after both, and it still lands second,
     * which only the type rank can explain. */
    const got = deriveNotifications(mixed(), CLOCK);
    assert.equal(got[1]!.type, "makeup");
    assert.ok(got[1]!.sortKey > got[2]!.sortKey, "and it outranks a lexically smaller key");
  });

  it("48. a shuffled input produces byte-identical output", () => {
    const src = mixed();
    const shuffled = sources({
      students: src.students, classes: src.classes,
      lessons: [...src.lessons].reverse(), billing: [...src.billing].reverse(), reviews: [],
    });
    assert.deepEqual(
      JSON.stringify(deriveNotifications(src, CLOCK)),
      JSON.stringify(deriveNotifications(shuffled, CLOCK))
    );
  });

  it("49. the comparator is a total order — reversing the pair reverses the sign", () => {
    const got = deriveNotifications(mixed(), CLOCK);
    for (const a of got) {
      for (const b of got) {
        /* `+ 0` normalises the negation's `-0`, which `assert.equal` compares by
         * `Object.is` and would otherwise report as a failure against `0`. */
        const sign = Math.sign(compareNotifications(a, b)) + 0;
        assert.equal(sign, -Math.sign(compareNotifications(b, a)) + 0, `${a.id} vs ${b.id}`);
        if (a.id === b.id) assert.equal(sign, 0);
      }
    }
  });
});

/* ============================================================== no mutation */

describe("Notifications · derivation is a read", () => {
  it("50. frozen source rows survive derivation untouched", () => {
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      lessons: [...taughtIn(["2026-05", "2026-06"]), lesson("L1", { date: "2026-07-12" })],
      billing: [bill("B1"), bill("B2", { month: "2026-03" })],
      reviews: [review("s1", "2026-05")],
    });
    const before = JSON.stringify(src);
    const got = deriveNotifications(src, CLOCK);
    assert.ok(got.length > 0, "the fixture actually produced something");
    assert.equal(JSON.stringify(src), before, "not one source row changed");
  });

  it("51. the returned array is the engine's own, not an alias of an input", () => {
    const billing = [bill("B1")];
    const src = sources({ billing });
    const got = deriveNotifications(src, CLOCK);
    assert.notEqual(got as unknown, src.billing as unknown);
    assert.notEqual(got as unknown, src.lessons as unknown);
  });
});

/* ============================================ malformed rows (Gate 5 audit) */

describe("Notifications · a schema-legal but incomplete row cannot take the app down", () => {
  /* WHY THIS BLOCK EXISTS. Derivation runs in `(app)/layout.tsx`, the layout for
   * EVERY authenticated route, so anything it throws on is not a broken bell — it
   * is a 500 on every page. The domain types promise `string` for fields the
   * Mongoose schema does not mark `required` (only `id` is), so a document
   * without them is legal today and the types are not evidence.
   *
   * Both cases below were found by the Gate 5 audit against adversarial input,
   * not by review, and both threw before the fix. */

  it("56. a student with no `joined` is skipped, not thrown on", () => {
    /* `monthOf(undefined)` threw on `.slice`. Skipping is the right failure: the
     * approved rule requires the student had already joined, and with no join
     * date that cannot be established. */
    for (const joined of [undefined, null, ""]) {
      const src = sources({
        students: [{ ...student("s1"), joined } as unknown as Student],
        classes: [klass("c1", ["s1"])],
        lessons: taughtIn(["2026-06"]),
      });
      assert.deepEqual(deriveNotifications(src, CLOCK), [], `joined=${JSON.stringify(joined)}`);
    }
  });

  it("57. a well-formed student beside a malformed one is still reported", () => {
    /* The guard must skip the record, not abandon the pass. */
    const src = sources({
      students: [{ ...student("bad"), joined: undefined } as unknown as Student, student("s2")],
      classes: [klass("c1", ["bad", "s2"])],
      lessons: taughtIn(["2026-06"]),
    });
    assert.deepEqual(ids(deriveNotifications(src, CLOCK)), ["review:s2:2026-06"]);
  });

  it("58. a bill with no month still surfaces, and does not break the comparator", () => {
    /* `sortKey` was `undefined`, and `undefined.localeCompare` threw — but only
     * once a SECOND notification existed for the comparator to run against, which
     * is why a single-row fixture would have missed it. Money owed is reported
     * rather than dropped: the rule turns on `status`, not on the month. */
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      billing: [
        { ...bill("B1"), month: undefined } as unknown as Billing,
        { ...bill("B2"), month: undefined } as unknown as Billing,
      ],
    });
    const got = deriveNotifications(src, CLOCK);
    assert.deepEqual(ids(got), ["tuition:B1", "tuition:B2"]);
  });

  it("58a. and every derived notification carries a STRING sort key", () => {
    /* THE ASSERTION THAT DISTINGUISHES THE TWO FIXES. Tests 58 and 59 pass with
     * the construction guard reverted, because the comparator's own `?? ""`
     * catches it — mutation-testing showed exactly that, and a guard that cannot
     * tell which fix it is testing is not testing either.
     *
     * This pins the construction: an `AppNotification` typed `sortKey: string`
     * must not be handed one that is `undefined`. The comparator's guard is the
     * last line of defence, not the contract. */
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      billing: [{ ...bill("B1"), month: undefined } as unknown as Billing],
      lessons: [...taughtIn(["2026-06"]), lesson("L1", { date: "2026-07-12" })],
    });
    const got = deriveNotifications(src, CLOCK);
    assert.ok(got.length >= 3, "all three types are present");
    for (const n of got) {
      assert.equal(typeof n.sortKey, "string", `${n.id} has a string sort key`);
      assert.equal(typeof n.id, "string");
      assert.equal(typeof n.href, "string");
    }
  });

  it("59. a monthless bill sorts first, where an anomalous record belongs", () => {
    const src = sources({
      students: [student("s1")], classes: [klass("c1", ["s1"])],
      billing: [bill("B-dated", { month: "2026-02" }), { ...bill("B-none"), month: undefined } as unknown as Billing],
    });
    assert.deepEqual(ids(deriveNotifications(src, CLOCK)), ["tuition:B-none", "tuition:B-dated"]);
  });

  it("60. the comparator itself never throws on a missing key", () => {
    /* Asserted directly, because a comparator is the one function that cannot
     * recover: `Array.prototype.sort` offers no way to catch it. */
    const a = { id: "a", type: "tuition", sortKey: undefined } as unknown as AppNotification;
    const b = { id: "b", type: "tuition", sortKey: undefined } as unknown as AppNotification;
    assert.doesNotThrow(() => compareNotifications(a, b));
    assert.equal(Math.sign(compareNotifications(a, b)), -1, "and still falls through to the id");
  });

  it("61. a lesson with a missing date or start is handled without throwing", () => {
    const src = sources({
      classes: [klass("c1", [])],
      lessons: [
        lesson("L1", { date: "2026-07-12", start: "09:00" }),
        { ...lesson("L2"), date: undefined } as unknown as Lesson,
        { ...lesson("L3"), date: "2026-07-13", start: undefined } as unknown as Lesson,
      ],
    });
    let got: AppNotification[] = [];
    assert.doesNotThrow(() => { got = deriveNotifications(src, CLOCK); });
    assert.ok(ids(got).includes("makeup:L1:2026-07-12"), "the good one is reported");
    assert.ok(!ids(got).some((id) => id.startsWith("makeup:L2")), "a dateless lesson is outside the window");
  });

  it("62. an entirely empty source set derives nothing and throws nothing", () => {
    assert.deepEqual(deriveNotifications(sources(), CLOCK), []);
  });
});

/* ================================================================== clock */

describe("Notifications · the application clock is an argument", () => {
  it("52. the default clock is the app's canonical one and no second clock exists", () => {
    assert.deepEqual(DEFAULT_NOTIFICATION_CLOCK, { today: TODAY_ISO, month: CURRENT_MONTH });
  });

  it("53. moving the clock moves the makeup window with it", () => {
    const src = sources({ classes: [klass("c1", [])], lessons: [lesson("L1", { date: "2026-08-03" })] });
    assert.equal(deriveNotifications(src, CLOCK).length, 0, "August is far away on 10 July");
    assert.equal(deriveNotifications(src, { today: "2026-07-28", month: "2026-07" }).length, 1, "and near on 28 July");
  });

  it("54. the module reads no clock of its own", () => {
    /* Both derivation paths that care about time take it from the argument, so a
     * fixture dated around a different day behaves exactly as that day. */
    const src = sources({ students: [student("s1")], classes: [klass("c1", ["s1"])], lessons: taughtIn(["2026-01"]) });
    assert.deepEqual(ids(deriveNotifications(src, { today: "2026-02-10", month: "2026-02" })), ["review:s1:2026-01"]);
    assert.deepEqual(deriveNotifications(src, { today: "2026-01-10", month: "2026-01" }), [], "January is not yet complete");
  });
});

/* ==================================================================== cap */

describe("Notifications · the cap is not the engine's job", () => {
  it("55. the active set is never truncated by derivation", () => {
    const billing = Array.from({ length: 25 }, (_, i) => bill(`B${String(i).padStart(2, "0")}`, { month: "2026-05" }));
    const got = deriveNotifications(sources({ students: [student("s1")], classes: [klass("c1", ["s1"])], billing }), CLOCK);
    assert.equal(got.length, 25, `derivation returns all 25, not ${NOTIFICATION_MAX}`);
  });
});
