/* Attendance write mechanics — proved against a SCRATCH database.
 *
 * Run with:  npm run attendance:scratch-proof
 *
 * WHY THIS EXISTS. The live Attendance collection holds records whose `entries`
 * object contains keys for students whose documents no longer exist. Those
 * entries never reach a screen, so nothing in the UI would notice them
 * disappearing — and they are the only surviving record that a lesson was taught
 * to those people. The whole design of `planAttendanceWrite` is built around not
 * erasing them, and reasoning is not evidence: this script runs the REAL planner
 * and the REAL Mongo statement against a throwaway database and reads the
 * documents back.
 *
 * WHAT IS "REAL" HERE. `planAttendanceWrite` is imported from the production
 * module, unmodified — the update document is not retyped for the test. The
 * executor is the single `AttendanceModel.updateOne(filter, update, { upsert })`
 * line from `saveAttendanceRegister`, with the same duplicate-key recovery. The
 * service itself cannot be imported outside Next.js (`server-only`), which is the
 * only seam between this and production.
 *
 * ISOLATION IS ASSERTED, NOT ASSUMED. The script refuses to run against `etlms`
 * or against whatever MONGODB_DB names, and it drops only the database it created.
 */

import assert from "node:assert/strict";
import { AttendanceModel, mongoose } from "../src/lib/models";
import { planAttendanceWrite } from "../src/lib/attendance";
import { isDupKey } from "../src/lib/db";
import type { AttendanceStatus } from "../src/lib/types";

const SCRATCH_DB: string = "etlms_scratch_gate4_attendance";
const PROD_DB: string = process.env.MONGODB_DB || "etlms";
const uri = process.env.MONGODB_URI;

if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local (see .env.example).");

/* ---- isolation guard: refuse to touch anything that could be production ---- */
if (SCRATCH_DB === PROD_DB || SCRATCH_DB === "etlms" || !SCRATCH_DB.includes("scratch")) {
  throw new Error(`Refusing to run: ${SCRATCH_DB} is not a clearly isolated scratch database.`);
}

type Submitted = Record<string, { status: AttendanceStatus; note?: string }>;

/** The production executor, verbatim: one upsert, plus the convergent recovery
 * for the first-save race. Nothing else writes. */
async function applyPlan(lessonId: string, visible: string[], submitted: Submitted): Promise<void> {
  const planned = planAttendanceWrite(lessonId, new Set(visible), submitted);
  assert.equal(planned.ok, true, "planner rejected a payload the test expected to be valid");
  if (!planned.ok) return;
  const { filter, update } = planned.plan;
  try {
    await AttendanceModel.updateOne(filter, update, { upsert: true });
  } catch (e) {
    if (!isDupKey(e)) throw e;
    if (update.$set) await AttendanceModel.updateOne(filter, { $set: update.$set });
  }
}

/** The stored document, exactly as Mongo holds it, minus the incidental _id. */
async function readDoc(lessonId: string): Promise<Record<string, unknown> | null> {
  const raw = await mongoose.connection.collection("attendances").findOne({ lessonId });
  if (!raw) return null;
  const { _id, ...rest } = raw;
  void _id;
  return rest as Record<string, unknown>;
}

const show = (label: string, v: unknown) => console.log(`${label}: ${JSON.stringify(v)}`);

