/* Reviews production integrity check — READ ONLY.
 *
 * Run with:  npm run reviews:integrity
 *
 * WHY THIS EXISTS. Sprint 8 gates its Reviews rollout on facts about production
 * that must be reproducible rather than remembered: how many reviews the
 * collection holds, what its digest is, how many of them belong to students who
 * no longer exist, and — the one that gates the unique index — whether any
 * (studentId, month) pair occurs twice. Carrying those between sessions as bare
 * numbers is how a mismatch becomes unattributable, because a digest computed a
 * different way is indistinguishable from a digest over changed data. The
 * CONSTRUCTION is therefore written down here, once, exactly as
 * scripts/homework-integrity.mjs writes down its own.
 *
 * READ ONLY BY CONSTRUCTION. The only driver calls below are `countDocuments`
 * and `find`. There is no code path here that can insert, update, delete, create
 * an index or migrate anything, and there must never be one: this script's
 * output is only trustworthy because it cannot be the thing that changed what it
 * is measuring. It does not create the (studentId, month) unique index — it
 * reports whether that index COULD be created, which is a different job and a
 * different authorisation (Gate 5.3).
 *
 * THE CONSTRUCTION. SHA-256 over `JSON.stringify` of every document in the
 * `reviews` collection, sorted by the domain's own `id` — the natural key, not
 * `_id` — with the storage-only keys `_id` and `__v` removed. Sorting by the
 * natural key is what makes the digest independent of insertion order, and
 * stripping `_id`/`__v` is what makes it independent of a re-seed.
 *
 * NOTHING IS AUTO-LEARNED. The constants below are hand-edited, once, after a
 * write has been both authorised and verified. This script never reads a value
 * out of the collection and writes it back into itself as an expectation — a
 * baseline that learns is a baseline that cannot detect anything.
 */

import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/* ===========================================================================
 * 1. THE ACCEPTED BASELINE — DELIBERATELY NOT BANKED YET.
 *
 * `null` is the correct value for the whole of Gate 4.5, and it is a statement
 * rather than an omission: Sprint 8 has written NOTHING to production, so there
 * is no authorised write for a baseline to be the record of. Banking one now
 * would mean copying whatever the collection happens to hold and calling it
 * accepted — which is exactly the failure this file exists to prevent.
 *
 * HOW TO BANK IT, in Gate 5.2 / 5.5 / 5.7 and nowhere else:
 *
 *   1. run this script and read the observed pair off the output;
 *   2. confirm the move is ATTRIBUTABLE to the one authorised write — the same
 *      construction over the collection minus that record must reproduce the
 *      previous digest, the way Sprint 7's provenance notes demonstrate;
 *   3. replace `null` below with { count, digest } and write the provenance
 *      note beside it, naming the gate, the operation and the record.
 *
 * While it is `null` the script runs OBSERVATIONALLY: it still fails on a
 * structural fault (see section 3), and it still checks the Gate 1 reproduction
 * reference, but it does not claim production matches an accepted state.
 * ======================================================================== */
const ACCEPTED_BASELINE = null;

/* ===========================================================================
 * 2. THE GATE 1 OBSERVATIONAL REFERENCE — a reproduction check, NOT an
 *    acceptance.
 *
 * These are the numbers Sprint 8 Gate 1 observed before any Reviews code
 * existed, recorded so that a later session can prove it is looking at the same
 * untouched collection. Reproducing them means "nothing has happened to Reviews
 * since Gate 1", which is what every pre-write gate needs to know.
 *
 * IT IS NOT A BASELINE. Nothing here was ever authorised, because nothing was
 * ever written. Do not promote these values into ACCEPTED_BASELINE by copying
 * them; the accepted baseline is only ever the record of an authorised write.
 * ======================================================================== */
const GATE_1_OBSERVATION = {
  count: 33,
  digest: "c4418428f5d247b7c58caf046ce09c6e71f24dd30caab3bc86d4032a5fa8c4d5",
  ghostReviews: 11,
  ghostStudents: 5,
  duplicatePairs: 0,
};

/* Mongoose pluralises the `Review` model to `reviews` and `Student` to
 * `students`. Naming them explicitly is not pedantry: querying a collection that
 * does not exist returns an empty result rather than an error, so a typo here
 * would read as "every review was deleted". */
const COLLECTION = "reviews";
const STUDENTS = "students";

/** Storage-only keys, excluded so the digest survives a re-seed. */
const STORAGE_KEYS = new Set(["_id", "__v"]);

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");

