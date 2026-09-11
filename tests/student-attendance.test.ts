/* Sprint 13 Gate 3 — the Student Profile Attendance read model.
 *
 * Run with:  npm test
 *
 * TWO KINDS OF ASSERTION, as elsewhere in this suite: the derivation rules are
 * EXECUTED over fixtures, and the "reads only, writes nothing" guarantees — which
 * cannot be expressed as a function call — are scanned.
 *
 * THE CROSS-MODULE IDENTITY IS THE POINT OF SECTION 6. The Attendance tab and the
 * Reviews learning journey show the same student's attendance, and a claim that
 * they agree is worth nothing unless it is run. So the identity is proved rather
 * than asserted about: the payload's own numerator and denominator are compared
 * against `studentAttendanceRate`, the shipped helper Reviews reads.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildStudentAttendance, PROFILE_LIST_LIMIT, PROFILE_MONTH_WINDOW, PROFILE_TIMELINE_LIMIT,
} from "../src/lib/student-profile";
import { studentAttendanceRate } from "../src/lib/finance";
import type { AttendanceRecord, AttendanceStatus, Klass, Lesson } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PURE = code("src", "lib", "student-profile.ts");
const SERVICE = code("src", "lib", "student-profile-service.ts");
const ROUTE = code("src", "app", "api", "attendance", "student", "[studentId]", "route.ts");

/* ------------------------------------------------------------------ fixtures */

const APP_MONTH = "2026-07";
const CLASSES: Pick<Klass, "id" | "name">[] = [
  { id: "c1", name: "Grammar Stars" },
  { id: "c2", name: "Reading Club" },
];

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1", classId: "c1", type: "regular", date: "2026-07-03", start: "18:00",
    duration: 90, classroom: "Room A", status: "Completed", notes: "",
    ...over,
  } as Lesson;
}

/** A register, written the way the app writes one: `lessonId` plus entries. */
function register(
  lessonId: string,
  entries: Record<string, AttendanceStatus | { status: AttendanceStatus; note: string }>,
  extra: Record<string, unknown> = {}
): AttendanceRecord {
  return {
    lessonId,
    entries: Object.fromEntries(
      Object.entries(entries).map(([sid, v]) =>
        [sid, typeof v === "string" ? { status: v, note: "" } : v]
      )
    ),
    ...extra,
  } as unknown as AttendanceRecord;
}

const build = (lessons: Lesson[], attendance: AttendanceRecord[], studentId = "s1") =>
  buildStudentAttendance({ studentId, classes: CLASSES, lessons, attendance, appMonth: APP_MONTH });

/* =========================================================================
 * 1. Scope — whose lessons count
 * ====================================================================== */

describe("Attendance read model — scope", () => {
  it("1. only lessons of the student's own classes contribute", () => {
    const lessons = [lesson({ id: "l1", classId: "c1" }), lesson({ id: "l9", classId: "cX" })];
    const r = build(lessons, [register("l1", { s1: "Present" }), register("l9", { s1: "Absent" })]);
    assert.equal(r.entries, 1, "the foreign class's lesson is not in scope");
    assert.equal(r.counts.present, 1);
    assert.equal(r.counts.absent, 0, "the Absent on cX never reaches the tally");
    assert.deepEqual(r.timeline.map((t) => t.lessonId), ["l1"]);
  });

  it("2. only COMPLETED lessons contribute", () => {
    const lessons = [
      lesson({ id: "l1", status: "Completed" }),
      lesson({ id: "l2", status: "Upcoming" }),
      lesson({ id: "l3", status: "Cancelled" }),
    ];
    const r = build(lessons, [
      register("l1", { s1: "Present" }),
      register("l2", { s1: "Absent" }),
      register("l3", { s1: "Absent" }),
    ]);
    assert.equal(r.entries, 1);
    assert.equal(r.counts.absent, 0, "a register on a non-completed lesson is not attendance");
  });

  it("3. another student's entries never surface, counted or listed", () => {
    /* The ghost rule: entries belonging to students who no longer exist are
     * preserved in the database, and asking for one student must never read
     * another's key. */
    const lessons = [lesson({ id: "l1" })];
    const r = build(lessons, [register("l1", { s1: "Present", "deleted-9": "Absent", s2: "Missing" as AttendanceStatus })]);
    assert.equal(r.entries, 1, "only s1's own entry");
    assert.equal(r.counts.absent, 0);
    assert.equal(r.timeline.length, 1);
    assert.ok(!JSON.stringify(r).includes("deleted-9"), "no other id reaches the payload");
  });

  it("4. a lesson whose class did not resolve is dropped rather than rendered nameless", () => {
    const r = build([lesson({ id: "l1", classId: "gone" })], [register("l1", { s1: "Present" })]);
    assert.equal(r.entries, 0);
    assert.deepEqual(r.timeline, []);
  });

  it("5. nothing is invented where no register exists", () => {
    const r = build([lesson({ id: "l1" }), lesson({ id: "l2", date: "2026-07-10" })], [register("l1", { s1: "Present" })]);
    assert.equal(r.entries, 1, "the unregistered lesson contributes no entry");
  });
});

