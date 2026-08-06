/* Recurrence reconciliation — REPORT-ONLY dry run (Sprint 5.6.0 plumbing).
 *
 * Run with:  npm run lessons:reconcile
 *            npm run lessons:reconcile -- --json    (machine-readable)
 *
 * THIS SCRIPT NEVER WRITES. It opens the same connection the app uses and issues
 * `find()` queries only — no insert, update, delete, bulkWrite or index change
 * appears anywhere in this file, and the planner it calls (src/lib/recurrence.ts)
 * is a pure function with no database access at all. It is safe to run against
 * production.
 *
 * WHAT IT ANSWERS
 * "If the reconciler described in RECURRENCE_DESIGN.md §5 ran right now, what
 * would it do?" — expressed as the four verbs: keep, update, insert, retire,
 * plus the frozen lessons it refused to touch and why.
 *
 * It is the harness Sprint 5.6.1 fills in, and it already covers §6 Phase 3's
 * two blind spots in `npm run lessons:duplicates`:
 *  - orphans that sit ALONE on their date (the detector only reports dates
 *    holding two or more lessons, so it cannot see them);
 *  - lessons whose class has been deleted outright.
 *
 * It also lists the §6 Phase 0 back-fill work — the legacy reschedules that
 * carry no stored origin — WITHOUT performing it. The back-fill is a database
 * write and is deliberately not part of this sprint. */

import { dbConnect } from "../src/lib/db";
import { AttendanceModel, ClassModel, HomeworkModel, LessonModel, mongoose } from "../src/lib/models";
import { DOW_FULL } from "../src/lib/constants";
import {
  findArchivedClassLessons, findLegacyReschedules, findOrphanedLessons, FREEZE_LABEL,
  planReconciliation, reconcileContext, summarizePlan, weekdayOf, type PlanAction,
} from "../src/lib/recurrence";
import type { Klass, Lesson } from "../src/lib/types";

const clean = "-_id -__v";

/* The read-only guarantee, enforced rather than asserted. Mongoose otherwise
 * issues `createCollection` + `createIndexes` the first time a model is used —
 * small writes, but writes. Both options are read AFTER the connection opens
 * (`Model.init`, mongoose/lib/model.js), so setting them here, before connecting,
 * suppresses them for this process only. The app's own connection (src/lib/db.ts)
 * is untouched and keeps its normal behaviour. */
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

