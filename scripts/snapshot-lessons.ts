/* RECURRENCE_DESIGN.md §6 Phase 1 (snapshot) + Phase 2 (baseline).
 *
 * Run with:  npm run lessons:snapshot
 *            npm run lessons:snapshot -- --out backups/before-phase-0
 *
 * THIS SCRIPT NEVER WRITES TO THE DATABASE. It issues `find()` queries only and
 * writes files to disk. Safe to run against production, and it is the thing §6
 * calls non-negotiable: the retire verb is a hard delete with no undo, and even
 * the additive Phase 0 back-fill must be reversible before it is permitted.
 *
 * WHAT IT PRODUCES, in one directory
 *   lessons.json / attendances.json / billings.json / homeworks.json
 *       — the four collections §6 Phase 1 names, exported verbatim.
 *   baseline.json
 *       — §6 Phase 2: revenue, teaching hours and attendance rate for every
 *         month the data touches, per class and in total. Phase 5 recomputes
 *         these and requires every PAST month to be bit-identical.
 *   manifest.json
 *       — counts, the lessons digest, and the exact ids Phase 0 would stamp.
 *         `lessons:backfill-origins -- --apply` refuses to run without a
 *         manifest whose digest still matches the live collection.
 *   ROLLBACK.md
 *       — the precise commands that undo the Phase 0 back-fill, and the fuller
 *         restore path, generated from THIS snapshot's contents.
 *
 * No automated restore ships with it, deliberately. Restoring is a destructive
 * act on a production database and belongs to a person following a checklist
 * (MIGRATION_PHASE0.md), not to a script that can be run by accident. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dbConnect } from "../src/lib/db";
import {
  AttendanceModel, BillingModel, ClassModel, HomeworkModel, LessonModel, StudentModel, mongoose,
} from "../src/lib/models";
import { CURRENT_MONTH, TODAY_ISO } from "../src/lib/constants";
import { attendanceRate, computeRevenue, teachingHours } from "../src/lib/finance";
import {
  digestLessons, verifyPhase0, type MonthBaseline, type SnapshotManifest,
} from "../src/lib/migration";
import { monthOf, reconcileContext, windowMonths } from "../src/lib/recurrence";
import { RETIRE_ENABLED } from "../src/lib/reconciler";
import type { AttendanceRecord, Billing, Homework, Klass, Lesson, Student } from "../src/lib/types";

/* Read-only, enforced rather than asserted — see scripts/recurrence-report.ts. */
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const clean = "-_id -__v";

