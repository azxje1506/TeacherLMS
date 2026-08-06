/* RECURRENCE_DESIGN.md §6 Phase 0 — back-fill legacy reschedule origins.
 *
 * Run with:  npm run lessons:backfill-origins
 *            npm run lessons:backfill-origins -- --apply --snapshot backups/<dir>
 *
 * REPORTS BY DEFAULT. Without `--apply` this script issues `find()` queries only
 * and is safe to run against production; it prints exactly what it WOULD stamp,
 * and the verification that says whether stamping it is safe.
 *
 * WHAT IT WRITES, WITH --apply
 * `originalDate` / `originalStart` / `originalDuration` onto Regular lessons that
 * were rescheduled before those fields existed, and carry none of them. Strictly
 * additive: no id changes, no date changes, no status changes, and no
 * `rescheduledAt` — that field records WHEN a move happened and this back-fill
 * does not know when these moves happened.
 *
 * WHY IT IS MANDATORY AND BLOCKING
 * Not because the reconciler would otherwise delete these lessons — the planner's
 * `legacyOriginFallback` reads the id when the stored origin is absent, and the
 * 5.6.1 dry run confirmed all of them classified as frozen reschedules. What this
 * buys is the ability to REMOVE that fallback: until the origins are stored the
 * reconciler parses a lesson id to make a safety decision, which is the exact
 * coupling ADR-001 exists to eliminate, and the id can never carry `duration`.
 *
 * THE SNAPSHOT GATE (Sprint 5.6.3)
 * §6 Phase 1 puts a full snapshot before ANY write and calls it non-negotiable.
 * `--apply` therefore also requires `--snapshot <dir>` naming a directory made by
 * `npm run lessons:snapshot`, and refuses to proceed unless that snapshot still
 * describes the database about to be written to. A snapshot of a different state
 * is not a rollback — it is a second incident. See MIGRATION_PHASE0.md. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dbConnect } from "../src/lib/db";
import { LessonModel, mongoose } from "../src/lib/models";
import { digestLessons, type SnapshotManifest } from "../src/lib/migration";
import { backfillLegacyOrigins } from "../src/lib/reconciler";
import type { Lesson } from "../src/lib/types";

/* Read-only unless --apply: Mongoose otherwise issues createCollection +
 * createIndexes the first time a model is used — small writes, but writes. Both
 * options are read after the connection opens, so setting them here suppresses
 * them for this process only (see scripts/recurrence-report.ts). */
const apply = process.argv.includes("--apply");
if (!apply) {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
}

function snapshotDir(): string | null {
  const i = process.argv.indexOf("--snapshot");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** The Phase 1 gate. Returns the reason to refuse, or null to proceed. */
function checkSnapshot(dir: string | null): string | null {
  if (!dir) {
    return "--apply requires --snapshot <dir>. Run `npm run lessons:snapshot` first (§6 Phase 1).";
  }
  let manifest: SnapshotManifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
  } catch {
    return `no readable manifest.json in ${dir} — that is not a snapshot made by lessons:snapshot.`;
  }
  if (!manifest.lessons?.digest) return `${dir}/manifest.json carries no lessons digest.`;
  return null;
}

const rule = "=".repeat(72);