const client = new MongoClient(uri);
let failed = false;
const fail = (why) => { failed = true; console.log(`         ^ ${why}`); };

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "etlms");

  console.log("cluster :", uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1$2:****@"));
  console.log("database:", db.databaseName);
  console.log("collection:", COLLECTION, "\n");

  const col = db.collection(COLLECTION);

  /* ---------------------------------------------------------------- count */
  const count = await col.countDocuments();
  console.log(`count  : ${count}`);

  /* --------------------------------------------------------------- digest */
  const docs = await col.find({}).sort({ id: 1 }).toArray();
  /* Key order is preserved minus the omitted keys, which is what keeps this
   * byte-identical to the stringify any banked digest was taken from. */
  const stripped = docs.map((d) =>
    Object.fromEntries(Object.entries(d).filter(([k]) => !STORAGE_KEYS.has(k)))
  );
  const digest = createHash("sha256").update(JSON.stringify(stripped)).digest("hex");
  console.log(`digest : ${digest}`);

  /* ------------------------------------------------------ month histogram */
  const byMonth = {};
  for (const d of docs) byMonth[d.month ?? "—"] = (byMonth[d.month ?? "—"] ?? 0) + 1;
  const months = Object.keys(byMonth).sort();

  /* ------------------------------------------------- resolvable vs ghost
   *
   * A GHOST REVIEW is one whose student no longer exists. PROJECT_RULES keeps
   * such records — they are the only trace that the work was assessed — and the
   * API refuses to disclose them, so they are expected, not a fault. Counting
   * them is how a later gate proves none was created or erased.
   *
   * Only the ids reviews actually reference are looked up, and only their ids
   * come back. Nothing is repaired and nothing is written. */
  const referenced = [...new Set(docs.map((d) => d.studentId).filter(Boolean))];
  const alive = new Set(
    referenced.length === 0
      ? []
      : (await db.collection(STUDENTS).find({ id: { $in: referenced } }, { projection: { id: 1, _id: 0 } })
          .toArray()).map((s) => s.id)
  );
  const ghostStudentIds = referenced.filter((id) => !alive.has(id));
  const ghostReviews = docs.filter((d) => !alive.has(d.studentId)).length;
  const resolvable = count - ghostReviews;

  /* ------------------------------------------------ duplicate (studentId, month)
   *
   * THE UNIQUE INDEX PRECONDITION. `createIndex({studentId:1, month:1},
   * {unique:true})` fails outright if any pair occurs twice, so this is the
   * question Gate 5.3 must ask immediately before the DDL — and a duplicate is
   * a hard failure here whatever else matches, because it means the rule the
   * service enforces in application code was violated in the data. */
  const seen = new Map();
  for (const d of docs) {
    const key = `${d.studentId} ${d.month}`;
    const bucket = seen.get(key);
    if (bucket) bucket.push(d.id);
    else seen.set(key, [d.id]);
  }
  const duplicates = [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ studentId: key.split(" ")[0], month: key.split(" ")[1], ids }));

  console.log("\nmonths     :", months.length, `(${months[0] ?? "—"} … ${months[months.length - 1] ?? "—"})`);
  console.log("histogram  :", JSON.stringify(byMonth));
  console.log(`resolvable : ${resolvable}`);
  console.log(`ghost      : ${ghostReviews} review(s) belonging to ${ghostStudentIds.length} deleted student(s)`);
  console.log(`duplicates : ${duplicates.length} (studentId, month) pair(s)`);
  if (duplicates.length > 0) {
    for (const d of duplicates) console.log(`             ${d.studentId} ${d.month} -> ${d.ids.join(", ")}`);
    fail("a unique (studentId, month) index CANNOT be created while these exist");
  }

  /* ------------------------------------------- 3. the checks that can fail */
  console.log("");

  if (ACCEPTED_BASELINE) {
    const countOk = count === ACCEPTED_BASELINE.count;
    const digestOk = digest === ACCEPTED_BASELINE.digest;
    console.log(`baseline   : ${ACCEPTED_BASELINE.count} / ${ACCEPTED_BASELINE.digest}`);
    console.log(`             count  ${countOk ? "OK" : "MISMATCH"} · digest ${digestOk ? "OK" : "MISMATCH"}`);
    if (!countOk || !digestOk) fail("production differs from the accepted Sprint 8 baseline");
  } else {
    console.log("baseline   : NOT BANKED — Sprint 8 has authorised no production write yet.");
    console.log("             This run is OBSERVATIONAL. See section 1 of this file.");
  }

  /* The Gate 1 reproduction check runs whether or not a baseline is banked: it
   * answers "is this the same untouched collection Gate 1 looked at?", which
   * stops being interesting only once an authorised write has moved it. */
  const g1 = [
    ["count", count, GATE_1_OBSERVATION.count],
    ["digest", digest, GATE_1_OBSERVATION.digest],
    ["ghost reviews", ghostReviews, GATE_1_OBSERVATION.ghostReviews],
    ["ghost students", ghostStudentIds.length, GATE_1_OBSERVATION.ghostStudents],
    ["duplicate pairs", duplicates.length, GATE_1_OBSERVATION.duplicatePairs],
  ];
  const drift = g1.filter(([, got, want]) => got !== want);
  console.log("\ngate 1     : the pre-implementation observation, reproduced?");
  for (const [label, got, want] of g1) {
    console.log(`             ${label.padEnd(16)} ${String(got).padEnd(66)} ${got === want ? "OK" : `EXPECTED ${want}`}`);
  }
  if (drift.length > 0) {
    fail("production has moved since Gate 1 — STOP. Do not reconcile, do not update these constants.");
  }

  console.log(
    `\n${failed
      ? "REVIEWS INTEGRITY FAILED — investigate before any Gate 5 step"
      : ACCEPTED_BASELINE
        ? "REVIEWS INTEGRITY OK — production matches the accepted Sprint 8 baseline"
        : "REVIEWS OBSERVATION OK — Gate 1's untouched state is independently reproduced (no baseline banked)"}`
  );
} finally {
  await client.close();
}

process.exit(failed ? 1 : 0);