/* =========================================================================
 * 2. The counting rule
 * ====================================================================== */

describe("Attendance read model — what counts as attended", () => {
  const lessons = [
    lesson({ id: "l1", date: "2026-07-01" }),
    lesson({ id: "l2", date: "2026-07-02" }),
    lesson({ id: "l3", date: "2026-07-03" }),
    lesson({ id: "l4", date: "2026-07-04" }),
  ];
  const attendance = [
    register("l1", { s1: "Present" }),
    register("l2", { s1: "Late" }),
    register("l3", { s1: "Excused" }),
    register("l4", { s1: "Absent" }),
  ];

  it("6. Present, Late and Excused attend; Absent does not", () => {
    const r = build(lessons, attendance);
    assert.equal(r.attended, 3, "Present + Late + Excused");
    assert.equal(r.entries, 4);
    assert.equal(r.rate, 75);
  });

  it("7. the four raw counts are the four statuses, tallied", () => {
    const r = build(lessons, attendance);
    assert.deepEqual(r.counts, { present: 1, late: 1, absent: 1, excused: 1 });
  });

  it("8. the tally and the shipped rule agree — attended and total are the same numbers", () => {
    /* The tally above is a convenience; the percentage is the shipped helper's.
     * If they could disagree, one of them would be lying. */
    const r = build(lessons, attendance);
    assert.equal(r.counts.present + r.counts.late + r.counts.excused, r.attended);
    assert.equal(r.counts.present + r.counts.late + r.counts.absent + r.counts.excused, r.entries);
  });

  it("9. no qualifying entries reports null, never 0", () => {
    const r = build([lesson({ id: "l1" })], []);
    assert.equal(r.rate, null, "nobody took a register is not the same as missed everything");
    assert.notEqual(r.rate, 0);
    assert.equal(r.entries, 0);
    assert.equal(r.hasRecords, false);
  });

  it("10. a student who attended nothing is 0, and that IS a claim the data made", () => {
    const r = build([lesson({ id: "l1" })], [register("l1", { s1: "Absent" })]);
    assert.equal(r.rate, 0);
    assert.equal(r.hasRecords, true, "they have a record; it just says Absent");
  });
});

/* =========================================================================
 * 3. The Lesson owns the date
 * ====================================================================== */

