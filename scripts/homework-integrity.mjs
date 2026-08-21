/* Homework production integrity check — READ ONLY.
 *
 * Run with:  npm run homework:integrity
 *
 * WHY THIS EXISTS. Sprint 7 gates every Homework rollout step on two facts: how
 * many assignments the collection holds, and what its digest is. Both were being
 * carried between sessions as bare numbers, and the CONSTRUCTION behind the
 * digest was never committed — so a digest that failed to match could not be
 * told apart from a digest computed a different way. That is the worst possible
 * ambiguity for a check whose entire job is to say whether production was
 * written to. It is written down here once, so the answer is reproducible.
 *
 * THE BASELINE IS AN ACCEPTED FACT, NOT WHATEVER PRODUCTION HAPPENS TO HOLD. The
 * two constants below are edited by hand, once, after a write has been both
 * authorised and verified — never widened, never softened, and never read back
 * from the collection they are checking. A mismatch is the entire product of
 * this script: it is the only way an unauthorised write announces itself.
 *
 * THE CONSTRUCTION. SHA-256 over `JSON.stringify` of every document in the
 * `homeworks` collection, sorted by the domain's own `id` — the natural key,
 * not `_id` — with the storage-only keys `_id` and `__v` removed. Sorting by
 * the natural key is what makes the digest independent of insertion order, and
 * stripping `_id`/`__v` is what makes it independent of a re-seed.
 *
 * READ ONLY BY CONSTRUCTION. The only driver calls below are `countDocuments`
 * and `find`. There is no code path here that can insert, update or delete, and
 * there must never be one: this script's output is only trustworthy because it
 * cannot be the thing that changed what it is measuring.
 */

import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/** The accepted Sprint 7 baseline. Both are facts about production, not defaults.
 *
 * PROVENANCE — the baseline has moved exactly twice, and only by authorisation:
 *
 *   15 / aef736e9931fac3350c6b7a9a2d17834ca3f22566792f952183fc7ed9e85741f
 *        THE PRE-FIRST-WRITE BASELINE. Held from the start of Sprint 7 through
 *        Gate 5 Phase 0, across which zero Homework writes had occurred.
 *
 *   16 / ce6ff87d6cad443c3321001a29020dafce802bf965c638cb374cb8196f2dec38
 *        THE ACCEPTED POST-CREATE BASELINE, superseded. Gate 5 Phase 1 authorised
 *        exactly one production create — the class-scoped smoke assignment
 *        6a86bbbad3064b8fdc15483e on class c6, Assigned, lessonId null, due
 *        2026-07-31 — issued through POST /api/homework and confirmed in the
 *        hosted app in Phase 1.1.
 *
 *        The move is attributable rather than merely observed: this same
 *        construction, run over the post-write collection MINUS that one record,
 *        still reproduces aef736e9…5741f exactly. The original 15 documents are
 *        byte-identical, so the digest moved because one document was added and
 *        for no other reason.
 *
 *   16 / 813a8da1722bbeba3ca437a4d0703beb9a1119dd4773b7c2e2a0c84f0477657c
 *        THE ACCEPTED POST-EDIT BASELINE, and the one in force below. Gate 5
 *        Phase 2 authorised exactly one production edit — the same assignment,
 *        through PATCH /api/homework/:id, changing only the four fields a teacher
 *        authored: title, description, dueDate (2026-07-31 -> 2026-08-07) and
 *        teacherNotes. Confirmed in the hosted app in Phase 2.1.
 *
 *        THE COUNT DID NOT MOVE, so the count alone could not have caught this;
 *        the digest is what did. Attributable on the same construction: restoring
 *        that one record's pre-edit representation into the post-edit collection
 *        reproduces ce6ff87d…2dec38 exactly, so the other 15 documents are
 *        byte-identical and the digest moved for the authorised edit alone.
 *
 *        Ownership was unchanged and remains classId c6, scope class, studentId
 *        null, status Assigned, lessonId null, submissions {"s11":"Assigned"},
 *        createdAt 2026-07-10.
 */
const EXPECTED_COUNT = 16;
const EXPECTED_DIGEST = "813a8da1722bbeba3ca437a4d0703beb9a1119dd4773b7c2e2a0c84f0477657c";

/* Mongoose pluralises the `Homework` model to `homeworks`. Naming it explicitly
 * is not pedantry: querying `homework` returns an empty collection rather than
 * an error, so a typo here reads as "every assignment was deleted". */
const COLLECTION = "homeworks";

/** Storage-only keys, excluded so the digest survives a re-seed. */
const STORAGE_KEYS = new Set(["_id", "__v"]);

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set — see .env.example");

const client = new MongoClient(uri);
let failed = false;

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "etlms");

  console.log("cluster :", uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1$2:****@"));
  console.log("database:", db.databaseName);
  console.log("collection:", COLLECTION, "\n");

  const col = db.collection(COLLECTION);

  const count = await col.countDocuments();
  const countOk = count === EXPECTED_COUNT;
  console.log(`count  : ${count} (expected ${EXPECTED_COUNT}) ${countOk ? "OK" : "MISMATCH"}`);
  if (!countOk) failed = true;

  const docs = await col.find({}).sort({ id: 1 }).toArray();
  /* Key order is preserved minus the omitted keys, which is what keeps this
   * byte-identical to the stringify the baseline was taken from. */
  const stripped = docs.map((d) =>
    Object.fromEntries(Object.entries(d).filter(([k]) => !STORAGE_KEYS.has(k)))
  );
  const digest = createHash("sha256").update(JSON.stringify(stripped)).digest("hex");
  const digestOk = digest === EXPECTED_DIGEST;
  console.log(`digest : ${digest}`);
  console.log(`         ${digestOk ? "OK — matches the Sprint 7 baseline" : `MISMATCH — expected ${EXPECTED_DIGEST}`}`);
  if (!digestOk) failed = true;

  /* A digest that matches says nothing changed; a digest that does not says
   * only THAT something did. The histogram is what makes a mismatch legible
   * without a second trip to the database. */
  const byStatus = {};
  const byScope = {};
  for (const d of docs) {
    byStatus[d.status ?? "—"] = (byStatus[d.status ?? "—"] ?? 0) + 1;
    byScope[d.scope ?? "—"] = (byScope[d.scope ?? "—"] ?? 0) + 1;
  }
  console.log("\nstatus :", JSON.stringify(byStatus));
  console.log("scope  :", JSON.stringify(byScope));

  console.log(`\n${failed ? "INTEGRITY FAILED — production differs from the accepted Sprint 7 baseline" : "INTEGRITY OK — production matches the accepted Sprint 7 baseline"}`);
} finally {
  await client.close();
}

process.exit(failed ? 1 : 0);
