/* Duplicate Regular lesson detector — REPORTING ONLY.
 *
 * Run with:  npm run lessons:duplicates
 *            npm run lessons:duplicates -- --json    (machine-readable)
 *
 * THIS SCRIPT NEVER WRITES. It opens the same connection the app uses and issues
 * `find()` queries only — no insert, update, delete, bulkWrite or index change
 * appears anywhere in this file. It is safe to run against production.
 *
 * WHAT IT LOOKS FOR
 * A class's Regular lessons are generated with the id `L-<classId>-<date>-<HHMM>`,
 * where HHMM is the start time of the schedule slot they came from. Editing a
 * class's slot start therefore changes the id the generator computes, so it
 * inserts a NEW lesson for every date in its window and leaves the old series
 * untouched — the recurring series forks, and the class appears twice on the
 * same day at two different times. See LESSON_DUPLICATES.md for the full
 * mechanism and the migration this report is meant to feed.
 *
 * WHAT IT DELIBERATELY DOES NOT FLAG
 * A lesson that was rescheduled onto a day that already has one is not a fork —
 * it is a teacher's decision, and it must never be proposed for deletion. Those
 * are detected (via the stored reschedule origin, or via an id whose encoded
 * date no longer matches the lesson's date) and reported separately. */

import { dbConnect } from "../src/lib/db";
import { ClassModel, LessonModel, AttendanceModel, mongoose } from "../src/lib/models";
import { TODAY_ISO, DOW_FULL } from "../src/lib/constants";
// The judging itself is pure and lives in src/lib/duplicates.ts, so it can be
// unit-tested without a database — this file calls `main()` at module load and
// could never be imported by a test.
import { judgeDate, noKeep, weekdayOf, type Judged } from "../src/lib/duplicates";
import type { Klass, Lesson } from "../src/lib/types";

const clean = "-_id -__v";

/* Mongoose would otherwise issue `createCollection` + `createIndexes` on first
 * use of a model — small writes, but writes, and this script promises none.
 * Both are read after the connection opens, so setting them here is effective
 * and affects this process only (see scripts/recurrence-report.ts). */
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

interface Group {
  klass: Klass;
  date: string;
  weekday: number;
  judged: Judged[];
  /** True when nothing on this date occupies a slot the class still teaches. */
  noKeep: boolean;
}

async function main() {
  const json = process.argv.includes("--json");

  await dbConnect();
  const [classes, lessons, attendance] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    LessonModel.find({ type: "regular" }).select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select("lessonId -_id").lean<Array<{ lessonId: string }>>(),
  ]);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const attended = new Set(attendance.map((a) => a.lessonId));

  // ---- group Regular lessons by class + date ----
  const groups = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const key = `${l.classId}|${l.date}`;
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }

  const forks: Group[] = [];
  const sameTimeCollisions: Group[] = [];

  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    const [classId, date] = key.split("|");
    const klass = classById.get(classId);
    if (!klass) continue;

    const judged = judgeDate({ klass, date, lessons: arr, attended, appClock: TODAY_ISO });
    const group: Group = { klass, date, weekday: weekdayOf(date), judged, noKeep: noKeep(judged) };

    // What separates an actionable group from an informational one is whether
    // anything on the date is SURPLUS — not whether the lessons happen to share a
    // start time. Routing on distinct start times is what hid the c2 defect: two
    // lessons stored at the same 10:00 against a single 10:00 slot were filed as
    // "never a migration candidate" and never looked at again.
    (judged.some((j) => j.verdict === "CANDIDATE") ? forks : sameTimeCollisions).push(group);
  }

  const byDate = (a: Group, b: Group) => a.klass.name.localeCompare(b.klass.name) || a.date.localeCompare(b.date);
  forks.sort(byDate);
  sameTimeCollisions.sort(byDate);

  if (json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      appClock: TODAY_ISO,
      forks: forks.map(serialise),
      sameTimeCollisions: sameTimeCollisions.map(serialise),
    }, null, 2));
    return;
  }

  report(forks, sameTimeCollisions);
}

function serialise(g: Group) {
  return {
    classId: g.klass.id,
    className: g.klass.name,
    date: g.date,
    weekday: DOW_FULL[g.weekday],
    currentSchedule: (g.klass.schedule ?? []).filter((s) => s.day === g.weekday),
    noKeep: g.noKeep,
    lessons: g.judged.map((j) => ({
      verdict: j.verdict,
      reason: j.reason,
      protections: j.protections,
      id: j.lesson.id,
      start: j.lesson.start,
      duration: j.lesson.duration,
      status: j.lesson.status,
      type: j.lesson.type,
    })),
  };
}

