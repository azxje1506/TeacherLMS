/* RECURRENCE_DESIGN.md §6 — the migration report (Sprint 5.6.3).
 *
 * Run with:  npm run lessons:migration-report
 *            npm run lessons:migration-report -- --json
 *
 * THIS SCRIPT NEVER WRITES. Like `lessons:reconcile` it issues `find()` queries
 * only, and the verification it calls (src/lib/migration.ts) is pure. Safe to run
 * against production.
 *
 * HOW IT DIFFERS FROM `npm run lessons:reconcile`
 * That one answers "what WOULD the reconciler do?". This one answers the question
 * a person has to sign off before anything is written:
 *
 *   - is every legacy reschedule genuinely a move, and is the origin triple the
 *     back-fill would stamp the right one? (§6 Phase 0)
 *   - would stamping it change a single reconciliation decision? (it must not —
 *     that is what makes `legacyOriginFallback` removable)
 *   - is every planned retirement provable as a future orphan WITHOUT trusting
 *     the planner that produced it? (§6 Phase 3)
 *   - does any write verb touch a lesson the design protects? (§6 Phase 4)
 *
 * DETERMINISTIC BY DESIGN. The output carries no timestamp and every list is
 * sorted, so two runs over unchanged data are byte-identical: `--digest` prints
 * one line to compare, and the full text diffs cleanly against a signed-off copy.
 * That is the difference between a report and a screenshot. */

import { createHash } from "node:crypto";

import { dbConnect } from "../src/lib/db";
import { AttendanceModel, ClassModel, HomeworkModel, LessonModel, mongoose } from "../src/lib/models";
import { buildMigrationReport, formatMigrationReport } from "../src/lib/migration";
import { reconcileContext, windowMonths } from "../src/lib/recurrence";
import { RETIRE_ENABLED } from "../src/lib/reconciler";
import type { Klass, Lesson } from "../src/lib/types";

/* Read-only, enforced rather than asserted — see scripts/recurrence-report.ts. */
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const clean = "-_id -__v";

async function main() {
  const asJson = process.argv.includes("--json");
  const digestOnly = process.argv.includes("--digest");

  await dbConnect();
  const [classes, lessons, attendance, homework] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select("lessonId -_id").lean<Array<{ lessonId: string }>>(),
    HomeworkModel.find().select("lessonId -_id").lean<Array<{ lessonId: string | null }>>(),
  ]);

  const report = buildMigrationReport({
    classes,
    lessons,
    ctx: reconcileContext({
      months: windowMonths(),
      attended: new Set(attendance.map((a) => a.lessonId)),
      homeworked: new Set(homework.map((h) => h.lessonId).filter((id): id is string => !!id)),
      // Still on. Removing it is what Phase 0 buys, and only after the back-fill
      // has been applied AND verified (§5.4, §6 Phase 0).
      legacyOriginFallback: true,
    }),
    retireEnabled: RETIRE_ENABLED,
  });

  const body = asJson ? JSON.stringify(report, null, 2) : formatMigrationReport(report);
  const digest = createHash("sha256").update(body).digest("hex");

  if (digestOnly) {
    console.log(digest);
  } else {
    console.log(body);
    if (!asJson) console.log(`  report digest (sha256) .... ${digest}\n`);
  }

  // A failed verification must be visible to a shell, not only to a reader.
  if (!report.verdict.ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
