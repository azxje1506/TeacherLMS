/* Sprint 13 Gate 3 — the Student Profile Homework read model.
 *
 * Run with:  npm test
 *
 * THE TWO QUESTIONS THIS SUITE KEEPS APART, because the module does:
 *
 *   - "what is THIS STUDENT's status for this assignment?" — answered by
 *     `studentHomeworkOutcome`, read out of the submissions map, and the thing a
 *     timeline row and the four count tiles are made of;
 *   - "does this assignment count towards their COMPLETION?" — answered by the
 *     shipped `studentHomeworkCompletion`, which is stricter, because an
 *     assignment still `Assigned` at the top level has had no outcome recorded
 *     for anybody.
 *
 * They are allowed to disagree, and section 4 proves the disagreement is the
 * banked one: `total` legitimately exceeds `completed + late + missing`.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildStudentHomework, studentHomeworkOutcome,
  PROFILE_LIST_LIMIT, PROFILE_TIMELINE_LIMIT,
} from "../src/lib/student-profile";
import { studentHomeworkCompletion } from "../src/lib/finance";
import type { Homework, Klass } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PURE = code("src", "lib", "student-profile.ts");
const SERVICE = code("src", "lib", "student-profile-service.ts");
const ROUTE = code("src", "app", "api", "homework", "student", "[studentId]", "route.ts");
const HW_SERVICE = code("src", "lib", "homework-service.ts");

/* ------------------------------------------------------------------ fixtures */

const CLASSES: Pick<Klass, "id" | "name">[] = [
  { id: "c1", name: "Grammar Stars" },
  { id: "c2", name: "Reading Club" },
];

function homework(over: Partial<Homework> = {}): Homework {
  return {
    id: "hw1", title: "Unit 3", description: "", classId: "c1", lessonId: null,
    scope: "class", studentId: null, dueDate: "2026-07-10", status: "Completed",
    submissions: {}, teacherNotes: "", createdAt: "2026-07-01",
    ...over,
  };
}

const build = (hw: Homework[], studentId = "s1") =>
  buildStudentHomework({ studentId, classes: CLASSES, homework: hw });

/* =========================================================================
 * 1. Whose work it is
 * ====================================================================== */

describe("Homework read model — scope and ownership", () => {
  it("1. a class-scoped assignment is this student's only when the map names them", () => {
    const hw = [homework({ id: "h1", submissions: { s1: "Completed", s2: "Missing" } })];
    const r = build(hw);
    assert.equal(r.counts.total, 1);
    assert.equal(r.timeline[0].status, "Completed", "s1's own outcome");
  });

  it("2. NO KEY MEANS NOT THEIRS — the assignment is omitted, and nothing is invented", () => {
    /* Membership is the snapshot taken when the work was set. A student enrolled
     * afterwards has no key, and a missing key is evidence rather than a gap to
     * fill: it must not become `Assigned`. */
    const hw = [homework({ id: "h1", submissions: { s2: "Completed" } })];
    const r = build(hw);
    assert.equal(r.counts.total, 0, "not addressed to s1 at all");
    assert.deepEqual(r.timeline, []);
    assert.equal(r.hasRecords, false);
    assert.equal(studentHomeworkOutcome(hw[0], "s1"), null);
    assert.notEqual(studentHomeworkOutcome(hw[0], "s1"), "Assigned");
  });

  it("3. an empty submissions map addresses nobody", () => {
    const r = build([homework({ id: "h1", submissions: {} })]);
    assert.equal(r.counts.total, 0);
  });

  it("4. a student-scoped assignment is theirs only when studentId names them", () => {
    const mine = homework({ id: "h1", scope: "student", studentId: "s1", status: "Late" });
    const theirs = homework({ id: "h2", scope: "student", studentId: "s2", status: "Missing" });
    const r = build([mine, theirs]);
    assert.equal(r.counts.total, 1);
    assert.equal(r.counts.late, 1);
    assert.equal(r.counts.missing, 0, "s2's work never reaches s1's record");
    assert.equal(studentHomeworkOutcome(theirs, "s1"), null);
  });

  it("5. another student's submission key never surfaces", () => {
    const hw = [homework({ id: "h1", submissions: { s1: "Completed", "deleted-9": "Missing" } })];
    const r = build(hw);
    assert.equal(r.counts.missing, 0);
    assert.ok(!JSON.stringify(r).includes("deleted-9"), "no other id reaches the payload");
  });

  it("6. every row names its class, and an unresolved class is not invented", () => {
    const r = build([
      homework({ id: "h1", classId: "c2", submissions: { s1: "Completed" } }),
      homework({ id: "h2", classId: "gone", dueDate: "2026-07-09", submissions: { s1: "Missing" } }),
    ]);
    assert.equal(r.timeline[0].className, "Reading Club");
    assert.equal(r.timeline[1].className, "", "no placeholder name is fabricated");
  });
});

