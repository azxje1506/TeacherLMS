/* Finance — the two route handlers, and what they may and may not do.
 *
 * Run with:  npm test
 *
 * NO SERVER AND NO DATABASE, for the reason tests/reviews-api.test.ts states:
 * both route files import `@/lib/finance-service`, which imports `server-only`,
 * so this runner cannot load them at all. What a route ACCEPTS is exercised
 * through the same Zod schema the handler uses; what a route CANNOT DO —
 * advance a lifecycle, write, generate, create an index, expose a verb that
 * should not exist — is asserted by scanning the source.
 *
 * The scan is the whole point for this module. "A Finance read is a read" is the
 * central invariant of Sprint 9 Gate 4, it is not expressible as a function
 * call, and `/api/dashboard` is a live example in this same codebase of the
 * mistake it prevents: that route runs `advanceLessonLifecycle()` on a GET and
 * therefore performs a `bulkWrite` when a screen is opened. Finance must not,
 * and this file is where that is pinned.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { billingPaymentSchema, ISO_MONTH } from "../src/lib/schemas";
import { PAYMENT_ERROR, checkPaymentWrite } from "../src/lib/billing";
import { TODAY_ISO } from "../src/lib/constants";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const GET_ROUTE = path.join("src", "app", "api", "finance", "route.ts");
const PATCH_ROUTE = path.join("src", "app", "api", "finance", "[billId]", "route.ts");
const GET_SRC = code(GET_ROUTE);
const PATCH_SRC = code(PATCH_ROUTE);
const DASHBOARD_SRC = code("src", "app", "api", "dashboard", "route.ts");

/* ================================================================= GET */

describe("GET /api/finance · the route exists and is guarded", () => {
  it("1. the route file is where Next expects it", () => {
    assert.ok(existsSync(path.join(process.cwd(), GET_ROUTE)));
  });

  it("2. requires a session before anything else", () => {
    assert.ok(GET_SRC.includes("requireSession()"));
    // The CALL site, not the import — an import naturally precedes everything.
    const guard = GET_SRC.indexOf("requireSession()");
    const work = GET_SRC.indexOf("await buildFinanceMonth(");
    assert.ok(guard > -1 && work > guard, "the session is checked before the read");
  });

  it("3. maps errors through the shared handle()", () => {
    assert.ok(GET_SRC.includes("handle(async"));
  });

  it("4. runs on node, like its sibling database routes", () => {
    assert.ok(/export const runtime = "nodejs"/.test(GET_SRC));
  });

  it("5. exports GET and nothing else — no POST, PUT or DELETE", () => {
    assert.ok(/export async function GET/.test(GET_SRC));
    for (const verb of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.ok(!new RegExp(`export async function ${verb}\\b`).test(GET_SRC),
        `/api/finance must not export ${verb}`);
    }
  });
});

