/* Sprint 6 Gate 5 — Attendance production rollout, PHASE 1.
 *
 * Run with:  npm run attendance:rollout-phase1
 *            npm run attendance:rollout-phase1 -- --out backups/gate5-attendance-<stamp>
 *
 * READ-ONLY BY CONSTRUCTION, NOT BY PROMISE. There is no apply flag, no write
 * mode and no code path that can be enabled to reach one: the only database calls
 * in this file are `find`. It completes the Gate 5 snapshot on disk, audits the
 * live data, picks and characterises a smoke target, and PREDICTS the write —
 * using the real production planner, in memory — without performing it.
 *
 * WHY A SECOND SNAPSHOT SCRIPT. `scripts/snapshot-lessons.ts` already exports
 * lessons, attendances, billings and homeworks with a manifest and a rollback
 * document, and it is proven. What it does not export as files are `classes` and
 * `students`, which Gate 5 needs in order to prove afterwards that a register
 * save touched no roster. So it is run first, and this script completes the same
 * directory rather than replacing it or being modified into it.
 *
 * WHAT IT DOES NOT DO. It does not clean, repair, migrate or reconcile anything.
 * Everything it finds is reported exactly as it stands.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mongoose, AttendanceModel, BillingModel, ClassModel, LessonModel, StudentModel, HomeworkModel } from "../src/lib/models";
import { CURRENT_MONTH, FINANCE_MONTHS, TODAY_ISO } from "../src/lib/constants";
import { attendanceRate, computeRevenue, teachingHours, homeworkCompletion } from "../src/lib/finance";
import { digestLessons } from "../src/lib/migration";
import {
  attendanceEligibilityFor, planAttendanceWrite, resolveRoster,
} from "../src/lib/attendance";
import type {
  AttendanceRecord, Billing, Homework, Klass, Lesson, Student,
} from "../src/lib/types";

/* Read-only, enforced rather than asserted — the same two lines every audit
 * script in this project opens with, so not even an index can be created. */
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "etlms";
const EXPECTED_DB = "etlms";

if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local (see .env.example).");

const clean = "-_id -__v";
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const line = (label: string, value: unknown) => console.log(`${String(label).padEnd(40)} ${value}`);
const rule = (title: string) => console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);

/** One value standing for a whole collection, order-independent — the same
 * convention `digestLessons` uses, generalised so every collection Gate 5 has to
 * prove unchanged can be compared with a single string. */
function digestOf(docs: readonly unknown[]): { count: number; digest: string } {
  const body = docs.map((d) => JSON.stringify(d)).sort().join("\n");
  return { count: docs.length, digest: sha(body) };
}

function outDir(): string {
  const i = process.argv.indexOf("--out");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return join("backups", `gate5-attendance-${stamp}`);
}

/** The 32 ids Sprint 5 removed. None may have returned. */
const PHANTOM_IDS: readonly string[] = [
  "L-c4-2026-06-02-1008", "L-c4-2026-06-09-1008", "L-c4-2026-06-16-1008",
  "L-c4-2026-06-23-1008", "L-c4-2026-06-30-1008", "L-c4-2026-07-07-1008",
  "L-c6-2026-06-05-1700", "L-c6-2026-06-06-1700", "L-c6-2026-06-07-1700",
  "L-c6-2026-06-12-1700", "L-c6-2026-06-13-1700", "L-c6-2026-06-14-1700",
  "L-c6-2026-06-19-1700", "L-c6-2026-06-20-1700", "L-c6-2026-06-21-1700",
  "L-c6-2026-06-26-1700", "L-c6-2026-06-27-1700", "L-c6-2026-06-28-1700",
  "L-c6-2026-07-03-1700", "L-c6-2026-07-04-1700", "L-c6-2026-07-05-1700",
  "L-c2-2026-06-04-1000", "L-c2-2026-06-11-1000", "L-c2-2026-06-18-1000",
  "L-c2-2026-06-25-1000", "L-c2-2026-07-02-1000", "L-c2-2026-07-09-1000",
  "L-c2-2026-06-07-1000", "L-c2-2026-06-14-1000", "L-c2-2026-06-21-1000",
  "L-c2-2026-06-28-1000", "L-c2-2026-07-05-1000",
];