/* =========================================================================
 * 2. The student's own outcome, never the assignment's
 * ====================================================================== */

describe("Homework read model — the student's own outcome", () => {
  it("7. a class-scoped row reads submissions[studentId], not the top-level status", () => {
    const hw = [homework({ id: "h1", status: "Completed", submissions: { s1: "Missing" } })];
    const r = build(hw);
    assert.equal(r.timeline[0].status, "Missing", "the assignment says Completed; this student did not");
    assert.equal(r.counts.missing, 1);
    assert.equal(r.counts.completed, 0);
  });

  it("8. and the reverse — a Missing assignment where this student was on time", () => {
    const hw = [homework({ id: "h1", status: "Missing", submissions: { s1: "Completed" } })];
    const r = build(hw);
    assert.equal(r.timeline[0].status, "Completed");
    assert.equal(r.counts.completed, 1);
  });

  it("9. a student-scoped assignment uses its own status, which IS theirs", () => {
    const hw = [homework({ id: "h1", scope: "student", studentId: "s1", status: "Missing", submissions: {} })];
    const r = build(hw);
    assert.equal(r.timeline[0].status, "Missing");
    assert.equal(r.timeline[0].scope, "student");
  });
});

/* =========================================================================
 * 3. Completion — the shipped measure
 * ====================================================================== */

describe("Homework read model — completion", () => {
  it("10. Completed and Late are done; Missing is not", () => {
    const r = build([
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Late", dueDate: "2026-07-11", submissions: { s1: "Late" } }),
      homework({ id: "h3", status: "Missing", dueDate: "2026-07-12", submissions: { s1: "Missing" } }),
    ]);
    assert.equal(r.done, 2, "work submitted late was submitted");
    assert.equal(r.outcomeTotal, 3);
    assert.equal(r.completionRate, 67);
  });

  it("11. Assigned is excluded from the denominator entirely — not counted as a failure", () => {
    const r = build([
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Assigned", dueDate: "2026-07-11", submissions: { s1: "Assigned" } }),
    ]);
    assert.equal(r.outcomeTotal, 1, "the Assigned assignment is not in the measure");
    assert.equal(r.completionRate, 100, "and does not drag the figure down");
  });

  it("11b. an assignment nobody has marked is excluded even where THIS student has an outcome", () => {
    /* THE ONE FIXTURE THAT ISOLATES THE TOP-LEVEL EXCLUSION, and the reason it
     * needs its own test: `studentHomeworkCompletion` excludes on `hw.status ===
     * "Assigned"` AND on the student's own submission being `Assigned`, and in
     * every ordinary record those two agree — the seeder writes an all-`Assigned`
     * submissions map exactly when the assignment itself is `Assigned`, and this
     * MVP ships no submission writer to break that. So the top-level rule is
     * unobservable except on a divergent record, and a test built from ordinary
     * fixtures cannot tell whether it is still there. This one can.
     *
     * IT PINS SHIPPED BEHAVIOUR RATHER THAN CHOOSING NEW BEHAVIOUR. The two
     * figures below are allowed to look odd together — one completed assignment
     * in the tile, no percentage in the ring — because they answer different
     * questions, and the ring is the existing completion measure AND NO OTHER
     * (PROJECT_RULES, Student Profile). Changing that is a contract change, and
     * this test is what would make it visible. */
    const divergent = homework({ id: "h1", status: "Assigned", submissions: { s1: "Completed" } });

    assert.equal(studentHomeworkOutcome(divergent, "s1"), "Completed", "the student's own outcome");
    assert.equal(
      studentHomeworkCompletion("s1", "2026-07", { homework: [divergent] }).total, 0,
      "but the shipped measure excludes an assignment nobody has marked"
    );

    const r = build([divergent]);
    assert.equal(r.counts.total, 1);
    assert.equal(r.counts.completed, 1, "the tile reports what this student did");
    assert.equal(r.outcomeTotal, 0);
    assert.equal(r.completionRate, null, "the ring reports the shipped measure, which has nothing to report");
  });

  it("12. no outcome-bearing work reports null, never 0", () => {
    const r = build([homework({ id: "h1", status: "Assigned", submissions: { s1: "Assigned" } })]);
    assert.equal(r.completionRate, null, "nothing marked yet is not the same as nothing done");
    assert.notEqual(r.completionRate, 0);
    assert.equal(r.outcomeTotal, 0);
  });

  it("13. a student with work but no outcomes is NOT the empty state", () => {
    /* A partial answer is never dressed as an empty one: they have work, the ring
     * simply has no figure yet. */
    const r = build([homework({ id: "h1", status: "Assigned", submissions: { s1: "Assigned" } })]);
    assert.equal(r.hasRecords, true, "they were given work");
    assert.equal(r.counts.total, 1);
    assert.equal(r.completionRate, null);
  });

  it("14. no work at all IS the empty state", () => {
    const r = build([]);
    assert.equal(r.hasRecords, false);
    assert.deepEqual(r.counts, { total: 0, completed: 0, late: 0, missing: 0 });
    assert.equal(r.completionRate, null);
  });
});