describe("GET /api/finance · month validation", () => {
  it("6. accepts a well-formed month", () => {
    for (const m of ["2026-07", "2026-01", "2026-12", "2025-08"]) {
      assert.ok(ISO_MONTH.test(m), m);
    }
  });

  it("7. refuses a malformed month", () => {
    for (const m of ["", "2026", "2026-7", "2026-13", "2026-00", "july", "2026-07-10"]) {
      assert.ok(!ISO_MONTH.test(m), `${m} must be refused`);
    }
  });

  it("8. the route refuses with 422, the repository's validation status", () => {
    assert.ok(/ISO_MONTH\.test\(month\)/.test(GET_SRC));
    assert.ok(/error\("Pick a month", 422\)/.test(GET_SRC));
  });

  it("9. the month is never substituted with a default", () => {
    // The server owns the WINDOW; the client owns the CHOICE. A missing month is
    // refused rather than silently becoming "this month".
    assert.ok(!/month \?\? CURRENT_MONTH/.test(GET_SRC));
    assert.ok(!/CURRENT_MONTH/.test(GET_SRC), "the route names no default month");
  });

  it("10. a valid month with no bills is not an error path", () => {
    // There is exactly one refusal in the handler, and it is the shape check.
    const errors = GET_SRC.match(/return error\(/g) ?? [];
    assert.equal(errors.length, 1, "only the malformed month is refused");
  });
});

describe("GET /api/finance · a read is a read", () => {
  it("11. does not import or call the lesson lifecycle", () => {
    assert.ok(!GET_SRC.includes("advanceLessonLifecycle"));
    assert.ok(!GET_SRC.includes("lifecycle"));
  });

  it("12. …unlike /api/dashboard, which does — the contrast is the point", () => {
    assert.ok(DASHBOARD_SRC.includes("advanceLessonLifecycle"),
      "if Dashboard stops writing, this test's premise changes and should be revisited");
    assert.ok(!GET_SRC.includes("advanceLessonLifecycle"));
  });

  it("13. does not reconcile, generate or backfill", () => {
    for (const banned of [
      "reconcile", "ensureRegularLessons", "deriveData", "generate",
      "backfill", "planClass",
    ]) {
      assert.ok(!GET_SRC.includes(banned), `/api/finance GET must not reference ${banned}`);
    }
  });

  it("14. contains no write verb of any kind", () => {
    for (const banned of [
      "updateOne", "updateMany", "insertOne", "insertMany", "deleteOne",
      "deleteMany", "replaceOne", "bulkWrite", "findOneAndUpdate", "save(",
      "createIndex", "dropIndex",
    ]) {
      assert.ok(!GET_SRC.includes(banned), `/api/finance GET must not use ${banned}`);
    }
  });

  it("15. reaches no model directly — the service owns every query", () => {
    for (const model of [
      "BillingModel", "StudentModel", "ClassModel", "LessonModel",
      "AttendanceModel", "ParentModel", "HomeworkModel", "ReviewModel",
    ]) {
      assert.ok(!GET_SRC.includes(model), `the route must not touch ${model}`);
    }
  });

  it("16. does not call repo.getAll", () => {
    assert.ok(!GET_SRC.includes("getAll"));
  });

  it("17. calls exactly one service function", () => {
    assert.ok(GET_SRC.includes("buildFinanceMonth"));
    assert.ok(!GET_SRC.includes("recordPayment"), "a GET cannot reach the writer");
  });
});

/* =============================================================== PATCH */

describe("PATCH /api/finance/:billId · the route", () => {
  it("18. the route file is where Next expects it", () => {
    assert.ok(existsSync(path.join(process.cwd(), PATCH_ROUTE)));
  });

  it("19. requires a session before the body is even parsed", () => {
    const guard = PATCH_SRC.indexOf("requireSession()");
    const parse = PATCH_SRC.indexOf("req.json()");
    assert.ok(guard > -1 && parse > guard);
  });

  it("20. exports PATCH alone — no GET, POST or DELETE", () => {
    assert.ok(/export async function PATCH/.test(PATCH_SRC));
    for (const verb of ["GET", "POST", "PUT", "DELETE"]) {
      assert.ok(!new RegExp(`export async function ${verb}\\b`).test(PATCH_SRC),
        `/api/finance/:billId must not export ${verb}`);
    }
  });

  it("21. validates the body with the Billing payment schema", () => {
    assert.ok(PATCH_SRC.includes("billingPaymentSchema"));
    assert.ok(/safeParse\(body\)/.test(PATCH_SRC));
    assert.ok(/422/.test(PATCH_SRC), "a bad payload is a 422");
  });

  it("22. renders a refusal through the shared PAYMENT_ERROR map", () => {
    assert.ok(PATCH_SRC.includes("PAYMENT_ERROR[res.violation]"));
  });

  it("23. reaches no model directly and writes nothing itself", () => {
    for (const banned of ["BillingModel", "updateOne", "bulkWrite", "deleteOne", "createIndex"]) {
      assert.ok(!PATCH_SRC.includes(banned), `the route must not use ${banned}`);
    }
  });

  it("24. does not advance a lifecycle or reconcile", () => {
    assert.ok(!PATCH_SRC.includes("advanceLessonLifecycle"));
    assert.ok(!PATCH_SRC.includes("reconcile"));
  });
});

describe("PATCH · the accepted payload", () => {
  const parse = (v: unknown) => billingPaymentSchema.safeParse(v);

  it("25. accepts a Paid write", () => {
    const r = parse({ status: "Paid", paidDate: "2026-07-06" });
    assert.equal(r.success, true);
  });

  it("26. accepts an Unpaid write with a cleared date", () => {
    const r = parse({ status: "Unpaid", paidDate: "" });
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.paidDate, null);
  });

  it("27. accepts a partial that states its amount", () => {
    const r = parse({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 300_000 });
    assert.equal(r.success, true);
  });

  it("28. refuses every ownership field", () => {
    for (const f of ["id", "studentId", "classId", "month", "fee"]) {
      assert.equal(parse({ status: "Unpaid", [f]: "x" }).success, false, f);
    }
  });

  it("29. refuses a status outside the three", () => {
    for (const s of ["Overdue", "Pending", "Refunded", ""]) {
      assert.equal(parse({ status: s, paidDate: null }).success, false, s);
    }
  });

  it("30. refuses an unknown field rather than ignoring it", () => {
    assert.equal(parse({ status: "Unpaid", method: "cash" }).success, false);
  });
});

