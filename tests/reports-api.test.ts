/* Reports — the route and the service, and what they may not do.
 *
 * Run with:  npm test
 *
 * NO SERVER AND NO DATABASE, for the reason tests/finance-api.test.ts states:
 * the route imports `@/lib/reports-service`, which imports `server-only`, so this
 * runner cannot load either. What the route ACCEPTS is exercised through the same
 * guard and regex the handler uses; what it CANNOT DO — advance a lifecycle,
 * write, generate, reconcile, persist a file, expose a verb that should not
 * exist — is asserted by scanning the source.
 *
 * THE SCAN IS THE WHOLE POINT FOR THIS MODULE. "A report is a read" is the
 * central invariant of the Sprint 10 contract, it is not expressible as a
 * function call, and `/api/dashboard` is a live example in this same codebase of
 * the mistake it prevents: that route runs `advanceLessonLifecycle()` on a GET
 * and therefore performs a `bulkWrite` when a screen is opened. Reports must not,
 * and this file is where that is pinned. It should fail loudly if a future
 * refactor ever turns the Reports GET into a write-capable route.
 *
 * NOTHING HERE OPENS A SOCKET OR A DATABASE.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ISO_MONTH } from "../src/lib/schemas";
import { REPORT_ERROR, REPORT_TYPES, isReportType } from "../src/lib/reports";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTE = path.join("src", "app", "api", "reports", "route.ts");
const ROUTE_SRC = code(ROUTE);
const SERVICE_SRC = code("src", "lib", "reports-service.ts");
const DASHBOARD_SRC = code("src", "app", "api", "dashboard", "route.ts");
const FINANCE_SRC = code("src", "app", "api", "finance", "route.ts");

/** Every write verb the driver exposes. Neither the route nor the service may
 * contain one — Reports has nothing to write. */
const WRITE_VERBS = [
  "updateOne", "updateMany", "insertOne", "insertMany", "deleteOne", "deleteMany",
  "replaceOne", "bulkWrite", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "createIndex", "dropIndex", "createCollection", "save(", "upsert",
];

/** Helpers that change data as a side effect of being asked a question. */
const SIDE_EFFECTS = [
  "advanceLessonLifecycle", "lifecycle", "reconcile", "ensureRegularLessons",
  "generate", "backfill", "buildSeed", "seed(", "migrat", "remediate",
];

/* ================================================================= the route */

describe("GET /api/reports · the route exists and is guarded", () => {
  it("1. the route file is where Next expects it", () => {
    assert.ok(existsSync(path.join(process.cwd(), ROUTE)));
  });

  it("2. requires a session before anything else", () => {
    assert.ok(ROUTE_SRC.includes("requireSession()"));
    const guard = ROUTE_SRC.indexOf("requireSession()");
    const work = ROUTE_SRC.indexOf("await buildReport(");
    const params = ROUTE_SRC.indexOf("searchParams");
    assert.ok(guard > -1 && work > guard, "the session is checked before the read");
    assert.ok(params > guard, "…and before the query string is even inspected");
  });

  it("3. maps errors through the shared handle()", () => {
    assert.ok(ROUTE_SRC.includes("handle(async"));
  });

  it("4. runs on node, like its sibling database routes", () => {
    assert.ok(/export const runtime = "nodejs"/.test(ROUTE_SRC));
  });

  it("5. exports GET and nothing else", () => {
    assert.ok(/export async function GET/.test(ROUTE_SRC));
    for (const verb of ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
      assert.ok(!new RegExp(`export async function ${verb}\\b`).test(ROUTE_SRC),
        `/api/reports must not export ${verb}`);
      assert.ok(!new RegExp(`export const ${verb}\\b`).test(ROUTE_SRC),
        `/api/reports must not export ${verb}`);
    }
  });

  it("6. there is no nested Reports route that could carry another verb", () => {
    const dir = path.join(process.cwd(), "src", "app", "api", "reports");
    for (const nested of ["[id]", "export", "pdf", "generate", "new"]) {
      assert.ok(!existsSync(path.join(dir, nested)),
        `there is no /api/reports/${nested} — a report has no id and no artefact`);
    }
  });
});

/* ============================================================== validation */