/* =========================================================================
 * 4. Total includes Assigned — the banked disagreement
 * ====================================================================== */

describe("Homework read model — Total counts the work they were given", () => {
  it("15. Total includes Assigned, so it may exceed Completed + Late + Missing", () => {
    /* THE BANKED RULE, executed. `total` answers "what were they given"; the ring
     * answers "of the work that has an outcome, how much is done". Those are
     * different questions and the two figures are ALLOWED to disagree — exactly
     * as Finance's billed total legitimately exceeds the rows a teacher can act
     * on. This is correct and is not a defect. */
    const r = build([
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Assigned", dueDate: "2026-07-11", submissions: { s1: "Assigned" } }),
      homework({ id: "h3", status: "Assigned", dueDate: "2026-07-12", submissions: { s1: "Assigned" } }),
    ]);
    assert.equal(r.counts.total, 3, "three assignments were addressed to this student");
    assert.equal(r.counts.completed + r.counts.late + r.counts.missing, 1);
    assert.ok(
      r.counts.total > r.counts.completed + r.counts.late + r.counts.missing,
      "the gap is the Assigned work, and it is meant to be there"
    );
    assert.equal(r.counts.total - (r.counts.completed + r.counts.late + r.counts.missing), 2);
  });

  it("16. with no Assigned work the four counts do reconcile", () => {
    const r = build([
      homework({ id: "h1", status: "Completed", submissions: { s1: "Completed" } }),
      homework({ id: "h2", status: "Late", dueDate: "2026-07-11", submissions: { s1: "Late" } }),
      homework({ id: "h3", status: "Missing", dueDate: "2026-07-12", submissions: { s1: "Missing" } }),
    ]);
    assert.equal(r.counts.total, r.counts.completed + r.counts.late + r.counts.missing);
  });
});

/* =========================================================================
 * 5. Ordering and caps
 * ====================================================================== */