describe("PATCH · what the service decides, end to end", () => {
  const bill = { fee: 800_000 };
  const run = (payload: unknown) => {
    const parsed = billingPaymentSchema.safeParse(payload);
    if (!parsed.success) return { stage: "schema" as const, status: 422 };
    const checked = checkPaymentWrite(parsed.data, bill, TODAY_ISO);
    if (!checked.ok) {
      return { stage: "invariant" as const, ...PAYMENT_ERROR[checked.violation] };
    }
    return { stage: "ok" as const, write: checked.write };
  };

  it("31. a valid Paid write reaches the service and stores no amount", () => {
    const r = run({ status: "Paid", paidDate: "2026-07-06" });
    assert.equal(r.stage, "ok");
    assert.equal(r.stage === "ok" && r.write.paidAmount, undefined);
  });

  it("32. a valid Unpaid write clears the date", () => {
    const r = run({ status: "Unpaid", paidDate: "" });
    assert.equal(r.stage, "ok");
    assert.equal(r.stage === "ok" && r.write.paidDate, null);
  });

  it("33. a partial above the fee is a 422 from the invariant layer", () => {
    const r = run({ status: "Partially Paid", paidDate: "2026-07-06", paidAmount: 900_000 });
    assert.equal(r.stage, "invariant");
    assert.equal(r.stage === "invariant" && r.status, 422);
  });

  it("34. a future date is a 422", () => {
    const r = run({ status: "Paid", paidDate: "2026-07-19" });
    assert.equal(r.stage, "invariant");
    assert.equal(r.stage === "invariant" && r.status, 422);
    assert.equal(r.stage === "invariant" && r.message, "A payment date can't be in the future");
  });

  it("35. today itself is accepted", () => {
    assert.equal(run({ status: "Paid", paidDate: TODAY_ISO }).stage, "ok");
  });

  it("36. a partial with no amount is refused, never inferred", () => {
    const r = run({ status: "Partially Paid", paidDate: "2026-07-06" });
    assert.equal(r.stage, "invariant");
    assert.equal(r.stage === "invariant" && r.message, "Enter how much was collected");
  });
});

