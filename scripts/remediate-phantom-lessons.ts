/* Phantom historical lesson remediation — Gate 5.4 / 5.5.
 *
 * ONE-OFF, DELIBERATE EXCEPTION TO "THE PAST IS IMMUTABLE" (RECURRENCE_DESIGN §4).
 *
 * The pre-Gate-1 `ensureRegularLessons` treated the window's previous month as
 * permission to INSERT, so adding or editing a class's weekly slot back-filled
 * Regular lessons onto dates that had already passed. Those lessons record teaching
 * that never happened. They inflate reported revenue and teaching hours, and no
 * ordinary mechanism can reach them: the reconciler never plans a past date, the
 * lifecycle only touches `Upcoming` lessons, and the duplicate detector cannot see
 * the 25 of them that sit alone on their date.
 *
 * THIS SCRIPT IS NOT THE RECONCILER AND MUST NEVER BECOME IT. It deletes an
 * explicit, hard-coded list of 32 ids and nothing else. It weakens no guard:
 * `planDate`, `auditPlan`, `RETIRE_ENABLED` and the lifecycle are untouched and
 * still refuse to write to the past.
 *
 * EVIDENCE (Gate 5.4, two independent methods that agree on all 32):
 *  - every one was created AFTER the seed batch (ObjectId timestamp; the seed ran
 *    2026-07-24T06:58Z, the next insert is four days later) for a date that was
 *    already behind the app clock;
 *  - `design-reference/lib/etlms-seed.js` shows the class never taught that
 *    weekday: c2 was seeded Wed+Fri, c6 Thu only, c4 Tue 14:30.
 *
 * SAFETY: reports by default, writes only with `--apply`, and aborts before any
 * write if a single pre-flight assertion fails — the set is a set, and half of it
 * is not a smaller version of it.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/remediate-phantom-lessons.ts
 *   npx tsx --env-file=.env.local scripts/remediate-phantom-lessons.ts --apply --snapshot backups/<dir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbConnect } from "../src/lib/db";
import {
  AttendanceModel, ClassModel, HomeworkModel, LessonModel, StudentModel, mongoose,
} from "../src/lib/models";
import { computeRevenue, teachingHours, attendanceRate } from "../src/lib/finance";
import { digestLessons } from "../src/lib/migration";
import { TODAY_ISO } from "../src/lib/constants";
import type { AttendanceRecord, Klass, Lesson, Student } from "../src/lib/types";

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const clean = "-_id -__v";
const SEED_BATCH_END = new Date("2026-07-24T07:03:00Z");
const MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const rule = "=".repeat(76);

/** The 32 records, as recorded by the Gate 5.4 audit. Hard-coded on purpose: the
 * script re-derives the set independently and refuses to run unless the two agree
 * exactly, so a drifted heuristic can only ever abort, never delete something new. */
