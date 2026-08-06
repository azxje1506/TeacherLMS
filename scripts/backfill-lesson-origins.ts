/* RECURRENCE_DESIGN.md §6 Phase 0 — back-fill legacy reschedule origins.
 *
 * Run with:  npm run lessons:backfill-origins            (report only)
 *            npm run lessons:backfill-origins -- --apply (writes)
 *
 * REPORTS BY DEFAULT. Without `--apply` this script issues `find()` queries only
 * and is safe to run against production; it prints exactly what it WOULD stamp.
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
 * SEQUENCING: this is a migration step. §6 puts the Phase 1 snapshot before any
 * write, and Sprint 5.6.2 does not run migrations. Applying it is 5.6.3's call. */

import { dbConnect } from "../src/lib/db";
import { mongoose } from "../src/lib/models";
import { backfillLegacyOrigins } from "../src/lib/reconciler";

/* Read-only unless --apply: Mongoose otherwise issues createCollection +
 * createIndexes the first time a model is used — small writes, but writes. Both
 * options are read after the connection opens, so setting them here suppresses
 * them for this process only (see scripts/recurrence-report.ts). */
const apply = process.argv.includes("--apply");
if (!apply) {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
}

async function main() {
  await dbConnect();
  const result = await backfillLegacyOrigins({ apply });

  const rule = "=".repeat(72);
  console.log(rule);
  console.log("PHASE 0 — legacy reschedule origin back-fill");
  console.log(apply ? "MODE: APPLY (writing)" : "MODE: report only (nothing is written)");
  console.log(rule);
  console.log("");

  if (result.items.length === 0) {
    console.log("  No legacy reschedules found — every moved lesson carries a stored origin.");
    console.log("  RECURRENCE_DESIGN §5.4's `legacyOriginFallback` can be retired.");
    console.log("");
    return;
  }

  for (const it of result.items) {
    console.log(`  ${it.id}`);
    console.log(`    class ${it.classId}`);
    console.log(`    now sits ..... ${it.date} ${it.start}   (unchanged)`);
    console.log(`    would stamp .. originalDate=${it.originalDate}` +
      ` originalStart=${it.originalStart} originalDuration=${it.originalDuration}`);
  }

  console.log("");
  console.log(rule);
  console.log(`  Lessons needing an origin ................ ${result.items.length}`);
  console.log(`  Lessons written .......................... ${result.written}`);
  if (!result.applied) {
    console.log("");
    console.log("  Nothing has been written. Re-run with -- --apply to perform the back-fill,");
    console.log("  after the §6 Phase 1 snapshot.");
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