function report(forks: Group[], collisions: Group[]) {
  const rule = "=".repeat(72);
  console.log(rule);
  console.log("DUPLICATE REGULAR LESSONS — READ-ONLY REPORT");
  console.log(`Generated ${new Date().toISOString()}   app clock ${TODAY_ISO}`);
  console.log("Nothing in this report has been modified. See LESSON_DUPLICATES.md.");
  console.log(rule);

  if (forks.length === 0) {
    console.log("\nNo forked recurring series found.\n");
  }

  for (const g of forks) {
    console.log("");
    console.log("-".repeat(72));
    console.log(`Class:\n  ${g.klass.name}  (${g.klass.id})`);
    const slots = (g.klass.schedule ?? []).filter((s) => s.day === g.weekday);
    console.log(`\nCurrent schedule for ${DOW_FULL[g.weekday]}:`);
    console.log(slots.length
      ? slots.map((s) => `  ${s.start} (${s.duration} min)`).join("\n")
      : "  (the class no longer teaches on this weekday)");
    console.log(`\nDate:\n  ${g.date}  (${DOW_FULL[g.weekday]})`);
    console.log(`\nDuplicate candidates:`);
    for (const j of g.judged) {
      console.log("");
      console.log(`  ${j.verdict}`);
      console.log(`    Lesson ID:  ${j.lesson.id}`);
      console.log(`    Start:      ${j.lesson.start}`);
      console.log(`    Duration:   ${j.lesson.duration} min`);
      console.log(`    Status:     ${j.lesson.status}`);
      console.log(`    Type:       ${j.lesson.type}`);
      console.log(`    Reason:     ${j.reason}`);
      if (j.protections.length) {
        console.log(`    PROTECTED:  ${j.protections.join("; ")}`);
      }
    }
    if (g.noKeep) {
      console.log(`\n  !! No lesson on this date matches the class's current schedule.`);
      console.log(`     Review by hand — do not assume any of these can be removed.`);
    }
  }

  if (collisions.length > 0) {
    console.log("");
    console.log(rule);
    console.log("NOTHING SURPLUS — listed for completeness, no candidate here");
    console.log("These dates hold more than one lesson, but every one of them is");
    console.log("accounted for: a reschedule the teacher placed deliberately, an");
    console.log("Archived class outside reconciliation, or a slot the schedule");
    console.log("genuinely still teaches. Not a migration candidate.");
    console.log(rule);
    for (const g of collisions) {
      console.log(`\n  ${g.klass.name} — ${g.date}`);
      for (const j of g.judged) {
        console.log(`    ${j.verdict.padEnd(12)} ${j.lesson.id}  ${j.lesson.start} (${j.lesson.duration} min) ${j.lesson.status}`);
        console.log(`                 ${j.reason}`);
      }
    }
  }

  // ---- totals ----
  const all = forks.flatMap((g) => g.judged);
  const candidates = all.filter((j) => j.verdict === "CANDIDATE");
  const removable = candidates.filter((j) => j.protections.length === 0);
  console.log("");
  console.log(rule);
  console.log("SUMMARY");
  console.log(rule);
  const every = [...all, ...collisions.flatMap((g) => g.judged)];
  console.log(`  Groups holding a surplus lesson ........... ${forks.length}`);
  console.log(`  Groups with nothing occupying a slot ...... ${forks.filter((g) => g.noKeep).length}`);
  console.log(`  Lessons marked KEEP ...................... ${all.filter((j) => j.verdict === "KEEP").length}`);
  console.log(`  Lessons marked CANDIDATE ................. ${candidates.length}`);
  console.log(`    ...of which PROTECTED (never delete) ... ${candidates.length - removable.length}`);
  console.log(`    ...of which safely removable ........... ${removable.length}`);
  console.log(`  Lessons marked RESCHEDULED (never touch) . ${every.filter((j) => j.verdict === "RESCHEDULED").length}`);
  console.log(`  Lessons on an Archived class (§5.8) ...... ${every.filter((j) => j.verdict === "ARCHIVED").length}`);
  console.log(`  Groups with nothing surplus .............. ${collisions.length}`);
  console.log("");
  console.log("  Per affected class:");
  const perClass = new Map<string, { name: string; candidates: number; removable: number }>();
  for (const g of forks) {
    const e = perClass.get(g.klass.id) ?? { name: g.klass.name, candidates: 0, removable: 0 };
    for (const j of g.judged) {
      if (j.verdict !== "CANDIDATE") continue;
      e.candidates++;
      if (j.protections.length === 0) e.removable++;
    }
    perClass.set(g.klass.id, e);
  }
  for (const [id, e] of [...perClass.entries()].sort((a, b) => b[1].candidates - a[1].candidates)) {
    console.log(`    ${e.name.padEnd(28)} (${id})  candidates=${e.candidates}  safely removable=${e.removable}`);
  }
  console.log("");
  console.log("  This is a report. No lesson has been deleted, merged or migrated.");
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