describe("Homework read model — ordering and caps", () => {
  it("17. the timeline is newest first by due date", () => {
    const r = build([
      homework({ id: "h1", dueDate: "2026-05-01", submissions: { s1: "Completed" } }),
      homework({ id: "h2", dueDate: "2026-07-01", submissions: { s1: "Completed" } }),
      homework({ id: "h3", dueDate: "2026-06-01", submissions: { s1: "Completed" } }),
    ]);
    assert.deepEqual(r.timeline.map((t) => t.dueDate), ["2026-07-01", "2026-06-01", "2026-05-01"]);
  });

  it("18. same due date tie-breaks on id, and input order cannot change it", () => {
    const hw = [
      homework({ id: "hb", dueDate: "2026-07-01", submissions: { s1: "Completed" } }),
      homework({ id: "ha", dueDate: "2026-07-01", submissions: { s1: "Completed" } }),
      homework({ id: "hc", dueDate: "2026-07-01", submissions: { s1: "Completed" } }),
    ];
    const forward = build(hw);
    const reversed = build([...hw].reverse());
    assert.deepEqual(forward.timeline.map((t) => t.homeworkId), ["ha", "hb", "hc"]);
    assert.deepEqual(
      forward.timeline.map((t) => t.homeworkId),
      reversed.timeline.map((t) => t.homeworkId),
      "the database's natural order is never relied upon"
    );
  });

  it("19. the timeline caps at 20 and moves no aggregate", () => {
    const hw = Array.from({ length: 26 }, (_, i) =>
      homework({
        id: `h${String(i).padStart(2, "0")}`,
        dueDate: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
        status: "Completed",
        submissions: { s1: "Completed" },
      })
    );
    const r = build(hw);
    assert.equal(r.timeline.length, PROFILE_TIMELINE_LIMIT);
    assert.equal(PROFILE_TIMELINE_LIMIT, 20);
    assert.equal(r.counts.total, 26, "every assignment still counts");
    assert.equal(r.counts.completed, 26);
    assert.equal(r.outcomeTotal, 26);
    assert.equal(r.completionRate, 100);
  });

  it("20. Missing and Late each cap at 5, newest first, without moving a count", () => {
    const missing = Array.from({ length: 7 }, (_, i) =>
      homework({
        id: `m${i}`, dueDate: `2026-07-0${i + 1}`, status: "Missing",
        submissions: { s1: "Missing" },
      })
    );
    const late = Array.from({ length: 7 }, (_, i) =>
      homework({
        id: `t${i}`, dueDate: `2026-06-0${i + 1}`, status: "Late",
        submissions: { s1: "Late" },
      })
    );
    const r = build([...missing, ...late]);
    assert.equal(r.missing.length, PROFILE_LIST_LIMIT);
    assert.equal(r.late.length, PROFILE_LIST_LIMIT);
    assert.equal(PROFILE_LIST_LIMIT, 5);
    assert.equal(r.missing[0].dueDate, "2026-07-07", "newest first");
    assert.equal(r.late[0].dueDate, "2026-06-07");
    assert.equal(r.counts.missing, 7, "the cap is presentation only");
    assert.equal(r.counts.late, 7);
    assert.equal(r.counts.total, 14);
  });

  it("21. the two lists are filtered to their own status and nothing else", () => {
    const r = build([
      homework({ id: "h1", status: "Missing", submissions: { s1: "Missing" } }),
      homework({ id: "h2", status: "Late", dueDate: "2026-07-09", submissions: { s1: "Late" } }),
      homework({ id: "h3", status: "Completed", dueDate: "2026-07-08", submissions: { s1: "Completed" } }),
    ]);
    assert.deepEqual(r.missing.map((h) => h.status), ["Missing"]);
    assert.deepEqual(r.late.map((h) => h.status), ["Late"]);
  });
});

/* =========================================================================
 * 6. Cross-module agreement with the shared helper
 * ====================================================================== */

describe("Homework read model — it agrees with the shipped completion helper", () => {
  const hw = [
    homework({ id: "h1", dueDate: "2026-06-05", status: "Completed", submissions: { s1: "Completed", s2: "Missing" } }),
    homework({ id: "h2", dueDate: "2026-06-12", status: "Missing", submissions: { s1: "Missing" } }),
    homework({ id: "h3", dueDate: "2026-07-03", status: "Late", submissions: { s1: "Late" } }),
    homework({ id: "h4", dueDate: "2026-07-10", status: "Assigned", submissions: { s1: "Assigned" } }),
    homework({ id: "h5", dueDate: "2026-07-17", scope: "student", studentId: "s1", status: "Completed" }),
  ];

  it("22. done and outcomeTotal are the shipped helper summed, exactly", () => {
    /* The identity that stops the ring on this tab drifting from the completion
     * percentage the Reviews learning journey already shows. */
    const r = build(hw);
    let done = 0, total = 0;
    for (const month of ["2026-06", "2026-07"]) {
      const m = studentHomeworkCompletion("s1", month, { homework: hw });
      done += m.done;
      total += m.total;
    }
    assert.equal(r.done, done);
    assert.equal(r.outcomeTotal, total);
    assert.equal(r.completionRate, Math.round((done / total) * 100));
  });

  it("23. a month with no work contributes nothing and breaks nothing", () => {
    const r = build(hw);
    const may = studentHomeworkCompletion("s1", "2026-05", { homework: hw });
    assert.equal(may.total, 0);
    assert.equal(may.pct, null);
    assert.equal(r.outcomeTotal, 4, "unchanged by the empty month");
  });
});