async function main() {
  const json = process.argv.includes("--json");

  await dbConnect();
  const [classes, lessons, attendance, homework] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select("lessonId -_id").lean<Array<{ lessonId: string }>>(),
    HomeworkModel.find().select("lessonId -_id").lean<Array<{ lessonId: string | null }>>(),
  ]);

  const ctx = reconcileContext({
    attended: new Set(attendance.map((a) => a.lessonId)),
    homeworked: new Set(homework.map((h) => h.lessonId).filter((id): id is string => !!id)),
  });

  const plan = planReconciliation(classes, lessons, ctx);
  const legacy = findLegacyReschedules(lessons);
  const orphans = findOrphanedLessons(classes, lessons);
  // ADR-002 removed Archived classes from the plan. §5.8 requires them to stay
  // visible, so what used to appear as retirements is reported here instead.
  const archived = findArchivedClassLessons(classes, lessons, ctx.appClock);

  // How many Regular lessons share each class+date — a retirement that is alone
  // on its date is invisible to `npm run lessons:duplicates` (§6 Phase 3).
  const groupSize = new Map<string, number>();
  for (const l of lessons) {
    if (l.type !== "regular") continue;
    const key = `${l.classId}|${l.date}`;
    groupSize.set(key, (groupSize.get(key) ?? 0) + 1);
  }
  const alone = (a: PlanAction) => (groupSize.get(`${a.classId}|${a.date}`) ?? 0) < 2;

  const className = new Map(classes.map((c) => [c.id, c.name]));

  if (json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      appClock: plan.appClock,
      window: plan.months,
      mode: "report-only",
      summary: summarizePlan(plan.actions),
      actions: plan.actions,
      invisibleToDuplicateDetector: plan.actions.filter((a) => a.verb === "retire" && alone(a)).length,
      legacyReschedules: legacy.map(({ lesson, inferred }) => ({
        id: lesson.id, classId: lesson.classId, date: lesson.date, start: lesson.start, inferred,
      })),
      orphanedLessons: orphans.map((l) => ({ id: l.id, classId: l.classId, date: l.date, status: l.status })),
      archivedClasses: archived.map(({ klass, lessons: lingering }) => ({
        classId: klass.id,
        name: klass.name,
        lingeringFutureLessons: lingering.length,
        from: lingering.map((l) => l.date).sort()[0],
        to: lingering.map((l) => l.date).sort().at(-1),
      })),
    }, null, 2));
    return;
  }

  const rule = "=".repeat(72);
  console.log(rule);
  console.log("RECURRENCE RECONCILIATION — READ-ONLY DRY RUN");
  console.log(`Generated ${new Date().toISOString()}   app clock ${plan.appClock}`);
  console.log(`Window ${plan.months[0]} .. ${plan.months[plan.months.length - 1]}`);
  console.log("Nothing has been created, updated or deleted. See RECURRENCE_DESIGN.md.");
  console.log(rule);

  // ---- Phase 0 work list (reported, NOT performed) ----
  console.log("");
  console.log("PHASE 0 — legacy reschedules with no stored origin (§6)");
  console.log(`  ${legacy.length} lesson(s) would need an origin back-fill before the`);
  console.log("  reconciler may run in enforcing mode. NOT written by this script.");
  for (const { lesson, inferred } of legacy) {
    console.log(`    ${lesson.id}`);
    console.log(`      now ${lesson.date} ${lesson.start}  <-  inferred origin ${inferred.date} ${inferred.start}`);
  }

  // ---- the plan, per class ----
  const byClass = new Map<string, PlanAction[]>();
  for (const a of plan.actions) {
    const arr = byClass.get(a.classId);
    if (arr) arr.push(a);
    else byClass.set(a.classId, [a]);
  }

  for (const [classId, actions] of byClass) {
    const s = summarizePlan(actions);
    // Converged — nothing to say. A strand counts: the lesson is untouched, but
    // it is out of step with its class and wants a human (§5.9).
    if (s.update + s.insert + s.retire + s.strand === 0) continue;
    console.log("");
    console.log("-".repeat(72));
    console.log(`Class:\n  ${className.get(classId) ?? "—"}  (${classId})`);
    console.log(`\n  keep=${s.keep}  update=${s.update}  insert=${s.insert}  retire=${s.retire}` +
      `  strand=${s.strand}  skip=${s.skip}`);
    for (const a of actions) {
      if (a.verb === "keep") continue;
      const when = `${a.date} (${DOW_FULL[weekdayOf(a.date)]})`;
      if (a.verb === "update") {
        console.log(`\n  UPDATE   ${when}`);
        console.log(`    Lesson ID:  ${a.lessonId}  (unchanged — the id is opaque)`);
        console.log(`    From:       ${a.from.start} (${a.from.duration} min)`);
        console.log(`    To:         ${a.to.start} (${a.to.duration} min)`);
      } else if (a.verb === "insert") {
        console.log(`\n  INSERT   ${when}`);
        console.log(`    Would mint: ${a.lessonId}`);
        console.log(`    Slot:       ${a.start} (${a.duration} min)  status ${a.status}`);
      } else if (a.verb === "retire") {
        console.log(`\n  RETIRE   ${when}`);
        console.log(`    Lesson ID:  ${a.lessonId}`);
        console.log(`    Slot:       ${a.start} (${a.duration} min)`);
        console.log(`    Reason:     ${a.reason}`);
        if (alone(a)) console.log(`    NOTE:       alone on its date — invisible to lessons:duplicates`);
      } else if (a.verb === "strand") {
        console.log(`\n  STRAND   ${when}`);
        console.log(`    Lesson ID:  ${a.lessonId}`);
        console.log(`    Slot:       ${a.start} (${a.duration} min)`);
        console.log(`    Reason:     ${a.reason}`);
        console.log(`    Notes:      ${a.notes.replace(/\s+/g, " ").slice(0, 60)}`);
        console.log(`    ACTION:     move it, cancel it, or clear the note and let it retire`);
      } else {
        console.log(`\n  SKIP     ${when}`);
        console.log(`    Lesson ID:  ${a.lessonId}`);
        console.log(`    Slot:       ${a.start} (${a.duration} min)`);
        console.log(`    PROTECTED:  ${a.frozen.map((f) => FREEZE_LABEL[f]).join("; ")}`);
      }
    }
  }

  if (archived.length > 0) {
    console.log("");
    console.log(rule);
    console.log("ARCHIVED CLASSES — outside reconciliation (§5.8, ADR-002)");
    console.log("An archived class has withdrawn its intent, so its schedule is a fossil and");
    console.log("nothing is compared against it: no update, no insert, no retire. The future");
    console.log("lessons below simply stay put until they age out of the rolling window.");
    console.log("Retiring them is a one-shot archive-transition action, not reconciliation.");
    console.log(rule);
    for (const { klass, lessons: lingering } of archived) {
      const dates = lingering.map((l) => l.date).sort();
      console.log(`  ${klass.name}  (${klass.id})`);
      console.log(`    ${lingering.length} future Upcoming regular lesson(s)  ${dates[0]} .. ${dates[dates.length - 1]}`);
    }
  }

  if (orphans.length > 0) {
    console.log("");
    console.log(rule);
    console.log("ORPHANED LESSONS — their class no longer exists");
    console.log("Never reconciled: with no schedule there is nothing to compare against.");
    console.log(rule);
    for (const l of orphans) {
      console.log(`  ${l.id}  ${l.date} ${l.start}  ${l.status}  (classId ${l.classId})`);
    }
  }

  const s = summarizePlan(plan.actions);
  const invisible = plan.actions.filter((a) => a.verb === "retire" && alone(a)).length;
  console.log("");
  console.log(rule);
  console.log("SUMMARY");
  console.log(rule);
  console.log(`  Classes planned .......................... ${classes.length}`);
  console.log(`  Already correct (keep) ................... ${s.keep}`);
  console.log(`  Would UPDATE in place .................... ${s.update}`);
  console.log(`  Would INSERT ............................. ${s.insert}`);
  console.log(`  Would RETIRE (hard delete) ............... ${s.retire}`);
  console.log(`    ...alone on their date (unseen by the`);
  console.log(`       duplicate detector) ................. ${invisible}`);
  console.log(`  Stranded — noted, no slot, undeletable .... ${s.strand}`);
  console.log(`  Frozen, left alone (skip) ................ ${s.skip}`);
  console.log(`  Legacy reschedules needing Phase 0 ....... ${legacy.length}`);
  console.log(`  Orphaned lessons (class deleted) ......... ${orphans.length}`);
  console.log(`  Archived classes holding future lessons .. ${archived.length}` +
    ` (${archived.reduce((n, a) => n + a.lessons.length, 0)} lesson(s), never reconciled)`);
  console.log("");
  console.log("  This is a report. Nothing has been written.");
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