/** Every month the data actually touches, plus the finance window.
 *
 * Derived rather than hard-coded: a rollout has to prove it moves NO month, and
 * a fixed six-month list cannot do that once lessons exist outside it — the
 * collection already runs past the finance window into future months. */
function monthsInPlay(lessons: readonly Lesson[]): string[] {
  return [...new Set([...FINANCE_MONTHS, ...lessons.map((l) => l.date.slice(0, 7))])].sort();
}

/** `attendanceRate`'s numerator and denominator, spelled out for the report.
 *
 * NOT a second formula: the rate itself is always read from the real
 * `attendanceRate()`. This exists only so the checkpoint can show WHY the number
 * moves, and it is asserted against the real function below. */
function rateParts(month: string, lessons: readonly Lesson[], attendance: readonly AttendanceRecord[]) {
  const ids = new Set(lessons.filter((l) => l.date.startsWith(month) && l.status === "Completed").map((l) => l.id));
  let attended = 0, total = 0;
  for (const rec of attendance) {
    if (!ids.has(rec.lessonId)) continue;
    for (const sid of Object.keys(rec.entries ?? {})) {
      total++;
      const st = rec.entries[sid]?.status;
      if (st === "Present" || st === "Late" || st === "Excused") attended++;
    }
  }
  return { attended, total, rate: total === 0 ? 0 : Math.round((attended / total) * 100) };
}