async function main() {
  await mongoose.connect(uri!, { dbName: SCRATCH_DB, bufferCommands: false });
  const db = mongoose.connection.db!;

  assert.notEqual(db.databaseName, PROD_DB, "connected to the production database");
  assert.equal(db.databaseName, SCRATCH_DB, "connected to an unexpected database");

  console.log("========== SCRATCH DATABASE ==========");
  console.log(`scratch database : ${db.databaseName}`);
  console.log(`production database (untouched): ${PROD_DB}`);
  console.log("======================================\n");

  // Start from nothing, and build the unique lessonId index the production
  // schema declares — the duplicate-key path below depends on it existing.
  await db.collection("attendances").deleteMany({});
  await AttendanceModel.createIndexes();

  /* ================================================================== R1 ====
   * A hidden entry for a deleted student must survive a save that never
   * mentions them. This is the fixture from the gate, verbatim. */

  console.log("---- 1. hidden-entry preservation ----");

  await db.collection("attendances").insertOne({
    lessonId: "test-lesson",
    entries: {
      deletedStudent: { status: "Present" }, // unresolved — invisible to the UI
      visibleA: { status: "Present", note: "Old note" },
      visibleB: { status: "Absent" },
    },
  });

  const preCount = await db.collection("attendances").countDocuments({});
  const before = await readDoc("test-lesson");
  console.log(`pre-count : ${preCount}`);
  show("document BEFORE", before);

  // The teacher sees only visibleA and visibleB. visibleA goes Late and their
  // note is cleared; visibleB goes Present.
  await applyPlan("test-lesson", ["visibleA", "visibleB"], {
    visibleA: { status: "Late", note: "" },
    visibleB: { status: "Present" },
  });

  const after = await readDoc("test-lesson");
  const postCount = await db.collection("attendances").countDocuments({});
  console.log(`post-count: ${postCount}`);
  show("document AFTER ", after);

  assert.deepStrictEqual(after, {
    lessonId: "test-lesson",
    entries: {
      deletedStudent: { status: "Present" }, // untouched
      visibleA: { status: "Late" },          // updated, stale note gone
      visibleB: { status: "Present" },       // updated
    },
  });
  assert.equal(preCount, 1);
  assert.equal(postCount, 1, "an update must not create a second document");
  assert.ok(!("date" in after!), "no date may be added");
  assert.ok(!("createdAt" in after!) && !("updatedAt" in after!), "no timestamps may be added");
  console.log("PASS  hidden entry preserved · note cleared · no date · no timestamps · count unchanged\n");

  /* ---- 2. semantic idempotency: the same payload again changes nothing ---- */

  console.log("---- 2. idempotency ----");
  await applyPlan("test-lesson", ["visibleA", "visibleB"], {
    visibleA: { status: "Late", note: "" },
    visibleB: { status: "Present" },
  });
  const second = await readDoc("test-lesson");
  assert.deepStrictEqual(second, after, "a repeated identical save must not change the document");
  assert.equal(await db.collection("attendances").countDocuments({}), 1);
  show("document AFTER 2nd identical save", second);
  console.log("PASS  identical save is a no-op\n");

  /* ---- 3. first save creates exactly one record, with no date/timestamps ---- */

  console.log("---- 3. first upsert ----");
  const freshPre = await db.collection("attendances").countDocuments({ lessonId: "test-lesson-new" });
  await applyPlan("test-lesson-new", ["s1", "s2"], {
    s1: { status: "Present" },
    s2: { status: "Present" }, // all-Present, saved explicitly (SAVE-PRESENT-A)
  });
  const created = await readDoc("test-lesson-new");
  const freshPost = await db.collection("attendances").countDocuments({ lessonId: "test-lesson-new" });
  console.log(`pre-count : ${freshPre}`);
  console.log(`post-count: ${freshPost}`);
  show("document CREATED", created);
  assert.equal(freshPre, 0);
  assert.equal(freshPost, 1);
  assert.deepStrictEqual(Object.keys(created!).sort(), ["entries", "lessonId"]);
  assert.deepStrictEqual(created, {
    lessonId: "test-lesson-new",
    entries: { s1: { status: "Present" }, s2: { status: "Present" } },
  });
  console.log("PASS  one record · lessonId + entries only · no date · no timestamps\n");

  /* ---- 4. duplicate-key race must converge, never duplicate ---- */

  console.log("---- 4. first-save race ----");
  await Promise.all([
    applyPlan("test-lesson-race", ["s1"], { s1: { status: "Absent", note: "Sick" } }),
    applyPlan("test-lesson-race", ["s1"], { s1: { status: "Absent", note: "Sick" } }),
  ]);
  const raced = await readDoc("test-lesson-race");
  const raceCount = await db.collection("attendances").countDocuments({ lessonId: "test-lesson-race" });
  show("document AFTER concurrent first saves", raced);
  console.log(`documents for that lesson: ${raceCount}`);
  assert.equal(raceCount, 1, "a race must never produce two registers for one lesson");
  assert.deepStrictEqual(raced, {
    lessonId: "test-lesson-race",
    entries: { s1: { status: "Absent", note: "Sick" } },
  });

  // And the recovery branch itself, exercised directly: applying the plan's $set
  // WITHOUT the upsert to a document that already exists converges identically.
  const recovery = planAttendanceWrite("test-lesson-race", new Set(["s1"]), {
    s1: { status: "Absent", note: "Sick" },
  });
  assert.ok(recovery.ok);
  await AttendanceModel.updateOne(recovery.plan.filter, { $set: recovery.plan.update.$set! });
  assert.deepStrictEqual(await readDoc("test-lesson-race"), raced, "recovery path must converge");
  console.log("PASS  no duplicate register · recovery path converges\n");

  /* ---- 5. a foreign id is refused with zero writes ---- */

  console.log("---- 5. foreign id ----");
  const hostile = planAttendanceWrite("test-lesson", new Set(["visibleA", "visibleB"]), {
    visibleA: { status: "Present" },
    deletedStudent: { status: "Absent" }, // the hidden key, addressed by name
  });
  assert.equal(hostile.ok, false);
  assert.deepStrictEqual(await readDoc("test-lesson"), after, "a rejected save must write nothing");
  console.log("PASS  hidden key addressed by name is refused · document unchanged\n");

  /* ---- cleanup: drop ONLY the scratch database ---- */

  assert.equal(db.databaseName, SCRATCH_DB);
  await db.dropDatabase();
  console.log(`dropped scratch database: ${SCRATCH_DB}`);
  console.log("\nALL SCRATCH-DB PROOFS PASSED");
}

main()
  .catch((e) => {
    console.error("\nSCRATCH PROOF FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
