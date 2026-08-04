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
import type { Klass, Lesson } from "../src/lib/types";

const clean = "-_id -__v";

/** How a lesson in a collided group is classified. */
type Verdict = "KEEP" | "CANDIDATE" | "RESCHEDULED";

interface Judged {
  lesson: Lesson;
  verdict: Verdict;
  reason: string;
  /** Reasons this lesson must not be touched by any future migration. */
  protections: string[];
}

interface Group {
  klass: Klass;
  date: string;
  weekday: number;
  judged: Judged[];
  /** True when nothing on this date matches the class's current schedule. */
  noKeep: boolean;
}

/** Weekday of an ISO date, in local time (matches how the app reads dates). */
function weekdayOf(iso: string): number {
  return new Date(iso + "T00:00:00").getDay();
}

/** The date a generated Regular lesson's id was built for. Null when the id does
 * not follow the generated convention (Makeup `M-…`, Extra `X-…`, ad-hoc ids). */
function dateFromId(id: string): string | null {
  return /^L-.+-(\d{4}-\d{2}-\d{2})-\d{4}$/.exec(id)?.[1] ?? null;
}

/** Has this lesson been deliberately moved? Two signals, because the stored
 * origin fields only exist for moves made after they were introduced: earlier
 * reschedules are only visible as an id whose encoded date no longer matches. */
function wasMoved(l: Lesson): boolean {
  if (l.originalDate) return true;
  const encoded = dateFromId(l.id);
  return encoded !== null && encoded !== l.date;
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

    const weekday = weekdayOf(date);
    const slots = (klass.schedule ?? []).filter((s) => s.day === weekday);

    const judged: Judged[] = arr
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((lesson) => {
        const protections: string[] = [];
        if (lesson.date < TODAY_ISO) protections.push("past lesson (drives revenue for its month)");
        if (attended.has(lesson.id)) protections.push("has an attendance record");
        if (lesson.status === "Cancelled") protections.push("cancelled (a makeup may reference it via fromId)");

        if (wasMoved(lesson)) {
          return {
            lesson, protections, verdict: "RESCHEDULED" as const,
            reason: lesson.originalDate
              ? `deliberately moved from ${lesson.originalDate}`
              : `deliberately moved from ${dateFromId(lesson.id)} (pre-dates the stored origin fields)`,
          };
        }
        const match = slots.find((s) => s.start === lesson.start && s.duration === lesson.duration);
        return match
          ? {
              lesson, protections, verdict: "KEEP" as const,
              reason: "matches the class's current schedule for this weekday",
            }
          : {
              lesson, protections, verdict: "CANDIDATE" as const,
              reason: slots.length === 0
                ? "the class no longer teaches on this weekday"
                : "no slot in the class's current schedule has this start/duration",
            };
      });

    // Distinct start times is what separates a forked series from a reschedule
    // that happened to land on an occupied day.
    const distinctStarts = new Set(judged.map((j) => j.lesson.start)).size;
    const group: Group = {
      klass, date, weekday, judged,
      noKeep: !judged.some((j) => j.verdict === "KEEP"),
    };
    (distinctStarts > 1 ? forks : sameTimeCollisions).push(group);
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
    console.log("SAME-TIME COLLISIONS — NOT forked series, listed for completeness");
    console.log("Two lessons share a date AND a start time. These come from a lesson");
    console.log("being rescheduled onto a day that already had one, which is a");
    console.log("teacher's decision. Never a migration candidate.");
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
  console.log(`  Forked class+date groups .................. ${forks.length}`);
  console.log(`  Groups with no surviving KEEP ............. ${forks.filter((g) => g.noKeep).length}`);
  console.log(`  Lessons marked KEEP ...................... ${all.filter((j) => j.verdict === "KEEP").length}`);
  console.log(`  Lessons marked CANDIDATE ................. ${candidates.length}`);
  console.log(`    ...of which PROTECTED (never delete) ... ${candidates.length - removable.length}`);
  console.log(`    ...of which safely removable ........... ${removable.length}`);
  console.log(`  Lessons marked RESCHEDULED (never touch) . ${all.filter((j) => j.verdict === "RESCHEDULED").length}`);
  console.log(`  Same-time collisions ..................... ${collisions.length}`);
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