async function main() {
  const dir = snapshotDir();
  const refusal = apply ? checkSnapshot(dir) : null;

  await dbConnect();

  // Verify the snapshot still describes THIS database before writing to it.
  let staleSnapshot: string | null = null;
  if (apply && !refusal && dir) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
    const live = digestLessons(await LessonModel.find().select("-_id -__v").lean<Lesson[]>());
    if (live.digest !== manifest.lessons.digest) {
      staleSnapshot =
        `the snapshot in ${dir} no longer describes this database ` +
        `(${manifest.lessons.count} lessons / ${manifest.lessons.digest.slice(0, 12)} ` +
        `vs ${live.count} / ${live.digest.slice(0, 12)}). Take a fresh snapshot.`;
    }
  }

  const blocked = refusal ?? staleSnapshot;
  const result = await backfillLegacyOrigins({ apply: apply && !blocked });

  console.log(rule);
  console.log("PHASE 0 — legacy reschedule origin back-fill");
  console.log(apply ? "MODE: APPLY requested" : "MODE: report only (nothing is written)");
  console.log(rule);
  console.log("");

  if (result.items.length === 0) {
    console.log("  No legacy reschedules found — every moved lesson carries a stored origin.");
    console.log("  RECURRENCE_DESIGN §5.4's `legacyOriginFallback` can be retired.");
    console.log("");
    return;
  }

  for (const it of result.items) {
    console.log(`  ${it.lessonId}`);
    console.log(`    class ........ ${it.className} (${it.classId})`);
    console.log(`    now sits ..... ${it.date} ${it.start} (${it.duration} min)   (unchanged)`);
    console.log(`    would stamp .. originalDate=${it.target.originalDate}` +
      ` originalStart=${it.target.originalStart} originalDuration=${it.target.originalDuration}`);
    console.log(`    verified ..... ${it.problems.length === 0 ? "PASS" : "FAIL"}`);
    for (const p of it.problems) console.log(`      ! ${p}`);
    for (const n of it.notes) console.log(`      - ${n}`);
  }

  console.log("");
  console.log(rule);
  console.log("EQUIVALENCE — stamping these origins must change no decision");
  console.log(rule);
  console.log(`  plan with the id fallback ON  : ${JSON.stringify(result.equivalence.before)}`);
  console.log(`  plan with origins STORED, OFF : ${JSON.stringify(result.equivalence.after)}`);
  console.log(`  RESULT: ${result.equivalence.identical ? "IDENTICAL" : "DIFFERENT — BLOCKING"}`);
  for (const k of result.equivalence.onlyBefore) console.log(`    - lost:   ${k}`);
  for (const k of result.equivalence.onlyAfter) console.log(`    + gained: ${k}`);

  console.log("");
  console.log(rule);
  console.log(`  Lessons needing an origin ................ ${result.items.length}`);
  console.log(`  Verified as genuine moves ................ ${result.items.filter((i) => i.problems.length === 0).length}`);
  console.log(`  Load-bearing without the fallback ........ ${result.items.filter((i) => i.loadBearing).length}`);
  console.log(`  Lessons written .......................... ${result.written}`);

  if (blocked) {
    console.log("");
    console.log("  REFUSED — nothing was written.");
    console.log(`    ${blocked}`);
    process.exitCode = 1;
    return;
  }

  if (result.blockers.length > 0) {
    console.log("");
    console.log("  REFUSED — nothing was written. The verification found:");
    for (const b of result.blockers) console.log(`    ! ${b}`);
    process.exitCode = 1;
    return;
  }

  if (!result.applied) {
    console.log("");
    console.log("  Nothing has been written. To perform the back-fill:");
    console.log("    1. npm run lessons:snapshot                    (§6 Phase 1)");
    console.log("    2. npm run lessons:backfill-origins -- --apply --snapshot backups/<dir>");
    console.log("  Rollback instructions are written into the snapshot as ROLLBACK.md.");
    console.log("");
    return;
  }

  const v = result.verification!;
  console.log("");
  console.log(rule);
  console.log("POST-APPLY VERIFICATION — read back from the database");
  console.log(rule);
  console.log(`  Targeted ................................. ${v.expected}`);
  console.log(`  Carrying exactly the expected origin ..... ${v.stamped}`);
  console.log(`  Wrong target ............................. ${v.wrongTarget.length}`);
  console.log(`  Not stamped .............................. ${v.missing.length}`);
  console.log(`  Stamped but not targeted ................. ${v.unexpected.length}`);
  console.log(`  Any OTHER field changed, any lesson ...... ${v.collateral.length}`);
  console.log(`  Lesson count changed ..................... ${v.countChanged}`);
  for (const id of [...v.wrongTarget, ...v.missing, ...v.unexpected, ...v.collateral]) {
    console.log(`    ! ${id}`);
  }
  console.log("");
  console.log(`  RESULT: ${v.ok ? "PASS — exactly the expected targets, nothing else touched" : "FAIL — restore from the snapshot"}`);
  if (!v.ok) process.exitCode = 1;
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
