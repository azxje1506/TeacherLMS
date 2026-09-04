/* Billing production integrity check — READ ONLY.
 *
 * Run with:  npm run finance:integrity
 *
 * WHY THIS EXISTS. Sprint 9 gates its Finance rollout on facts about production
 * that must be reproducible rather than remembered: how many bills the
 * collection holds, what its digest is, how many belong to students who no
 * longer exist, whether the `(studentId, classId, month)` triple is still
 * unique, and — the two Finance-specific ones — how many `Partially Paid`
 * records still carry no `paidAmount`, and how many `paidDate` values sit ahead
 * of the application clock. Carrying those between sessions as bare numbers is
 * how a mismatch becomes unattributable, because a digest computed a different
 * way is indistinguishable from a digest over changed data. The CONSTRUCTION is
 * therefore written down here, once, exactly as scripts/reviews-integrity.mjs
 * and scripts/homework-integrity.mjs write down their own.
 *
 * READ ONLY BY CONSTRUCTION. The only driver calls below are `countDocuments`,
 * `find` and `indexes`. There is no code path here that can insert, update,
 * delete, create an index or migrate anything, and there must never be one: this
 * script's output is only trustworthy because it cannot be the thing that
 * changed what it is measuring. In particular it does NOT create the
 * `(studentId, classId, month)` index — it reports whether one COULD be created,
 * which is a different job under a different authorisation.
 *
 * THE CONSTRUCTION. SHA-256 over `JSON.stringify` of every document in the
 * `billings` collection, sorted by the domain's own `id` — the natural key, not
 * `_id` — with the storage-only keys `_id` and `__v` removed. Sorting by the
 * natural key is what makes the digest independent of insertion order, and
 * stripping `_id`/`__v` is what makes it independent of a re-seed. Identical to
 * the Reviews and Homework probes, so the three can be compared like with like.
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
 * 1. THE ACCEPTED BASELINE — DELIBERATELY NOT BANKED.
 *
 * `null` is the correct value and it is a STATEMENT rather than an omission:
 * Sprint 9 has written NO DOCUMENT to production, so there is no authorised
 * write for a baseline to be the record of. Banking one now would mean copying
 * whatever the collection happens to hold and calling it accepted — which is
 * exactly the failure this file exists to prevent.
 *
 * AN OBSERVED BASELINE IS NOT AN ACCEPTED ONE. Section 2 records what Gate 1
 * SAW; this records what somebody has AGREED production should be. The first is
 * evidence that nothing has happened; the second is a decision about what is
 * correct. Promoting one into the other by copying is how a silent corruption
 * becomes the new normal.
 *
 * GATE 3'S SCHEMA CHANGE IS NOT A REASON TO BANK. Adding the optional
 * `paidAmount` field and a `status` enum changed how documents are VALIDATED on
 * write and not one byte of what they hold, which is why the digest below is
 * unchanged across it. This baseline is about DOCUMENTS.
 *
 * HOW TO BANK IT, when a document write is finally authorised and nowhere else:
 *
 *   1. run this script and read the observed pair off the output;
 *   2. confirm the move is ATTRIBUTABLE to the one authorised write — the same
 *      construction over the collection minus that record must reproduce the
 *      previous digest, the way Sprint 7's provenance notes demonstrate;
 *   3. confirm the index list is unchanged;
 *   4. replace `null` below with { count, digest } and write the provenance
 *      note beside it, naming the gate, the operation and the record.
 *
 * While it is `null` the script runs OBSERVATIONALLY: it still fails on a
 * structural fault (see section 4), and it still checks the Gate 1 reproduction
 * reference, but it does not claim production matches an accepted state.
 * ======================================================================== */
const ACCEPTED_BASELINE = null;

/* ===========================================================================
 * 2. THE GATE 1 OBSERVATIONAL REFERENCE — a reproduction check, NOT an
 *    acceptance.
 *
 * These are the numbers Sprint 9 Gate 1 observed before any Finance code
 * existed, recorded so that a later session can prove it is looking at the same
 * untouched collection. Reproducing them means "nothing has happened to Billing
 * since Gate 1", which is what every pre-write gate needs to know.
 *
 * IT IS NOT A BASELINE. Nothing here was ever authorised, because nothing was
 * ever written. Do not promote these values into ACCEPTED_BASELINE by copying
 * them; the accepted baseline is only ever the record of an authorised write.
 * ======================================================================== */
const GATE_1_OBSERVATION = {
  count: 84,
  digest: "b3e2fb7ae5dd0cc1baac3c4f62c7459bfa62292b839970a84703a8e02d9ca6ca",
  statuses: { Paid: 70, "Partially Paid": 9, Unpaid: 5 },
  months: {
    "2026-02": 14, "2026-03": 14, "2026-04": 14,
    "2026-05": 14, "2026-06": 14, "2026-07": 14,
  },
  ghostBills: 24,
  ghostStudents: 4,
  duplicateGroups: 0,
  /* All nine partials predate `paidAmount` and none has one. This is expected
   * and is not a fault: their collected amount is unknown, shown as `No data`,
   * and nothing back-fills it (PROJECT_RULES, Billing). The count is tracked so
   * that a NEW partial written without an amount would show up here. */
  partialsWithoutAmount: 9,
  /* Six bills carry a `paidDate` after the app clock — a seed artefact. Writes
   * now refuse a future date; these are preserved untouched, and counted so a
   * seventh could not appear unnoticed. */
  futurePaidDates: 6,
  indexes: ["_id_", "classId_1", "id_1", "month_1", "studentId_1"],
};