describe("Attendance read model — date ownership", () => {
  it("11. Lesson.date wins over the legacy AttendanceRecord.date mirror", () => {
    /* Some stored registers carry a `date` that disagrees with their lesson,
     * because rescheduling moves the Lesson and never touched the register. The
     * read model must report the date the lesson was actually taught. */
    const lessons = [lesson({ id: "l1", date: "2026-07-20" })];
    const attendance = [register("l1", { s1: "Present" }, { date: "2026-03-01" })];
    const r = build(lessons, attendance);
    assert.equal(r.timeline[0].date, "2026-07-20", "the lesson's date, not the mirror's");
    assert.ok(!JSON.stringify(r).includes("2026-03-01"), "the mirror reaches nothing");
  });

  it("12. the mirror does not decide the month bucket either", () => {
    const lessons = [lesson({ id: "l1", date: "2026-07-20" })];
    const attendance = [register("l1", { s1: "Present" }, { date: "2026-03-01" })];
    const r = build(lessons, attendance);
    const july = r.monthly.find((m) => m.month === "2026-07");
    const march = r.monthly.find((m) => m.month === "2026-03");
    assert.equal(july?.entries, 1);
    assert.equal(march?.entries, 0, "March has nothing — the mirror was never read");
  });

  it("13. the source never reads the record's own date", () => {
    assert.ok(!/rec\.date|record\.date/.test(PURE), "the legacy mirror is not addressed at all");
    assert.ok(PURE.includes("lesson.date"), "the lesson supplies it");
  });
});

/* =========================================================================
 * 4. Monthly chart
 * ====================================================================== */

describe("Attendance read model — the six-month chart", () => {
  it("14. exactly six points, oldest first, ending at the application month", () => {
    const r = build([lesson({ id: "l1" })], [register("l1", { s1: "Present" })]);
    assert.equal(r.monthly.length, PROFILE_MONTH_WINDOW);
    assert.equal(PROFILE_MONTH_WINDOW, 6);
    assert.deepEqual(
      r.monthly.map((m) => m.month),
      ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]
    );
  });

  it("15. a month with no data reports null, not 0", () => {
    const r = build([lesson({ id: "l1", date: "2026-07-03" })], [register("l1", { s1: "Present" })]);
    for (const point of r.monthly) {
      if (point.month === "2026-07") {
        assert.equal(point.rate, 100);
        assert.equal(point.entries, 1);
      } else {
        assert.equal(point.rate, null, `${point.month} had no entry and must not claim 0%`);
        assert.equal(point.entries, 0);
      }
    }
  });

  it("16. each point equals the shipped helper for that month", () => {
    const lessons = [
      lesson({ id: "l1", date: "2026-05-04" }),
      lesson({ id: "l2", date: "2026-05-11" }),
      lesson({ id: "l3", date: "2026-06-01" }),
    ];
    const attendance = [
      register("l1", { s1: "Present" }),
      register("l2", { s1: "Absent" }),
      register("l3", { s1: "Late" }),
    ];
    const r = build(lessons, attendance);
    for (const point of r.monthly) {
      const shipped = studentAttendanceRate("s1", point.month, { lessons, attendance });
      assert.equal(point.rate, shipped.pct, `${point.month} must be the helper's own answer`);
      assert.equal(point.attended, shipped.attended);
      assert.equal(point.entries, shipped.total);
    }
  });

  it("17. a cross-year window is contiguous", () => {
    const r = buildStudentAttendance({
      studentId: "s1", classes: CLASSES, lessons: [], attendance: [], appMonth: "2026-01",
    });
    assert.deepEqual(
      r.monthly.map((m) => m.month),
      ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]
    );
  });
});

/* =========================================================================
 * 5. Ordering, caps and the two lists
 * ====================================================================== */