function outDir(): string {
  const i = process.argv.indexOf("--out");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return join("backups", `snapshot-${stamp}`);
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

async function main() {
  const dir = outDir();
  await dbConnect();

  const [classes, students, lessons, attendance, billing, homework] = await Promise.all([
    ClassModel.find().select(clean).lean<Klass[]>(),
    StudentModel.find().select(clean).lean<Student[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select(clean).lean<AttendanceRecord[]>(),
    BillingModel.find().select(clean).lean<Billing[]>(),
    HomeworkModel.find().select(clean).lean<Homework[]>(),
  ]);

  // ---- §6 Phase 2 — baseline every month the data touches ----
  const months = [...new Set(lessons.map((l) => monthOf(l.date)))].sort();
  const baseline: MonthBaseline[] = months.map((month) => ({
    month,
    past: month < CURRENT_MONTH,
    revenue: computeRevenue(month, { classes, students, lessons, attendance }),
    teachingHours: teachingHours(month, { lessons }),
    attendanceRate: attendanceRate(month, { lessons, attendance }),
    lessonCounts: {
      regular: lessons.filter((l) => monthOf(l.date) === month && l.type === "regular").length,
      makeup: lessons.filter((l) => monthOf(l.date) === month && l.type === "makeup").length,
      extra: lessons.filter((l) => monthOf(l.date) === month && l.type === "extra").length,
    },
  }));

  // ---- what a Phase 0 apply would stamp, so ROLLBACK.md can name it exactly ----
  const ctx = reconcileContext({
    months: windowMonths(),
    attended: new Set(attendance.map((a) => a.lessonId)),
    homeworked: new Set(homework.map((h) => h.lessonId).filter((id): id is string => !!id)),
    legacyOriginFallback: true,
  });
  const phase0 = verifyPhase0(classes, lessons, ctx);

  const manifest: SnapshotManifest = {
    appClock: TODAY_ISO,
    window: ctx.months,
    retireEnabled: RETIRE_ENABLED,
    collections: {
      lessons: lessons.length,
      attendances: attendance.length,
      billings: billing.length,
      homeworks: homework.length,
    },
    lessons: digestLessons(lessons),
    phase0Targets: phase0.map((p) => p.lessonId),
    baseline,
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "lessons.json"), json(lessons));
  writeFileSync(join(dir, "attendances.json"), json(attendance));
  writeFileSync(join(dir, "billings.json"), json(billing));
  writeFileSync(join(dir, "homeworks.json"), json(homework));
  writeFileSync(join(dir, "baseline.json"), json(baseline));
  writeFileSync(join(dir, "manifest.json"), json(manifest));
  writeFileSync(join(dir, "ROLLBACK.md"), rollbackDoc(dir, manifest, phase0.map((p) => p.lessonId)));

  const rule = "=".repeat(72);
  console.log(rule);
  console.log("PHASE 1 SNAPSHOT + PHASE 2 BASELINE");
  console.log(rule);
  console.log(`  Directory ................................ ${dir}`);
  console.log(`  Lessons .................................. ${lessons.length}`);
  console.log(`  Attendance records ....................... ${attendance.length}`);
  console.log(`  Billing records .......................... ${billing.length}`);
  console.log(`  Homework items ........................... ${homework.length}`);
  console.log(`  Lessons digest ........................... ${manifest.lessons.digest}`);
  console.log(`  Months baselined ......................... ${baseline.length}` +
    ` (${baseline.filter((b) => b.past).length} past — these may never move)`);
  console.log(`  Phase 0 targets recorded ................. ${manifest.phase0Targets.length}`);
  console.log("");
  console.log("  Nothing in the database was touched. Rollback instructions:");
  console.log(`    ${join(dir, "ROLLBACK.md")}`);
  console.log("");
  console.log("  Next: npm run lessons:backfill-origins -- --apply --snapshot " + dir);
  console.log("");
}

/** Rollback instructions generated from this snapshot's own contents.
 *
 * Two levels, because the two writes have very different blast radii. Undoing
 * Phase 0 is an `$unset` on named ids and needs nothing but this file. Undoing a
 * retire — which is not enabled and not performed by this sprint — needs the
 * exported documents, because a hard delete leaves nothing behind. */
function rollbackDoc(dir: string, m: SnapshotManifest, targets: string[]): string {
  const db = process.env.MONGODB_DB || "etlms";
  const ids = targets.map((id) => `    "${id}"`).join(",\n");
  return `# Rollback — snapshot \`${dir}\`

Generated by \`npm run lessons:snapshot\` (RECURRENCE_DESIGN.md §6 Phase 1).
Database: \`${db}\`. App clock: \`${m.appClock}\`. \`RETIRE_ENABLED\`: \`${m.retireEnabled}\`.

| Collection | Documents |
|---|---|
| lessons | ${m.collections.lessons} |
| attendances | ${m.collections.attendances} |
| billings | ${m.collections.billings} |
| homeworks | ${m.collections.homeworks} |

Lessons digest (sha256 over the sorted document fingerprints):

\`\`\`
${m.lessons.digest}
\`\`\`

\`lessons:backfill-origins -- --apply\` recomputes this digest and refuses to run
if it has moved, so this snapshot can only ever be used against the state it
describes.

---

## 1. Undo the Phase 0 back-fill

The back-fill writes three fields — \`originalDate\`, \`originalStart\`,
\`originalDuration\` — onto ${targets.length} lesson(s) that had none of them. It
changes nothing else, so removing those three fields restores the exact prior
state. Run in \`mongosh\`:

\`\`\`javascript
use ${db};
const ids = [
${ids}
];
db.lessons.updateMany(
  { id: { $in: ids } },
  { $unset: { originalDate: "", originalStart: "", originalDuration: "" } }
);
\`\`\`

Then confirm the collection is back to this snapshot:

\`\`\`
npm run lessons:snapshot -- --out backups/verify-rollback
\`\`\`

and check that \`backups/verify-rollback/manifest.json\` carries the digest above.

**Only run this against lessons the back-fill stamped.** A lesson rescheduled
through the UI after the back-fill carries a genuine origin, and the id list
above is the whole safeguard: it names the ${targets.length} lesson(s) that were
stamped by the migration and no others.

## 2. Restore a collection wholesale

Needed only if something other than the origin fields moved — which the
post-apply verification reports as \`collateral\`, and which should be zero.

\`\`\`
mongoimport --uri "$MONGODB_URI" --db ${db} --collection lessons \\
  --file ${dir.replace(/\\/g, "/")}/lessons.json --jsonArray --mode upsert --upsertFields id
\`\`\`

\`--mode upsert\` restores changed documents and re-creates deleted ones. It does
**not** remove documents created after the snapshot; compare counts against the
table above before and after.

The same command with \`attendances\` (\`--upsertFields lessonId\`), \`billings\`
and \`homeworks\` restores those collections.

## 3. Verify the restore against the Phase 2 baseline

\`baseline.json\` holds revenue, teaching hours and attendance rate for every
month, with \`past: true\` on the ${m.baseline.filter((b) => b.past).length} month(s)
that may never move (§6 Phase 5). Re-run the snapshot and diff the two
\`baseline.json\` files: every past month must be identical, character for
character. Any difference means a past lesson was touched.
`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