describe("GET /api/reports · request validation", () => {
  it("7. accepts each of the five authorised types", () => {
    for (const t of REPORT_TYPES) assert.ok(isReportType(t), t);
  });

  it("8. refuses an unknown type with 422", () => {
    assert.equal(REPORT_ERROR["type-unknown"].status, 422);
    assert.ok(ROUTE_SRC.includes("isReportType(type)"));
    assert.ok(ROUTE_SRC.includes('REPORT_ERROR["type-unknown"]'));
  });

  it("9. accepts a well-formed month and refuses a malformed one", () => {
    for (const m of ["2026-07", "2026-01", "2026-12", "2025-08"]) assert.ok(ISO_MONTH.test(m), m);
    for (const m of ["", "2026", "2026-7", "2026-13", "2026-00", "july", "2026-07-10"]) {
      assert.ok(!ISO_MONTH.test(m), `${m} must be refused`);
    }
    assert.ok(ROUTE_SRC.includes("ISO_MONTH.test(month)"));
    assert.equal(REPORT_ERROR["month-malformed"].status, 422);
  });

  it("10. the month is never substituted with a default", () => {
    // The server owns the WINDOW; the client owns the CHOICE.
    assert.ok(!/month \?\? CURRENT_MONTH/.test(ROUTE_SRC));
    assert.ok(!ROUTE_SRC.includes("CURRENT_MONTH"), "the route names no default month");
    assert.ok(!ROUTE_SRC.includes("new Date"), "the route holds no clock");
  });

  it("11. an absent filter is the sentinel, not a refusal", () => {
    assert.ok(/params\.get\("classId"\) \|\| null/.test(ROUTE_SRC));
    assert.ok(/params\.get\("studentId"\) \|\| null/.test(ROUTE_SRC));
  });

  it("12. every refusal comes from the shared error map", () => {
    const errors = ROUTE_SRC.match(/return error\(/g) ?? [];
    const mapped = ROUTE_SRC.match(/REPORT_ERROR\[/g) ?? [];
    assert.equal(errors.length, 3, "unknown type, malformed month, and the service's own violation");
    assert.equal(mapped.length, 3, "each refusal renders a mapped violation");
  });

  it("13. a well-formed month with no data is not an error path", () => {
    // The three refusals above are the only ones; emptiness is a payload.
    assert.ok(!/404/.test(ROUTE_SRC), "the route hardcodes no status of its own");
    assert.ok(ROUTE_SRC.includes("json(result.payload)"));
  });
});

/* ========================================================= a read is a read */

describe("GET /api/reports · a read is a read", () => {
  it("14. does not import or call the lesson lifecycle", () => {
    assert.ok(!ROUTE_SRC.includes("advanceLessonLifecycle"));
    assert.ok(!SERVICE_SRC.includes("advanceLessonLifecycle"));
    assert.ok(!SERVICE_SRC.includes("lifecycle"));
  });

  it("15. …unlike /api/dashboard, which does — the contrast is the point", () => {
    assert.ok(DASHBOARD_SRC.includes("advanceLessonLifecycle"),
      "if Dashboard stops writing, this test's premise changes and should be revisited");
    assert.ok(!ROUTE_SRC.includes("advanceLessonLifecycle"));
  });

  it("16. neither route nor service reconciles, generates, seeds or migrates", () => {
    for (const banned of SIDE_EFFECTS) {
      assert.ok(!ROUTE_SRC.includes(banned), `the route must not reference ${banned}`);
      assert.ok(!SERVICE_SRC.includes(banned), `the service must not reference ${banned}`);
    }
  });

  it("17. contains no write verb of any kind", () => {
    for (const banned of WRITE_VERBS) {
      assert.ok(!ROUTE_SRC.includes(banned), `the route must not use ${banned}`);
      assert.ok(!SERVICE_SRC.includes(banned), `the service must not use ${banned}`);
    }
  });

  it("18. the service reads through find/findOne and nothing else", () => {
    const calls = [...SERVICE_SRC.matchAll(/Model\.(\w+)\(/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, "the service does query");
    for (const c of new Set(calls)) {
      assert.ok(["find", "findOne"].includes(c), `Model.${c}() is not a read`);
    }
  });

  it("19. the route reaches no model directly — the service owns every query", () => {
    for (const model of [
      "BillingModel", "StudentModel", "ClassModel", "LessonModel",
      "AttendanceModel", "ParentModel", "HomeworkModel", "ReviewModel", "ActivityModel",
    ]) {
      assert.ok(!ROUTE_SRC.includes(model), `the route must not touch ${model}`);
    }
  });

  it("20. does not call repo.getAll", () => {
    assert.ok(!ROUTE_SRC.includes("getAll"));
    assert.ok(!SERVICE_SRC.includes("getAll"), "312 lessons to answer one screen");
    // Matched as a whole import specifier: "./reports" contains "./repo".
    assert.ok(!/from "\.\/repo"/.test(SERVICE_SRC));
    assert.ok(!/from "@\/lib\/repo"/.test(SERVICE_SRC));
  });

  it("21. uses no write-capable data source", () => {
    // Neither the Dashboard GET (which writes) nor the lessons GET (which
    // generates) may become a Reports data source.
    for (const src of [ROUTE_SRC, SERVICE_SRC]) {
      assert.ok(!src.includes("buildDashboard"));
      assert.ok(!src.includes("/api/dashboard"));
      assert.ok(!src.includes("listLessons"));
      assert.ok(!src.includes("/api/lessons"));
    }
  });

  it("22. makes no HTTP request of its own", () => {
    for (const src of [ROUTE_SRC, SERVICE_SRC]) {
      assert.ok(!src.includes("fetch("), "the read model calls helpers, not endpoints");
    }
  });

  it("23. persists no file and produces no artefact URL", () => {
    for (const src of [ROUTE_SRC, SERVICE_SRC]) {
      for (const banned of [
        "writeFile", "createWriteStream", "fs.", "node:fs", "Blob", "Buffer.from",
        "jspdf", "jsPDF", "xlsx", "csv", "download", "fileUrl",
      ]) {
        assert.ok(!src.includes(banned), `Reports persists nothing — ${banned}`);
      }
    }
  });

  it("24. declares no schema and no index", () => {
    for (const src of [ROUTE_SRC, SERVICE_SRC]) {
      assert.ok(!src.includes("Schema"), "Reports has no model");
      assert.ok(!src.includes("index("), "no index is declared or created");
      assert.ok(!src.includes("autoIndex"));
    }
  });
});

/* ============================================================== the service */

describe("The Reports service · scoped reads and owner-domain delegation", () => {
  it("25. is server-only, so no client bundle can import it", () => {
    assert.ok(SERVICE_SRC.includes('import "server-only"'));
  });

  it("26. holds the application month once, and passes it down", () => {
    assert.ok(SERVICE_SRC.includes("CURRENT_MONTH"));
    assert.ok(SERVICE_SRC.includes("TODAY_ISO"));
    assert.ok(!SERVICE_SRC.includes("new Date("), "no second source of app time");
    assert.ok(!SERVICE_SRC.includes("Date.now"));
    assert.ok(!SERVICE_SRC.includes("FINANCE_MONTHS"), "the seed's window is never a runtime window");
  });

  it("27. delegates every figure — it computes none itself", () => {
    for (const banned of ["Math.round", "reduce(", "* 100", "/ 2"]) {
      assert.ok(!SERVICE_SRC.includes(banned), `the service must not compute (${banned})`);
    }
  });

  it("28. a revenue report reads no bill, and a payment report reads no lesson", () => {
    // The separation is structural: each per-domain read names only its own
    // collections, so no single report body can mix Billing and Revenue.
    const revenueFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf("async function revenueInput"));
    const revenueBody = revenueFn.slice(0, revenueFn.indexOf("async function billingInput"));
    assert.ok(!revenueBody.includes("BillingModel"), "revenue reads no bill");

    const billingFn = SERVICE_SRC.slice(SERVICE_SRC.indexOf("async function billingInput"));
    const billingBody = billingFn.slice(0, billingFn.indexOf("async function homeworkInput"));
    assert.ok(!billingBody.includes("LessonModel"), "tuition reads no lesson");
    assert.ok(!billingBody.includes("AttendanceModel"));
  });

  it("29. bills are selected by Billing.month, never by paidDate", () => {
    assert.ok(/const query[\s\S]{0,160}month/.test(SERVICE_SRC));
    assert.ok(!SERVICE_SRC.includes("paidDate"));
  });

  it("30. assignments are selected by due date, never by createdAt", () => {
    assert.ok(/dueDate:\s*\{\s*\$gte/.test(SERVICE_SRC));
    assert.ok(!SERVICE_SRC.includes("createdAt"));
  });

  it("31. lessons are selected by Lesson.date", () => {
    assert.ok(/date:\s*\{\s*\$gte/.test(SERVICE_SRC));
  });

  it("32. reuses the one roster interpretation this codebase has", () => {
    assert.ok(SERVICE_SRC.includes("resolveRoster"),
      "no second roster interpretation is created");
  });

  it("33. reads parents for existence only — never a name, phone or email", () => {
    assert.ok(/ParentModel[\s\S]{0,80}select\("id -_id"\)/.test(SERVICE_SRC));
    for (const field of ["phone", "email", "relationship"]) {
      assert.ok(!SERVICE_SRC.includes(field), `a report must not read a parent's ${field}`);
    }
  });

  it("34. an unresolvable class or student is refused the way a guess is", () => {
    assert.ok(SERVICE_SRC.includes('violation: "class-missing"'));
    assert.ok(SERVICE_SRC.includes('violation: "student-missing"'));
    assert.equal(REPORT_ERROR["class-missing"].status, 404);
    assert.equal(REPORT_ERROR["student-missing"].status, 404);
  });

  it("35. student status gates nothing", () => {
    assert.ok(!SERVICE_SRC.includes('"Archived"'), "Reports adds no status filter of its own");
    assert.ok(!SERVICE_SRC.includes("status: {"), "no status query anywhere");
  });

  it("36. one dispatcher, five isolated builders", () => {
    for (const builder of [
      "buildMonthlyRevenueBody", "buildClassRevenueBody", "buildStudentPaymentBody",
      "buildAttendanceSummaryBody", "buildHomeworkSummaryBody",
    ]) {
      assert.ok(SERVICE_SRC.includes(builder), `the dispatcher must reach ${builder}`);
    }
    assert.ok(SERVICE_SRC.includes("switch (type)"), "one dispatcher, not five entry points");
  });
});

/* =========================================== the shape of the whole surface */

describe("Reports · the surface as a whole", () => {
  it("37. takes the same read-only posture /api/finance already states", () => {
    // Both refuse a malformed month, both hold no clock, both write nothing.
    for (const src of [ROUTE_SRC, FINANCE_SRC]) {
      assert.ok(src.includes("requireSession()"));
      assert.ok(src.includes("ISO_MONTH"));
      assert.ok(!src.includes("advanceLessonLifecycle"));
    }
  });

  it("38. no Report model was added to the model registry", () => {
    const models = code("src", "lib", "models.ts");
    assert.ok(!/ReportModel/.test(models), "a report is generated, never stored");
    assert.ok(!/"Report"/.test(models));
    assert.ok(!/ReportSchema/.test(models));
  });

  it("39. no Report entity was added to the domain types", () => {
    const types = code("src", "lib", "types.ts");
    assert.ok(!/export interface Report\b/.test(types));
  });

  it("40. the page reads the API and reaches nothing else", () => {
    /* This assertion used to pin that `/reports` was still the untouched
     * placeholder, which was the right guarantee for Gate 3 and is a false one
     * now that Gate 4 has built the screen. What survives the change is the part
     * that was always the point: whatever the page becomes, it talks to this
     * one read-only endpoint and to no model, no service and no write. */
    const page = code("src", "app", "(app)", "reports", "page.tsx");
    assert.ok(!page.includes("ModulePlaceholder"), "the placeholder was replaced in Gate 4");

    for (const server of [
      "reports-service", "buildReport", "dbConnect", "mongoose",
      "BillingModel", "StudentModel", "ClassModel", "LessonModel", "HomeworkModel",
    ]) {
      assert.ok(!page.includes(server), `the page must not reach ${server}`);
    }
    assert.ok(!page.includes("useMutation"), "Reports writes nothing");
    // The fetch itself lives in the client api module, and names one endpoint.
    const api = code("src", "components", "reports", "api.ts");
    assert.ok(api.includes("/api/reports?"));
    assert.ok(!/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(api));
  });
});