async function main() {
  await mongoose.connect(uri!, { dbName: DB_NAME, bufferCommands: false });
  const db = mongoose.connection.db!;

  /* ---- 0. environment ------------------------------------------------- */

  rule("0. ENVIRONMENT");
  line("connected database", db.databaseName);
  line("expected database", EXPECTED_DB);
  line("app clock (TODAY_ISO)", TODAY_ISO);
  line("current month", CURRENT_MONTH);

  if (db.databaseName !== EXPECTED_DB) {
    throw new Error(`Refusing to continue: connected to '${db.databaseName}', expected '${EXPECTED_DB}'.`);
  }
  console.log("database target CONFIRMED (read from the live connection, not the URI)");

  /* ---- 1. read everything, once --------------------------------------- */

  const [classes, students, lessons, attendance, billing, homework, rawAttendance] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    StudentModel.find().select(clean).lean<Student[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select(clean).lean<AttendanceRecord[]>(),
    BillingModel.find().select(clean).lean<Billing[]>(),
    HomeworkModel.find().select(clean).lean<Homework[]>(),
    // Raw, so fields the schema no longer advertises (`date`) and fields it never
    // declared (`createdAt`) are visible to the audit.
    db.collection("attendances").find({}).toArray(),
  ]);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const studentById = new Map(students.map((s) => [s.id, s]));
  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const recordByLesson = new Map(attendance.map((a) => [a.lessonId, a]));

  /* ---- 2. snapshot ----------------------------------------------------- */

  rule("1. SNAPSHOT (files only — no database write)");
  const dir = outDir();
  mkdirSync(dir, { recursive: true });

  const digests = {
    attendances: digestOf(attendance),
    lessons: digestLessons(lessons),
    classes: digestOf(classes),
    students: digestOf(students),
    billings: digestOf(billing),
    homeworks: digestOf(homework),
  };

  writeFileSync(join(dir, "classes.json"), json(classes));
  writeFileSync(join(dir, "students.json"), json(students));
  writeFileSync(join(dir, "attendances-raw.json"), json(rawAttendance));

  line("snapshot directory", dir);
  for (const [name, d] of Object.entries(digests)) {
    line(`  ${name}`, `${String(d.count).padStart(5)} docs   sha256 ${d.digest}`);
  }

  /* ---- 3. live Attendance audit ---------------------------------------- */

  rule("2. LIVE ATTENDANCE AUDIT (read-only)");
  const seen = new Map<string, number>();
  let orphanBearing = 0, drifted = 0, timestamped = 0, futureRec = 0, cancelledRec = 0, danglingLesson = 0;
  const missingStudents = new Set<string>();
  const driftedDetail: string[] = [];

  for (const raw of rawAttendance) {
    const rec = raw as unknown as AttendanceRecord & { createdAt?: unknown; updatedAt?: unknown };
    seen.set(rec.lessonId, (seen.get(rec.lessonId) ?? 0) + 1);
    const orphans = Object.keys(rec.entries ?? {}).filter((id) => !studentById.has(id));
    if (orphans.length > 0) orphanBearing++;
    for (const id of orphans) missingStudents.add(id);

    const l = lessonById.get(rec.lessonId);
    if (!l) danglingLesson++;
    else {
      if (rec.date !== undefined && rec.date !== l.date) {
        drifted++;
        driftedDetail.push(`${rec.lessonId}: record ${rec.date} vs lesson ${l.date}`);
      }
      if (l.date > TODAY_ISO) futureRec++;
      if (l.status === "Cancelled") cancelledRec++;
    }
    if (rec.createdAt !== undefined || rec.updatedAt !== undefined) timestamped++;
  }
  const duplicateLessonIds = [...seen.entries()].filter(([, n]) => n > 1);

  line("Attendance records", rawAttendance.length);
  line("duplicate lessonId", duplicateLessonIds.length);
  line("orphan-bearing records", orphanBearing);
  line("missing student ids", `${missingStudents.size}  (${[...missingStudents].sort().join(", ")})`);
  line("drifted AttendanceRecord.date", drifted);
  line("records with timestamps", timestamped);
  line("future Attendance records", futureRec);
  line("Cancelled Attendance records", cancelledRec);
  line("records whose lesson is gone", danglingLesson);
  for (const d of driftedDetail) console.log(`    drifted: ${d}`);

  /* ---- 4. Sprint 5 data health ----------------------------------------- */

  rule("3. SPRINT 5 DATA HEALTH (read-only)");
  const regularUpcomingPast = lessons.filter(
    (l) => l.type === "regular" && l.status === "Upcoming" && l.date < TODAY_ISO
  );
  const phantomsPresent = PHANTOM_IDS.filter((id) => lessonById.has(id));
  const orphanAttendance = attendance.filter((a) => !lessonById.has(a.lessonId));
  const brokenMakeup = lessons.filter((l) => l.type === "makeup" && l.fromId && !lessonById.has(l.fromId));
  const lessonIdCounts = new Map<string, number>();
  for (const l of lessons) lessonIdCounts.set(l.id, (lessonIdCounts.get(l.id) ?? 0) + 1);
  const duplicateLessons = [...lessonIdCounts.entries()].filter(([, n]) => n > 1);
  const lessonsWithoutClass = lessons.filter((l) => !classById.has(l.classId));

  line("regular + Upcoming + past", `${regularUpcomingPast.length}   (expected 0)`);
  line("phantom ids still present", `${phantomsPresent.length}   (expected 0)`);
  line("orphan Attendance by lessonId", `${orphanAttendance.length}   (expected 0)`);
  line("broken makeup fromId refs", `${brokenMakeup.length}   (expected 0)`);
  line("duplicate lesson ids", `${duplicateLessons.length}   (expected 0)`);
  line("lessons whose class is gone", lessonsWithoutClass.length);
  for (const l of regularUpcomingPast) console.log(`    unresolved: ${l.id} ${l.date} ${l.status}`);

  /* ---- 5. candidate smoke targets -------------------------------------- */

  rule("4. CANDIDATE SMOKE TARGETS");

  interface Candidate {
    lesson: Lesson;
    klass: Klass;
    rosterIds: string[];
    resolvable: string[];
    missing: string[];
    hasRecord: boolean;
    entries: number;
  }

  const candidates: Candidate[] = [];
  for (const l of lessons) {
    if (!attendanceEligibilityFor(l, TODAY_ISO).eligible) continue;
    const k = classById.get(l.classId);
    if (!k) continue;
    const rosterIds = k.studentIds ?? [];
    const resolvable = resolveRoster(rosterIds, students).map((s) => s.id);
    const missing = rosterIds.filter((id) => !studentById.has(id));
    const rec = recordByLesson.get(l.id);
    candidates.push({
      lesson: l, klass: k, rosterIds: [...rosterIds], resolvable, missing,
      hasRecord: rec !== undefined, entries: rec ? Object.keys(rec.entries ?? {}).length : 0,
    });
  }

  const clean_ = candidates.filter((c) => !c.hasRecord && c.resolvable.length > 0 && c.missing.length === 0);
  line("eligible lessons", candidates.length);
  line("  …with no AttendanceRecord", candidates.filter((c) => !c.hasRecord).length);
  line("  …and a fully resolvable roster", clean_.length);

  const describe = (c: Candidate, mark = "") => {
    const l = c.lesson;
    console.log(`\n  ${l.id}${mark}`);
    console.log(`    class            ${c.klass.id} · ${c.klass.name} (${c.klass.status}, fee ${c.klass.fee})`);
    console.log(`    type / status    ${l.type} / ${l.status}`);
    console.log(`    Lesson.date      ${l.date}   start ${l.start}   duration ${l.duration}`);
    console.log(`    eligibility      ${JSON.stringify(attendanceEligibilityFor(l, TODAY_ISO))}`);
    console.log(`    roster ids       [${c.rosterIds.join(", ")}]`);
    console.log(`    resolvable       [${c.resolvable.join(", ")}]`);
    console.log(`    missing ids      [${c.missing.join(", ")}]`);
    console.log(`    record exists    ${c.hasRecord}${c.hasRecord ? ` (${c.entries} entries)` : ""}`);
    const moved = l.originalDate ? `moved from ${l.originalDate} ${l.originalStart ?? ""}` : "never moved";
    const flags = [
      c.missing.length > 0 ? `DANGLING ROSTER IDS [${c.missing.join(", ")}]` : "",
      l.originalDate ? "RESCHEDULED" : "",
      l.date === TODAY_ISO && l.status === "Upcoming" ? "TODAY-UPCOMING" : "",
      c.hasRecord ? "ALREADY HAS A REGISTER" : "",
    ].filter(Boolean);
    console.log(`    peculiarities    ${moved}${l.fromId ? `, fromId ${l.fromId}` : ""}${l.chargeable ? ", chargeable" : ""}`);
    if (flags.length > 0) console.log(`    FLAGS            ${flags.join(" · ")}`);

    // What this candidate would do if it were the one chosen — computed per
    // candidate, not only for the winner, so the selection is a comparison
    // rather than an assertion about the one that happened to be picked.
    const m = l.date.slice(0, 7);
    const sim: AttendanceRecord = {
      lessonId: l.id,
      entries: Object.fromEntries(c.resolvable.map((id) => [id, { status: "Present" as const }])),
    };
    const withSim = [...attendance, sim];
    const revBefore = computeRevenue(m, { classes, students, lessons, attendance }).total;
    const revAfter = computeRevenue(m, { classes, students, lessons, attendance: withSim }).total;
    const rBefore = rateParts(m, lessons, attendance);
    const rAfter = rateParts(m, lessons, withSim);
    console.log(`    month            ${m}`);
    console.log(`    revenue          ${revBefore} -> ${revAfter}   delta ${revAfter - revBefore}`);
    console.log(`    attendance rate  ${rBefore.rate}% -> ${rAfter.rate}%   (${rBefore.attended}/${rBefore.total} -> ${rAfter.attended}/${rAfter.total})`);
  };

  console.log("\n--- fully clean candidates (no record, roster fully resolvable) ---");
  for (const c of clean_.slice(0, 12)) describe(c);
  if (clean_.length > 12) console.log(`\n  …and ${clean_.length - 12} more`);

  // A target proposed by an earlier gate gets no standing here. Candidates are
  // rediscovered from live data on every run and have to earn selection, because
  // a lesson that was safe last week may have acquired a register since.
  if (candidates.some((c) => c.hasRecord)) {
    console.log(`\n  (${candidates.filter((c) => c.hasRecord).length} eligible lessons already have a register and are not candidates)`);
  }

  /* ---- 6. selection ----------------------------------------------------- */

  rule("5. SELECTED SMOKE TARGET");

  // Prefer: no record (rollback is a single delete), fully resolvable roster (no
  // hidden-entry interaction at all), Completed (the ordinary historical case,
  // and the one that actually exercises the revenue/rate prediction), smallest
  // roster (smallest blast radius), then oldest for determinism.
  const ranked = [...clean_].sort((a, b) => {
    const ac = a.lesson.status === "Completed" ? 0 : 1;
    const bc = b.lesson.status === "Completed" ? 0 : 1;
    return ac - bc
      || a.resolvable.length - b.resolvable.length
      || a.lesson.date.localeCompare(b.lesson.date)
      || a.lesson.id.localeCompare(b.lesson.id);
  });
  const target = ranked[0];
  if (!target) throw new Error("No safe smoke target found — rollout cannot proceed.");
  describe(target, "   <- SELECTED");

  const targetMonth = target.lesson.date.slice(0, 7);
  line("\ntarget month", targetMonth);

  /* ---- 7. exact payload + predicted write ------------------------------- */

  rule("6. EXACT PAYLOAD AND PREDICTED MONGO WRITE (predicted only — not executed)");

  const payload: Record<string, { status: "Present"; note: string }> = {};
  for (const id of target.resolvable) payload[id] = { status: "Present", note: "" };
  console.log("payload entries:");
  for (const [id, e] of Object.entries(payload)) {
    console.log(`  ${id.padEnd(6)} ${e.status}   note ""   (${studentById.get(id)?.name ?? "?"})`);
  }

  // The REAL production planner, in memory. Nothing is sent to Mongo.
  const planned = planAttendanceWrite(target.lesson.id, new Set(target.resolvable), payload);
  if (!planned.ok) throw new Error(`planner rejected the payload: ${planned.reason}`);
  console.log("\npredicted update:");
  console.log(json(planned.plan));

  const planJson = JSON.stringify(planned.plan);
  const forbidden = ["date", "createdAt", "updatedAt", "classId", "studentIds", "billing", "chargeable"];
  for (const f of forbidden) {
    const present = planJson.includes(`"${f}"`) || planJson.includes(`${f}:`);
    line(`  contains "${f}"`, present ? "*** YES — BLOCKER ***" : "no");
  }

  /* ---- 8. predicted collection-level change ----------------------------- */

  rule("7. PREDICTED COLLECTION CHANGES");
  line("attendances", `${attendance.length} -> ${attendance.length + 1}`);
  line("lessons", `${lessons.length} (unchanged)`);
  line("classes", `${classes.length} (unchanged)`);
  line("students", `${students.length} (unchanged)`);
  line("billings", `${billing.length} (unchanged)`);
  line("existing Attendance docs modified", "0");

  /* ---- 9. revenue ------------------------------------------------------- */

  rule("8. REVENUE — REAL computeRevenue(), BASELINE vs PROJECTION");

  const simulated: AttendanceRecord = {
    lessonId: target.lesson.id,
    entries: Object.fromEntries(target.resolvable.map((id) => [id, { status: "Present" as const }])),
  };
  const afterAttendance = [...attendance, simulated];

  const months = monthsInPlay(lessons);
  const revenueRows: Array<{ month: string; before: number; after: number; delta: number }> = [];
  console.log("month     before          after           delta");
  for (const m of months) {
    const before = computeRevenue(m, { classes, students, lessons, attendance }).total;
    const after = computeRevenue(m, { classes, students, lessons, attendance: afterAttendance }).total;
    revenueRows.push({ month: m, before, after, delta: after - before });
    console.log(`${m}   ${String(before).padStart(12)}   ${String(after).padStart(12)}   ${String(after - before).padStart(6)}`);
  }
  const revenueMoved = revenueRows.filter((r) => r.delta !== 0);
  line("\nmonths with non-zero delta", revenueMoved.length === 0 ? "0  (as expected)" : `*** ${revenueMoved.length} ***`);

  /* ---- 10. attendance rate ---------------------------------------------- */

  rule("9. ATTENDANCE RATE — REAL attendanceRate(), BASELINE vs PROJECTION");
  console.log("month     rate before   rate after   delta   numerator/denominator before -> after");
  const rateRows: Array<{ month: string; before: number; after: number }> = [];
  for (const m of months) {
    const before = attendanceRate(m, { lessons, attendance });
    const after = attendanceRate(m, { lessons, attendance: afterAttendance });
    const pb = rateParts(m, lessons, attendance);
    const pa = rateParts(m, lessons, afterAttendance);
    // The spelled-out parts must agree with the real function, or the explanation
    // in this report is not an explanation of this system.
    if (pb.rate !== before || pa.rate !== after) throw new Error(`rate decomposition disagrees with attendanceRate() for ${m}`);
    rateRows.push({ month: m, before, after });
    console.log(
      `${m}   ${String(before).padStart(9)}%   ${String(after).padStart(8)}%   ${String(after - before).padStart(5)}   ` +
      `${pb.attended}/${pb.total} -> ${pa.attended}/${pa.total}`
    );
  }

  /* ---- 11. dashboard ---------------------------------------------------- */

  rule("10. DASHBOARD-RELEVANT METRICS (same pure functions buildDashboard uses)");
  const activeStudents = students.filter((s) => s.status !== "Archived").length;
  const activeClasses = classes.filter((c) => c.status === "Active").length;
  const todayLessons = lessons.filter((l) => l.date === TODAY_ISO && l.status !== "Cancelled").length;

  const dashBefore = {
    revenue: computeRevenue(CURRENT_MONTH, { classes, students, lessons, attendance }).total,
    attendanceRate: attendanceRate(CURRENT_MONTH, { lessons, attendance }),
    teachingHours: teachingHours(CURRENT_MONTH, { lessons }),
    homeworkCompletion: homeworkCompletion(CURRENT_MONTH, { homework }),
    activeStudents, activeClasses, lessonsToday: todayLessons,
  };
  const dashAfter = {
    revenue: computeRevenue(CURRENT_MONTH, { classes, students, lessons, attendance: afterAttendance }).total,
    attendanceRate: attendanceRate(CURRENT_MONTH, { lessons, attendance: afterAttendance }),
    teachingHours: teachingHours(CURRENT_MONTH, { lessons }),
    homeworkCompletion: homeworkCompletion(CURRENT_MONTH, { homework }),
    activeStudents, activeClasses, lessonsToday: todayLessons,
  };
  console.log(`month ${CURRENT_MONTH}`);
  for (const k of Object.keys(dashBefore) as Array<keyof typeof dashBefore>) {
    const b = dashBefore[k], a = dashAfter[k];
    console.log(`  ${k.padEnd(20)} ${String(b).padStart(12)} -> ${String(a).padStart(12)}   ${b === a ? "unchanged" : "CHANGED"}`);
  }

  /* ---- 12. manifest + rollback ------------------------------------------ */

  const manifest = {
    gate: "Sprint 6 Gate 5 — Attendance production rollout, Phase 1",
    takenAt: new Date().toISOString(),
    database: db.databaseName,
    appClock: TODAY_ISO,
    snapshotDir: dir,
    digests,
    audit: {
      attendanceRecords: rawAttendance.length,
      duplicateLessonId: duplicateLessonIds.length,
      orphanBearingRecords: orphanBearing,
      missingStudentIds: [...missingStudents].sort(),
      driftedDates: drifted,
      recordsWithTimestamps: timestamped,
      futureRecords: futureRec,
      cancelledRecords: cancelledRec,
      danglingLessonRecords: danglingLesson,
    },
    health: {
      regularUpcomingPast: regularUpcomingPast.length,
      phantomIdsPresent: phantomsPresent.length,
      orphanAttendance: orphanAttendance.length,
      brokenMakeupFromId: brokenMakeup.length,
      duplicateLessonIds: duplicateLessons.length,
    },
    target: {
      lessonId: target.lesson.id,
      classId: target.klass.id,
      className: target.klass.name,
      type: target.lesson.type,
      status: target.lesson.status,
      date: target.lesson.date,
      start: target.lesson.start,
      duration: target.lesson.duration,
      month: targetMonth,
      rosterIds: target.rosterIds,
      resolvable: target.resolvable,
      missing: target.missing,
      hadRecordAtPhase1: target.hasRecord,
    },
    payload,
    predictedPlan: planned.plan,
    projections: { revenue: revenueRows, attendanceRate: rateRows, dashboard: { before: dashBefore, after: dashAfter } },
  };
  writeFileSync(join(dir, "GATE5-MANIFEST.json"), json(manifest));

  writeFileSync(join(dir, "GATE5-ROLLBACK.md"), [
    "# Sprint 6 Gate 5 — Attendance rollback",
    "",
    `Snapshot: \`${dir}\`  ·  database: \`${db.databaseName}\`  ·  taken: ${manifest.takenAt}`,
    "",
    "## Preconditions",
    "",
    `The smoke target \`${target.lesson.id}\` had **no** AttendanceRecord when this`,
    "snapshot was taken. Rollback is therefore a single delete and restores the",
    "pre-write Attendance state exactly.",
    "",
    "**Do not run any of this without explicit authorization.** A rollback is only",
    "considered if an invariant failed — not because the smoke save created a real",
    "record, which is the intended outcome.",
    "",
    "## 1. Undo the smoke write",
    "",
    "```javascript",
    `use ${db.databaseName};`,
    `db.attendances.deleteOne({ lessonId: ${JSON.stringify(target.lesson.id)} });`,
    "```",
    "",
    "Then confirm the collection matches this snapshot:",
    "",
    "```",
    "npm run attendance:live-audit",
    "```",
    "",
    `Expected afterwards: **${rawAttendance.length}** Attendance records, digest`,
    `\`${digests.attendances.digest}\`.`,
    "",
    "## 2. Fuller restore",
    "",
    "`attendances-raw.json` in this directory holds every Attendance document",
    "verbatim, as stored. Restoring from it is a destructive act on production and",
    "belongs to a person following a checklist, not to a script — which is why no",
    "automated restore ships here.",
    "",
    "## Collection digests at snapshot time",
    "",
    "```",
    ...Object.entries(digests).map(([k, d]) => `${k.padEnd(12)} ${String(d.count).padStart(5)} docs  sha256 ${d.digest}`),
    "```",
    "",
  ].join("\n"));

  rule("11. ARTIFACTS");
  line("snapshot dir", dir);
  line("manifest", join(dir, "GATE5-MANIFEST.json"));
  line("rollback", join(dir, "GATE5-ROLLBACK.md"));
  console.log("\nPHASE 1 COMPLETE — nothing was written to the database.");
}

main()
  .catch((e) => {
    console.error("\nPHASE 1 FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