describe("PATCH · ghost and missing are indistinguishable", () => {
  it("37. bill-missing is the only 404 in the whole map", () => {
    const notFound = Object.entries(PAYMENT_ERROR).filter(([, v]) => v.status === 404);
    assert.deepEqual(notFound.map(([k]) => k), ["bill-missing"]);
  });

  it("38. …and its message names no student and no ghost", () => {
    const { message } = PAYMENT_ERROR["bill-missing"];
    assert.equal(message, "Bill not found");
    assert.ok(!/student/i.test(message));
    assert.ok(!/deleted|ghost|archived/i.test(message));
  });

  it("39. every other violation is a 422 about the payload", () => {
    for (const [code, v] of Object.entries(PAYMENT_ERROR)) {
      if (code === "bill-missing") continue;
      assert.equal(v.status, 422, code);
    }
  });

  it("40. the route renders both through the same expression", () => {
    // One lookup, one status, one sentence — the handler cannot tell them apart
    // and so cannot leak which happened.
    const branches = PATCH_SRC.match(/PAYMENT_ERROR\[/g) ?? [];
    assert.equal(branches.length, 1);
  });
});

/* ========================================================= the integrity probe */

describe("finance:integrity · read-only by construction", () => {
  const PROBE = readFileSync(path.join(process.cwd(), "scripts", "finance-integrity.mjs"), "utf8");
  const PROBE_CODE = PROBE
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("41. the script exists and is wired to npm", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    assert.equal(pkg.scripts["finance:integrity"], "node scripts/finance-integrity.mjs");
  });

  it("42. uses only countDocuments, find and indexes", () => {
    for (const banned of [
      "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne",
      "deleteMany", "replaceOne", "bulkWrite", "findOneAndUpdate",
      "createIndex", "dropIndex", "createIndexes", "dropIndexes", "drop(",
      "renameCollection", "$out", "$merge",
    ]) {
      assert.ok(!PROBE_CODE.includes(banned), `the probe must not use ${banned}`);
    }
    assert.ok(PROBE_CODE.includes("countDocuments"));
    assert.ok(PROBE_CODE.includes(".find("));
    assert.ok(PROBE_CODE.includes(".indexes()"));
  });

  it("43. the accepted baseline is null and is not learned", () => {
    assert.ok(/const ACCEPTED_BASELINE = null;/.test(PROBE_CODE),
      "Sprint 9 has authorised no write, so no baseline may be banked");
    assert.ok(!/ACCEPTED_BASELINE\s*=\s*\{/.test(PROBE_CODE));
    assert.ok(!/writeFileSync|appendFileSync/.test(PROBE_CODE), "it never rewrites itself");
  });

  it("44. the Gate 1 observation is recorded separately from the baseline", () => {
    assert.ok(/const GATE_1_OBSERVATION = \{/.test(PROBE_CODE));
    assert.ok(PROBE.includes("b3e2fb7ae5dd0cc1baac3c4f62c7459bfa62292b839970a84703a8e02d9ca6ca"));
    assert.ok(/count: 84/.test(PROBE_CODE));
    assert.ok(/ghostBills: 24/.test(PROBE_CODE));
    assert.ok(/duplicateGroups: 0/.test(PROBE_CODE));
    assert.ok(/partialsWithoutAmount: 9/.test(PROBE_CODE));
    assert.ok(/futurePaidDates: 6/.test(PROBE_CODE));
  });

  it("45. the natural key it checks is the TRIPLE, not the pair", () => {
    assert.ok(/\$\{d\.studentId\}\|\$\{d\.classId\}\|\$\{d\.month\}/.test(PROBE_CODE),
      "duplicates are grouped on (studentId, classId, month)");
  });

  it("46. it expects exactly the five indexes production has", () => {
    assert.ok(/indexes: \["_id_", "classId_1", "id_1", "month_1", "studentId_1"\]/.test(PROBE_CODE));
  });

  it("47. the digest construction matches the Reviews probe", () => {
    // Same sort key, same stripped keys, same hash — so the three collections'
    // digests are comparable rather than merely similar-looking.
    const reviews = readFileSync(path.join(process.cwd(), "scripts", "reviews-integrity.mjs"), "utf8");
    for (const shared of [
      'const STORAGE_KEYS = new Set(["_id", "__v"]);',
      'createHash("sha256").update(JSON.stringify(stripped)).digest("hex")',
      "find({}).sort({ id: 1 })",
    ]) {
      assert.ok(PROBE.includes(shared), `probe: ${shared}`);
      assert.ok(reviews.includes(shared), `reviews probe: ${shared}`);
    }
  });
});