/* =========================================================================
 * 7. Reads only, and the Sprint 7 seal is intact
 * ====================================================================== */

describe("Homework read model — it writes nothing, and changes no ownership", () => {
  it("24. the pure module reaches no database, clock, network or storage", () => {
    for (const forbidden of ["Model", "mongoose", "dbConnect", "fetch(", "localStorage", "readFileSync"]) {
      assert.ok(!PURE.includes(forbidden), `${forbidden} has no place in the pure core`);
    }
  });

  it("25. the service writes nothing at all", () => {
    const writes = [...SERVICE.matchAll(
      /\b(\w+Model)\.(updateOne|updateMany|create|insertMany|bulkWrite|deleteOne|deleteMany|findOneAndUpdate|replaceOne|save)/g
    )].map((m) => `${m[1]}.${m[2]}`);
    assert.deepEqual(writes, []);
  });

  it("26. NO SUBMISSION WRITER APPEARS — the deferred feature stays deferred", () => {
    /* Sprint 13 reads the submissions map and must never gain the ability to
     * change it. The Sprint 7 seal on the Homework service is also re-checked
     * here, because this sprint is the first to read that field from anywhere
     * else. */
    assert.ok(!/submissions\s*(\[[^\]]*\])?\s*=[^=]/.test(PURE), "nothing assigns into the map");
    assert.ok(!PURE.includes("initialSubmissions"));
    assert.ok(!HW_SERVICE.includes("submissions"), "the Sprint 7 seal is untouched");
  });

  it("27. no ownership field can be written — the service builds no document at all", () => {
    /* `scope:` and `studentId:` DO appear in this service, inside `find()`
     * filters, which is how the query narrows to work that can concern this
     * student. A bare string search would therefore be a false alarm, so this
     * asserts the thing that actually matters: there is no update operator and no
     * constructed document anywhere, so there is nothing for an ownership field
     * to be written INTO. */
    for (const op of ["$set", "$setOnInsert", "$unset", "$push", "$pull", "$inc", "upsert"]) {
      assert.ok(!SERVICE.includes(op), `${op} must not appear on a read path`);
    }
    assert.ok(!/Model\.create\s*\(/.test(SERVICE), "no document is constructed");
    /* The only thing this module does to a model is read from it. `classId`,
     * `studentId` and `scope` do appear — narrowing the query, and handing the
     * student id to the pure builder — and both are reads. */
    const verbs = [...new Set([...SERVICE.matchAll(/\b\w*Model\.(\w+)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(verbs, ["find", "findOne"], "read verbs, and only read verbs");
    assert.ok(/\b(classId|studentId|scope)\s*:/.test(SERVICE), "the guard is not vacuous — the query does use them");
  });

  it("28. the endpoint is session-guarded, read-only, and 404s an unresolvable student", () => {
    assert.ok(ROUTE.includes("requireSession"));
    assert.ok(ROUTE.includes("handle("));
    assert.ok(ROUTE.includes('error("Student not found", 404)'));
    for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
      assert.ok(!new RegExp(`export async function ${verb}\\b`).test(ROUTE), `${verb} must not exist`);
    }
    assert.ok(ROUTE.includes("export async function GET"));
  });

  it("29. no UI was built in this gate", () => {
    /* Gate 3 is backend only. The tabs, their components and their responsive
     * rule belong to the UI gate that follows. */
    for (const p of [
      ["src", "components", "attendance", "student-attendance.tsx"],
      ["src", "components", "homework", "student-homework.tsx"],
    ]) {
      assert.throws(() => readFileSync(path.join(process.cwd(), ...p), "utf8"), "no tab component exists yet");
    }
    const profile = code("src", "app", "(app)", "students", "[id]", "page.tsx");
    assert.ok(!profile.includes('tab === "Attendance"'), "the Attendance branch is the UI gate's");
    assert.ok(!profile.includes('tab === "Homework"'), "the Homework branch is the UI gate's");
    assert.ok(!code("src", "app", "globals.css").includes("sp-split"), "no Sprint 13 CSS yet");
  });
});