/* The app clock (src/lib/constants.ts). Stated rather than imported because this
 * script is plain ESM run by node, not through the TypeScript path aliases —
 * and because a probe that read the app's own clock could not detect a change to
 * it. If TODAY_ISO moves, this line moves with it, deliberately. */
const APP_CLOCK = "2026-07-10";

/* Mongoose pluralises the `Billing` model to `billings`, `Student` to
 * `students`. Naming them explicitly is not pedantry: querying a collection that
 * does not exist returns an empty result rather than an error, so a typo here
 * would read as "every bill was deleted". */
const COLLECTION = "billings";
const STUDENTS = "students";

/** Storage-only keys, excluded so the digest survives a re-seed. */
const STORAGE_KEYS = new Set(["_id", "__v"]);

/** The three words a Billing status may be (src/lib/billing.ts). */
const LEGAL_STATUSES = ["Paid", "Partially Paid", "Unpaid"];

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

  /* ------------------------------------------------------------ histograms */
  const tally = (fn) => {
    const m = {};
    for (const d of docs) { const k = String(fn(d)); m[k] = (m[k] ?? 0) + 1; }
    return m;
  };
  /* Histograms are compared as text, so their key order has to be canonical:
   * `JSON.stringify` preserves INSERTION order, which for a tally follows the
   * order documents happened to come back in. Sorting the keys is what stops a
   * reordered read from being reported as changed data. (The DIGEST above has
   * the same requirement and meets it differently — by sorting the documents
   * themselves on the natural key before hashing.) */
  const canonical = (o) => JSON.stringify(Object.fromEntries(
    Object.keys(o).sort().map((k) => [k, o[k]])
  ));
  const byStatus = tally((d) => d.status);
  const byMonth = tally((d) => d.month);
  const months = Object.keys(byMonth).sort();

  /* ------------------------------------------------------ status vocabulary
   *
   * A status outside the three is a hard failure whatever else matches: the
   * schema now carries an enum, so one could only arrive from outside the app,
   * and every calculation fails closed on it (returning an unknown amount rather
   * than a number). Better to say so loudly than to report a total that quietly
   * excluded it. */
  const illegal = Object.keys(byStatus).filter((s) => !LEGAL_STATUSES.includes(s));

  /* ------------------------------------------------- resolvable vs ghost
   *
   * A GHOST BILL is one whose student no longer exists. PROJECT_RULES keeps such
   * records — they are the only trace that the money was asked for — counts them
   * in every aggregate, and refuses to list or edit them, so they are expected,
   * not a fault. Counting them is how a later gate proves none was created or
   * erased.
   *
   * Only the ids bills actually reference are looked up, and only their ids come
   * back. Nothing is repaired and nothing is written. */
  const referenced = [...new Set(docs.map((d) => d.studentId).filter(Boolean))];
  const alive = new Set(
    referenced.length === 0
      ? []
      : (await db.collection(STUDENTS).find({ id: { $in: referenced } }, { projection: { id: 1, _id: 0 } })
        .toArray()).map((s) => s.id)
  );
  const ghostStudentIds = referenced.filter((id) => !alive.has(id));
  const ghostBills = docs.filter((d) => !alive.has(d.studentId)).length;
  const resolvable = count - ghostBills;

  /* ------------------------------ duplicate (studentId, classId, month)
   *
   * THE NATURAL KEY IS THE TRIPLE, NOT THE PAIR. A student taught in two classes
   * owes two tuitions in the same month and legitimately holds two bills, so
   * `(studentId, month)` is expected to repeat and is not checked here. The
   * triple is what a unique index could one day be built on — and this reports
   * whether it COULD be, which is a question, not a licence. No index is created
   * by this script or by anything it calls. */
  const seen = new Map();
  for (const d of docs) {
    const key = `${d.studentId}|${d.classId}|${d.month}`;
    const bucket = seen.get(key);
    if (bucket) bucket.push(d.id);
    else seen.set(key, [d.id]);
  }
  const duplicates = [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));

  /* ------------------------------------------- Finance-specific observations */
  const partialsWithoutAmount = docs.filter(
    (d) => d.status === "Partially Paid" && typeof d.paidAmount !== "number"
  ).length;
  const partialsWithAmount = docs.filter(
    (d) => d.status === "Partially Paid" && typeof d.paidAmount === "number"
  ).length;
  const futurePaidDates = docs.filter(
    (d) => typeof d.paidDate === "string" && d.paidDate > APP_CLOCK
  );
  /* An amount on a Paid or Unpaid bill would contradict the rule: `Paid` collects
   * the fee and `Unpaid` collects zero, so neither stores one. */
  const amountOnWrongStatus = docs.filter(
    (d) => d.status !== "Partially Paid" && typeof d.paidAmount === "number"
  );

  /* --------------------------------------------------------------- indexes */
  const indexNames = (await col.indexes()).map((i) => i.name).sort();

  console.log("\nstatuses   :", JSON.stringify(byStatus));
  console.log("months     :", months.length, `(${months[0] ?? "—"} … ${months[months.length - 1] ?? "—"})`);
  console.log("histogram  :", JSON.stringify(byMonth));
  console.log(`resolvable : ${resolvable}`);
  console.log(`ghost      : ${ghostBills} bill(s) belonging to ${ghostStudentIds.length} deleted student(s)`);
  console.log(`duplicates : ${duplicates.length} (studentId, classId, month) group(s)`);
  for (const d of duplicates.slice(0, 5)) console.log(`             ${d.key} -> ${d.ids.join(", ")}`);
  console.log(`partials   : ${partialsWithAmount} with a recorded amount, ${partialsWithoutAmount} without (collected is No data)`);
  console.log(`future dates: ${futurePaidDates.length} paidDate(s) after the app clock ${APP_CLOCK}`);
  for (const d of futurePaidDates.slice(0, 8)) console.log(`             ${d.id} ${d.status} ${d.paidDate}`);
  console.log("indexes    :", indexNames.join(", "));

  /* ------------------------------------------- 4. the checks that can fail */
  console.log("");

  if (illegal.length > 0) {
    console.log("statuses   : ILLEGAL VALUE(S) ->", illegal.join(", "));
    fail("a Billing status outside Paid / Partially Paid / Unpaid exists");
  }
  if (duplicates.length > 0) {
    fail("a unique (studentId, classId, month) index CANNOT be created while these exist");
  }
  if (amountOnWrongStatus.length > 0) {
    for (const d of amountOnWrongStatus.slice(0, 5)) {
      console.log(`             ${d.id} is ${d.status} but stores paidAmount ${d.paidAmount}`);
    }
    fail("paidAmount is stored on a bill that is not Partially Paid");
  }

  if (ACCEPTED_BASELINE) {
    const countOk = count === ACCEPTED_BASELINE.count;
    const digestOk = digest === ACCEPTED_BASELINE.digest;
    console.log(`baseline   : ${ACCEPTED_BASELINE.count} / ${ACCEPTED_BASELINE.digest}`);
    console.log(`             count  ${countOk ? "OK" : "MISMATCH"} · digest ${digestOk ? "OK" : "MISMATCH"}`);
    if (!countOk || !digestOk) fail("production differs from the accepted Sprint 9 baseline");
  } else {
    console.log("baseline   : NOT BANKED — Sprint 9 has authorised no document write yet.");
    console.log("             This run is OBSERVATIONAL. See section 1 of this file.");
  }

  /* The Gate 1 reproduction check runs whether or not a baseline is banked: it
   * answers "is this the same untouched collection Gate 1 looked at?", which
   * stops being interesting only once an authorised write has moved it. */
  const g1 = [
    ["count", count, GATE_1_OBSERVATION.count],
    ["digest", digest, GATE_1_OBSERVATION.digest],
    ["statuses", canonical(byStatus), canonical(GATE_1_OBSERVATION.statuses)],
    ["months", canonical(byMonth), canonical(GATE_1_OBSERVATION.months)],
    ["ghost bills", ghostBills, GATE_1_OBSERVATION.ghostBills],
    ["ghost students", ghostStudentIds.length, GATE_1_OBSERVATION.ghostStudents],
    ["duplicate triples", duplicates.length, GATE_1_OBSERVATION.duplicateGroups],
    ["partials w/o amount", partialsWithoutAmount, GATE_1_OBSERVATION.partialsWithoutAmount],
    ["future paidDates", futurePaidDates.length, GATE_1_OBSERVATION.futurePaidDates],
    ["indexes", indexNames.join(","), GATE_1_OBSERVATION.indexes.join(",")],
  ];
  const drift = g1.filter(([, got, want]) => String(got) !== String(want));
  console.log("\ngate 1     : the pre-implementation observation, reproduced?");
  for (const [label, got, want] of g1) {
    const ok = String(got) === String(want);
    console.log(`             ${label.padEnd(20)} ${String(got).padEnd(66)} ${ok ? "OK" : `EXPECTED ${want}`}`);
  }
  if (drift.length > 0) {
    fail("production has moved since Gate 1 — STOP. Do not reconcile, do not update these constants.");
  }

  console.log(
    `\n${failed
      ? "BILLING INTEGRITY FAILED — investigate before any further Sprint 9 step"
      : ACCEPTED_BASELINE
        ? "BILLING INTEGRITY OK — production matches the accepted Sprint 9 baseline"
        : "BILLING OBSERVATION OK — Gate 1's untouched state is independently reproduced (no baseline banked)"}`
  );
} finally {
  await client.close();
}

process.exit(failed ? 1 : 0);