describe("Attendance read model — ordering and caps", () => {
  it("18. the timeline is newest first", () => {
    const lessons = [
      lesson({ id: "l1", date: "2026-05-01" }),
      lesson({ id: "l2", date: "2026-07-01" }),
      lesson({ id: "l3", date: "2026-06-01" }),
    ];
    const r = build(lessons, lessons.map((l) => register(l.id, { s1: "Present" })));
    assert.deepEqual(r.timeline.map((t) => t.date), ["2026-07-01", "2026-06-01", "2026-05-01"]);
  });

  it("19. two lessons on one day tie-break on id, deterministically", () => {
    const lessons = [
      lesson({ id: "lb", date: "2026-07-01" }),
      lesson({ id: "la", date: "2026-07-01" }),
      lesson({ id: "lc", date: "2026-07-01" }),
    ];
    const forward = build(lessons, lessons.map((l) => register(l.id, { s1: "Present" })));
    const reversed = build([...lessons].reverse(), [...lessons].reverse().map((l) => register(l.id, { s1: "Present" })));
    assert.deepEqual(forward.timeline.map((t) => t.lessonId), ["la", "lb", "lc"]);
    assert.deepEqual(
      forward.timeline.map((t) => t.lessonId),
      reversed.timeline.map((t) => t.lessonId),
      "input order must not change the answer — the database's order is never trusted"
    );
  });

  it("20. the timeline caps at 20 and the caps change no aggregate", () => {
    const lessons = Array.from({ length: 30 }, (_, i) =>
      lesson({ id: `l${String(i).padStart(2, "0")}`, date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` })
    );
    const r = build(lessons, lessons.map((l) => register(l.id, { s1: "Present" })));
    assert.equal(r.timeline.length, PROFILE_TIMELINE_LIMIT);
    assert.equal(PROFILE_TIMELINE_LIMIT, 20);
    assert.equal(r.entries, 30, "every entry still counts");
    assert.equal(r.attended, 30);
    assert.equal(r.rate, 100);
    assert.equal(r.counts.present, 30);
  });

  it("21. Recent absences is Absent only — Excused is never filed as an absence", () => {
    const lessons = [
      lesson({ id: "l1", date: "2026-07-01" }),
      lesson({ id: "l2", date: "2026-07-02" }),
      lesson({ id: "l3", date: "2026-07-03" }),
    ];
    const r = build(lessons, [
      register("l1", { s1: "Absent" }),
      register("l2", { s1: "Excused" }),
      register("l3", { s1: "Late" }),
    ]);
    assert.deepEqual(r.absences.map((a) => a.status), ["Absent"]);
    assert.ok(!r.absences.some((a) => a.status === "Excused"), "Excused attends everywhere else in this app");
    assert.deepEqual(r.lates.map((a) => a.status), ["Late"]);
  });

  it("22. both side cards cap at 5, newest first, without moving a count", () => {
    const lessons = Array.from({ length: 8 }, (_, i) =>
      lesson({ id: `a${i}`, date: `2026-07-0${i + 1}` })
    );
    const r = build(lessons, lessons.map((l) => register(l.id, { s1: "Absent" })));
    assert.equal(r.absences.length, PROFILE_LIST_LIMIT);
    assert.equal(PROFILE_LIST_LIMIT, 5);
    assert.equal(r.absences[0].date, "2026-07-08", "newest first");
    assert.equal(r.counts.absent, 8, "the cap is presentation only");
    assert.equal(r.entries, 8);
  });

  it("23. a note is carried when recorded and absent when not — never invented", () => {
    const lessons = [lesson({ id: "l1", date: "2026-07-02" }), lesson({ id: "l2", date: "2026-07-01" })];
    const r = build(lessons, [
      register("l1", { s1: { status: "Absent", note: "Family commitment" } }),
      register("l2", { s1: "Absent" }),
    ]);
    assert.equal(r.absences[0].note, "Family commitment");
    assert.ok(!("note" in r.absences[1]), "an empty note is omitted rather than sent as an empty string");
  });

  it("24. every row names its class", () => {
    const r = build([lesson({ id: "l1", classId: "c2" })], [register("l1", { s1: "Present" })]);
    assert.equal(r.timeline[0].className, "Reading Club");
    assert.equal(r.timeline[0].classId, "c2");
  });
});

/* =========================================================================
 * 6. Cross-module agreement with the Reviews learning journey
 * ====================================================================== */

describe("Attendance read model — it agrees with the Reviews learning journey", () => {
  const lessons = [
    lesson({ id: "l1", date: "2026-06-02" }),
    lesson({ id: "l2", date: "2026-06-09" }),
    lesson({ id: "l3", date: "2026-06-16" }),
    lesson({ id: "l4", date: "2026-07-07" }),
    lesson({ id: "l5", date: "2026-07-14" }),
  ];
  const attendance = [
    register("l1", { s1: "Present" }),
    register("l2", { s1: "Absent" }),
    register("l3", { s1: "Excused" }),
    register("l4", { s1: "Late" }),
    register("l5", { s1: "Present" }),
  ];

  it("25. the headline figure is the shipped helper summed, exactly", () => {
    /* The identity that stops the same fact appearing as two different numbers:
     * the Reviews tab shows `studentAttendanceRate` per month, this tab shows the
     * whole record, and the second must be the first added up. */
    const r = build(lessons, attendance);
    let attended = 0, total = 0;
    for (const month of ["2026-06", "2026-07"]) {
      const m = studentAttendanceRate("s1", month, { lessons, attendance });
      attended += m.attended;
      total += m.total;
    }
    assert.equal(r.attended, attended);
    assert.equal(r.entries, total);
    assert.equal(r.rate, Math.round((attended / total) * 100));
  });

  it("26. and it holds when a month in the middle is empty", () => {
    const sparse = [lesson({ id: "l1", date: "2026-02-02" }), lesson({ id: "l2", date: "2026-07-02" })];
    const regs = [register("l1", { s1: "Absent" }), register("l2", { s1: "Present" })];
    const r = build(sparse, regs);
    assert.equal(r.entries, 2);
    assert.equal(r.attended, 1);
    assert.equal(r.rate, 50);
    assert.equal(r.monthly.find((m) => m.month === "2026-04")?.rate, null);
  });
});

/* =========================================================================
 * 7. Reads only — scanned, because it cannot be called
 * ====================================================================== */

describe("Attendance read model — it writes nothing", () => {
  it("27. the pure module reaches no database, clock, network or storage", () => {
    for (const forbidden of ["Model", "mongoose", "dbConnect", "fetch(", "localStorage", "readFileSync"]) {
      assert.ok(!PURE.includes(forbidden), `${forbidden} has no place in the pure core`);
    }
    assert.ok(!/new Date\s*\(|Date\.now\s*\(/.test(PURE), "no clock — appMonth is an argument");
  });

  it("28. the service performs no write verb of any kind", () => {
    const writes = [...SERVICE.matchAll(
      /\b(\w+Model)\.(updateOne|updateMany|create|insertMany|bulkWrite|deleteOne|deleteMany|findOneAndUpdate|replaceOne|save)/g
    )].map((m) => `${m[1]}.${m[2]}`);
    assert.deepEqual(writes, [], "a profile view must never mutate anything");
  });

  it("29. and it advances no lesson lifecycle", () => {
    for (const forbidden of ["advanceLessonLifecycle", "ensureRegularLessons", "reconcile", "lifecycle"]) {
      assert.ok(!SERVICE.includes(forbidden), `${forbidden} must not run on a profile read`);
    }
  });

  it("30. the read is bounded — one query per collection, never one per lesson", () => {
    const finds = [...SERVICE.matchAll(/\b(\w+Model)\.(find|findOne)\b/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(finds)].sort(),
      ["AttendanceModel", "ClassModel", "HomeworkModel", "LessonModel", "StudentModel"]
    );
    assert.ok(!/for\s*\([^)]*\)\s*\{[^}]*await\s+\w+Model/.test(SERVICE), "no query inside a loop");
    assert.ok(SERVICE.includes(".lean<"), "documents come back plain");
    assert.ok(SERVICE.includes(".select("), "and narrowed");
  });

  it("31. the endpoint is session-guarded, read-only, and 404s an unresolvable student", () => {
    assert.ok(ROUTE.includes("requireSession"), "behind the session");
    assert.ok(ROUTE.includes("handle("), "errors normalise the standard way");
    assert.ok(ROUTE.includes('error("Student not found", 404)'), "the repository's own sentence");
    for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.ok(!new RegExp(`export async function ${verb}\\b`).test(ROUTE), `${verb} must not exist`);
    }
    assert.ok(ROUTE.includes("export async function GET"), "GET, and only GET");
  });

  it("32. the client cannot reach the service or a model directly", () => {
    assert.ok(SERVICE.includes('import "server-only"'), "the service stays off the client");
  });
});

/* =========================================================================
 * 7. Gate 6.2 — the two shapes human QA actually hit
 *
 * Both reports compared this tab against `Student.attendance`, a STORED seed
 * field that no code derives from attendance records (its only write is the
 * pass-through in `students.ts`, and the seed ships Henry at 92 and Isabella at
 * 99). The contract's agreement clause names `studentAttendanceRate`, not that
 * field, and these tests pin the agreement against the helper under the exact
 * structural conditions the two students have — modelled as domain shapes, never
 * as names or ids.
 * ====================================================================== */

describe("Attendance read model — the shapes Gate 6.1 human QA hit", () => {
  it("33. a student whose only class is Archived has NO lessons, and both paths say null", () => {
    /* THE "HENRY" SHAPE. An Archived class generates no lessons, so the student
     * has no completed lesson, no register names them, and there is nothing to
     * rate. The empty state here is CORRECT — and it must be reached because the
     * record is genuinely empty, not because a stored percentage disagrees. */
    const r = build([], []);
    assert.equal(r.rate, null, "no entries is no percentage, never 0%");
    assert.equal(r.hasRecords, false, "and the tab may show its empty state");
    assert.equal(r.entries, 0);

    const ref = studentAttendanceRate("s1", APP_MONTH, { lessons: [], attendance: [] });
    assert.equal(ref.pct, null, "the shipped helper says the same thing");
    assert.equal(r.rate, ref.pct, "the two surfaces agree: both have no answer");
  });

  it("34. a student with entries is NEVER reported empty, whatever any stored field says", () => {
    /* The §13 empty-state contract, stated as a guard: emptiness follows the
     * ENTRIES, and nothing else. One register naming the student is enough. */
    const lessons = [lesson({ id: "l1", date: "2026-07-03" })];
    const r = build(lessons, [register("l1", { s1: "Absent" })]);
    assert.equal(r.hasRecords, true, "one stored entry is a record, even an Absent one");
    assert.equal(r.entries, 1);
    assert.equal(r.rate, 0, "0% is a real answer here — it is not the empty state");
  });

  it("35. a spotless record is exactly 100, on both paths", () => {
    /* THE "ISABELLA" SHAPE. Every completed lesson registered, every entry
     * Present. The helper and this tab must both say 100 — the reported 99 came
     * from the stored seed field, which measures nothing. */
    const lessons = Array.from({ length: 20 }, (_, i) =>
      lesson({ id: `l${i}`, date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }));
    const attendance = lessons.map((l) => register(l.id, { s1: "Present" }));
    const r = build(lessons, attendance);
    assert.equal(r.rate, 100);
    assert.equal(r.counts.present, 20);
    assert.equal(r.entries, 20);

    const ref = studentAttendanceRate("s1", APP_MONTH, { lessons, attendance });
    assert.equal(ref.pct, 100);
    assert.equal(r.rate, ref.pct, "no off-by-one between the two surfaces");
  });

  it("36. the two paths agree on EVERY mixed shape, not just the fixture's", () => {
    /* The guard that would have caught a real divergence. The previous agreement
     * test proved the identity on one hand-written fixture; this walks a spread
     * of shapes — all-present, all-absent, one-of-each, unregistered lessons,
     * and a student named by no register at all. */
    const STATUSES: AttendanceStatus[] = ["Present", "Late", "Absent", "Excused"];
    for (let n = 0; n <= 8; n++) {
      for (let skip = 0; skip <= 2; skip++) {
        const lessons = Array.from({ length: n }, (_, i) =>
          lesson({ id: `l${i}`, date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}` }));
        const attendance = lessons
          .filter((_, i) => i % (skip + 1) === 0)
          .map((l, i) => register(l.id, { s1: STATUSES[i % 4] }));
        const r = build(lessons, attendance);
        const ref = studentAttendanceRate("s1", APP_MONTH, { lessons, attendance });
        assert.equal(r.rate, ref.pct, `rate disagreed at n=${n} skip=${skip}`);
        assert.equal(r.attended, ref.attended, `numerator disagreed at n=${n} skip=${skip}`);
        assert.equal(r.entries, ref.total, `denominator disagreed at n=${n} skip=${skip}`);
        assert.equal(r.hasRecords, ref.total > 0, `emptiness disagreed at n=${n} skip=${skip}`);
      }
    }
  });
});