const PHANTOM_IDS: readonly string[] = [
  // c4 — Tue 10:08 back-filled onto dates already holding the genuine Tue 14:30
  "L-c4-2026-06-02-1008", "L-c4-2026-06-09-1008", "L-c4-2026-06-16-1008",
  "L-c4-2026-06-23-1008", "L-c4-2026-06-30-1008", "L-c4-2026-07-07-1008",
  // c6 — Fri/Sat/Sun 17:00; c6 was seeded Thursday-only
  "L-c6-2026-06-05-1700", "L-c6-2026-06-06-1700", "L-c6-2026-06-07-1700",
  "L-c6-2026-06-12-1700", "L-c6-2026-06-13-1700", "L-c6-2026-06-14-1700",
  "L-c6-2026-06-19-1700", "L-c6-2026-06-20-1700", "L-c6-2026-06-21-1700",
  "L-c6-2026-06-26-1700", "L-c6-2026-06-27-1700", "L-c6-2026-06-28-1700",
  "L-c6-2026-07-03-1700", "L-c6-2026-07-04-1700", "L-c6-2026-07-05-1700",
  // c2 — Thu 10:00; c2 was seeded Wed 16:00 + Fri 10:00
  "L-c2-2026-06-04-1000", "L-c2-2026-06-11-1000", "L-c2-2026-06-18-1000",
  "L-c2-2026-06-25-1000", "L-c2-2026-07-02-1000", "L-c2-2026-07-09-1000",
  // c2 — Sun 10:00 (upgraded to high confidence, Gate 5.4 §4)
  "L-c2-2026-06-07-1000", "L-c2-2026-06-14-1000", "L-c2-2026-06-21-1000",
  "L-c2-2026-06-28-1000", "L-c2-2026-07-05-1000",
];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshotDir = arg("--snapshot");
  await dbConnect();

  const [classes, students, attendance, homework] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    StudentModel.find().select(clean).lean<Student[]>(),
    AttendanceModel.find().select("lessonId -_id").lean<Array<{ lessonId: string }>>(),
    HomeworkModel.find().select("lessonId -_id").lean<Array<{ lessonId: string | null }>>(),
  ]);
  const raw = await LessonModel.find({}).lean<Array<Lesson & { _id: { getTimestamp(): Date } }>>();
  const lessons: Lesson[] = raw.map(({ _id, ...r }) => r as Lesson);
  const createdAt = new Map(raw.map((l) => [l.id, l._id.getTimestamp()]));
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const attended = new Set(attendance.map((a) => a.lessonId));
  const homeworked = new Set(homework.map((h) => h.lessonId).filter((x): x is string => !!x));

  console.log(rule);
  console.log(`PHANTOM LESSON REMEDIATION — ${apply ? "APPLY" : "REPORT ONLY"}`);
  console.log(`app clock ${TODAY_ISO}`);
  console.log(rule);

  const blockers: string[] = [];

  /* ---- 1. re-derive the set independently, and require exact agreement ---- */
  const derived = lessons
    .filter((l) => l.type === "regular" && l.date < TODAY_ISO && !l.originalDate &&
      (createdAt.get(l.id) ?? new Date(0)) >= SEED_BATCH_END)
    .map((l) => l.id)
    .sort();
  const expected = [...PHANTOM_IDS].sort();
  const onlyDerived = derived.filter((id) => !expected.includes(id));
  const onlyExpected = expected.filter((id) => !derived.includes(id));
  console.log(`\n1. INDEPENDENT RE-DERIVATION`);
  console.log(`   recorded list : ${expected.length}`);
  console.log(`   re-derived    : ${derived.length}`);
  if (onlyDerived.length) blockers.push(`re-derivation found ${onlyDerived.length} id(s) not in the recorded list: ${onlyDerived.join(", ")}`);
  if (onlyExpected.length) blockers.push(`recorded list has ${onlyExpected.length} id(s) the re-derivation does not find: ${onlyExpected.join(", ")}`);
  console.log(`   agreement     : ${onlyDerived.length === 0 && onlyExpected.length === 0 ? "EXACT" : "*** MISMATCH ***"}`);

  /* ---- 2. per-record pre-flight ---- */
  console.log(`\n2. PRE-FLIGHT PER RECORD`);
  const fromIdRefs = new Map<string, string[]>();
  for (const l of lessons) {
    if (l.fromId) fromIdRefs.set(l.fromId, [...(fromIdRefs.get(l.fromId) ?? []), l.id]);
  }
  for (const id of expected) {
    const l = byId.get(id);
    if (!l) { blockers.push(`${id} — not present in the collection`); continue; }
    const p: string[] = [];
    if (l.type !== "regular") p.push(`type is ${l.type}`);
    if (l.status !== "Completed") p.push(`status is ${l.status}`);
    if (l.date >= TODAY_ISO) p.push(`date ${l.date} is not behind the app clock`);
    if (l.originalDate) p.push("carries a reschedule origin");
    if ((l.notes ?? "").trim() !== "") p.push("carries teacher's notes");
    if (attended.has(id)) p.push("has an attendance record");
    if (homeworked.has(id)) p.push("referenced by homework");
    if (fromIdRefs.has(id)) p.push(`referenced via fromId by ${fromIdRefs.get(id)!.join(", ")}`);
    if ((createdAt.get(id) ?? new Date(0)) < SEED_BATCH_END) p.push("belongs to the seed batch");
    if (p.length) blockers.push(`${id} — ${p.join("; ")}`);
  }
  console.log(`   records checked ......... ${expected.length}`);
  console.log(`   all Completed ........... ${expected.every((id) => byId.get(id)?.status === "Completed")}`);
  console.log(`   any attendance .......... ${expected.filter((id) => attended.has(id)).length}`);
  console.log(`   any homework ref ........ ${expected.filter((id) => homeworked.has(id)).length}`);
  console.log(`   any fromId ref .......... ${expected.filter((id) => fromIdRefs.has(id)).length}`);
  console.log(`   any notes ............... ${expected.filter((id) => (byId.get(id)?.notes ?? "").trim() !== "").length}`);
  console.log(`   any reschedule origin ... ${expected.filter((id) => !!byId.get(id)?.originalDate).length}`);

  /* ---- 3. snapshot gate ---- */
  console.log(`\n3. SNAPSHOT GATE`);
  if (!snapshotDir) {
    if (apply) blockers.push("--apply requires --snapshot <dir>");
    console.log(`   (no --snapshot given; required only for --apply)`);
  } else {
    const manifest = JSON.parse(readFileSync(join(snapshotDir, "manifest.json"), "utf8"));
    const live = digestLessons(lessons);
    console.log(`   snapshot ....... ${snapshotDir}`);
    console.log(`   manifest digest  ${manifest.lessons.digest}`);
    console.log(`   live digest      ${live.digest}`);
    if (manifest.lessons.digest !== live.digest) {
      blockers.push("the snapshot's lessons digest no longer matches the live collection — it is not a rollback path for this state");
    }
    console.log(`   match .......... ${manifest.lessons.digest === live.digest}`);
  }

  /* ---- 4. projected effect ---- */
  const survivors = lessons.filter((l) => !expected.includes(l.id));
  console.log(`\n4. PROJECTED EFFECT (application's own formulas)`);
  console.log(`   month     denom      revenue before ->  after         hours        att%`);
  for (const m of MONTHS) {
    const b = computeRevenue(m, { classes, students, lessons, attendance: [] as AttendanceRecord[] });
    void b;
    const rb = computeRevenue(m, { classes, students, lessons, attendance: await att() }).total;
    const ra = computeRevenue(m, { classes, students, lessons: survivors, attendance: await att() }).total;
    const hb = teachingHours(m, { lessons }), ha = teachingHours(m, { lessons: survivors });
    const ab = attendanceRate(m, { lessons, attendance: await att() });
    const aa = attendanceRate(m, { lessons: survivors, attendance: await att() });
    const dn = (ls: Lesson[]) => ls.filter((l) => l.type === "regular" && l.date.startsWith(m)).length;
    console.log(`   ${m}  ${String(dn(lessons)).padStart(2)}->${String(dn(survivors)).padStart(2)}` +
      `  ${String(rb).padStart(11)} -> ${String(ra).padStart(11)}` +
      `   ${String(hb).padStart(5)}->${String(ha).padStart(5)}   ${String(ab).padStart(3)}->${String(aa).padStart(3)}`);
  }
  console.log(`   lesson documents: ${lessons.length} -> ${survivors.length}`);

  /* ---- 5. verdict ---- */
  console.log(`\n${rule}`);
  if (blockers.length > 0) {
    console.log(`ABORTED — ${blockers.length} blocker(s). NOTHING WAS WRITTEN.`);
    for (const b of blockers) console.log(`  ! ${b}`);
    console.log(rule);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }
  console.log(`PRE-FLIGHT CLEAN — ${expected.length} record(s) eligible for deletion`);
  if (!apply) {
    console.log(`REPORT ONLY. Re-run with --apply --snapshot <dir> to execute.`);
    console.log(rule);
    await mongoose.disconnect();
    return;
  }

  /* ---- 6. the write ---- */
  const res = await LessonModel.deleteMany({ id: { $in: [...expected] } });
  console.log(`DELETED: ${res.deletedCount}`);
  const after = await LessonModel.find().select(clean).lean<Lesson[]>();
  console.log(`lessons remaining: ${after.length}`);
  console.log(`new lessons digest: ${digestLessons(after).digest}`);
  console.log(rule);

  async function att(): Promise<AttendanceRecord[]> {
    return AttendanceModel.find().select(clean).lean<AttendanceRecord[]>();
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
