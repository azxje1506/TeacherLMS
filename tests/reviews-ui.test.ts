/* Reviews — the client layer: what the form sends, what the screen says, and
 * what neither of them is allowed to reach.
 *
 * Run with:  npm test
 *
 * NO RENDERER. This project has no component-test infrastructure and Gate 4.3
 * does not create one, so the client is tested the way tests/homework-ui.test.ts
 * tests its own:
 *
 *  - the SHAPING is exercised directly, because it lives in
 *    src/components/reviews/form.ts and reviews-ui.ts as functions over plain
 *    values — which is exactly why those rules are not inline in the component;
 *  - the guarantees that only exist inside JSX — that the page never calls
 *    `perfLabel` on a null score, that a mutation marks the Dashboard stale
 *    without fetching it, that no delete client exists — are asserted by
 *    scanning the source, the technique every suite here already uses for this
 *    class of rule.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEFAULT_RATING, defaultSkills, emptyValues, firstAvailableMonth, hasAvailableMonth,
  toCreateBody, toUpdateBody, valuesFrom, type ReviewFormValues,
} from "../src/components/reviews/form";
import { reviewCountKey, reviewScore } from "../src/components/reviews/reviews-ui";
import { REVIEW_EDITABLE_FIELDS, SKILL_KEYS, perfColor, perfLabel } from "../src/lib/reviews";
import { reviewCreateSchema, reviewUpdateSchema } from "../src/lib/schemas";
import type { ReviewMonthOption } from "../src/lib/reviews";
import type { ReviewDetail } from "../src/lib/reviews-service";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Raw source, comments intact — for scanning the strings a file passes to t(). */
function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

const PAGE = code("src", "app", "(app)", "reviews", "page.tsx");
const DRAWER = code("src", "components", "reviews", "review-drawer.tsx");
const API = code("src", "components", "reviews", "api.ts");
const FORM = code("src", "components", "reviews", "form.ts");
const UI = code("src", "components", "reviews", "reviews-ui.ts");
const CLIENT_FILES: Array<[string, string]> = [
  ["page.tsx", PAGE], ["review-drawer.tsx", DRAWER],
  ["api.ts", API], ["form.ts", FORM], ["reviews-ui.ts", UI],
];

const DICT = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* ------------------------------------------------------------------ fixtures */

const skills = (rating: number) => Object.fromEntries(SKILL_KEYS.map((k) => [k, rating]));

function detail(over: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    id: "rv-1", studentId: "s1", month: "2026-06",
    skills: skills(4), average: 4,
    comment: "A steady month.", strengths: "Reads aloud with confidence.",
    improvements: "Slow down to self-correct.", goals: "One short story a week.",
    parentNotes: "Please sign the reading log.",
    ...over,
  };
}

function months(taken: string[] = []): ReviewMonthOption[] {
  const list: ReviewMonthOption[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 7 - i;
    const month = m > 0 ? `2026-${String(m).padStart(2, "0")}` : `2025-${String(m + 12).padStart(2, "0")}`;
    list.push({ month, taken: taken.includes(month) });
  }
  return list;
}

/* =========================================================================
 * 1. Form shaping
 * ====================================================================== */

describe("Review form — what goes on the wire", () => {
  const values: ReviewFormValues = {
    studentId: "s1", month: "2026-07", skills: skills(4),
    comment: "c", strengths: "s", improvements: "i", goals: "g", parentNotes: "p",
  };

  it("1. a create body carries exactly the eight allowed keys", () => {
    assert.deepEqual(Object.keys(toCreateBody(values)).sort(), [
      "comment", "goals", "improvements", "month", "parentNotes", "skills", "strengths", "studentId",
    ]);
  });

  it("2. an update body carries exactly the six editable keys", () => {
    assert.deepEqual(Object.keys(toUpdateBody(values)).sort(), [...REVIEW_EDITABLE_FIELDS].sort());
    assert.deepEqual(Object.keys(toUpdateBody(values)).sort(), [
      "comment", "goals", "improvements", "parentNotes", "skills", "strengths",
    ]);
  });

  it("3. an update body cannot emit id, studentId or month", () => {
    const body = toUpdateBody(values) as Record<string, unknown>;
    for (const owned of ["id", "studentId", "month"]) {
      assert.ok(!(owned in body), `${owned} must be structurally impossible to send`);
    }
  });

  it("4. an update body cannot emit them even when the form is holding extras", () => {
    const polluted = { ...values, id: "rv-9", status: "Draft", average: 5 } as unknown as ReviewFormValues;
    const body = toUpdateBody(polluted) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "comment", "goals", "improvements", "parentNotes", "skills", "strengths",
    ]);
  });

  it("5. both bodies satisfy the server's own schemas", () => {
    assert.ok(reviewCreateSchema.safeParse(toCreateBody(values)).success);
    assert.ok(reviewUpdateSchema.safeParse(toUpdateBody(values)).success);
  });

  it("6. a new review starts every one of the ten skills at 3", () => {
    assert.equal(DEFAULT_RATING, 3);
    const initial = defaultSkills();
    assert.deepEqual(Object.keys(initial), [...SKILL_KEYS]);
    for (const key of SKILL_KEYS) assert.equal(initial[key], 3, key);
  });

  it("7. the starting ratings are a UI value, not a derived one", () => {
    // Nothing about them comes from attendance, homework, a previous review, the
    // student's status or a class — none of those words appear in the module.
    for (const forbidden of [
      "attendance", "homework", "Homework", "finance", "Klass", "class", "status", "previous", "history",
    ]) {
      assert.ok(!FORM.includes(forbidden), `form.ts must not consult ${forbidden}`);
    }
  });

  it("8. a blank form holds the student, the given month and nothing written", () => {
    const v = emptyValues("s7", "2026-05");
    assert.equal(v.studentId, "s7");
    assert.equal(v.month, "2026-05");
    for (const f of ["comment", "strengths", "improvements", "goals", "parentNotes"] as const) {
      assert.equal(v[f], "");
    }
  });

  it("9. values-from-review round-trips every editable field", () => {
    const review = detail();
    const v = valuesFrom(review);
    assert.equal(v.studentId, review.studentId);
    assert.equal(v.month, review.month);
    assert.deepEqual(v.skills, review.skills);
    assert.deepEqual(toUpdateBody(v), {
      skills: review.skills,
      comment: review.comment, strengths: review.strengths,
      improvements: review.improvements, goals: review.goals, parentNotes: review.parentNotes,
    });
  });

  it("10. the derived average is never carried into the form or back out", () => {
    const v = valuesFrom(detail({ average: 4.9 })) as unknown as Record<string, unknown>;
    assert.ok(!("average" in v));
    assert.ok(!("average" in (toCreateBody(v as unknown as ReviewFormValues) as unknown as Record<string, unknown>)));
  });

  it("11. nothing mutates or aliases its input", () => {
    const review = detail();
    const before = JSON.parse(JSON.stringify(review));
    const v = valuesFrom(review);
    v.skills.listening = 1;
    v.comment = "changed";
    assert.deepEqual(review, before);

    const source: ReviewFormValues = { ...values, skills: skills(2) };
    const body = toCreateBody(source);
    body.skills.reading = 5;
    assert.equal(source.skills.reading, 2);

    const patch = toUpdateBody(source);
    patch.skills.writing = 1;
    assert.equal(source.skills.writing, 2);
  });

  it("12. a body always carries exactly the ten canonical skills", () => {
    const odd = { ...values, skills: { listening: 5, invented: 4 } as Record<string, number> };
    assert.deepEqual(Object.keys(toCreateBody(odd).skills), [...SKILL_KEYS]);
    assert.deepEqual(Object.keys(toUpdateBody(odd).skills), [...SKILL_KEYS]);
    assert.equal(toUpdateBody(odd).skills.invented, undefined);
  });
});

/* =========================================================================
 * 2. Month selection — the client never computes one
 * ====================================================================== */

describe("Review months — chosen, never computed", () => {
  it("13. defaults to the newest untaken month the server offered", () => {
    assert.equal(firstAvailableMonth(months()), "2026-07");
    assert.equal(firstAvailableMonth(months(["2026-07"])), "2026-06");
    assert.equal(firstAvailableMonth(months(["2026-07", "2026-06"])), "2026-05");
  });

  it("14. never silently chooses a taken month", () => {
    const taken = ["2026-07", "2026-05"];
    const picked = firstAvailableMonth(months(taken));
    assert.ok(!taken.includes(picked));
    assert.equal(picked, "2026-06");
  });

  it("15. offers nothing when all twelve are taken — and invents no thirteenth", () => {
    const all = months().map((m) => m.month);
    assert.equal(firstAvailableMonth(months(all)), "");
    assert.equal(hasAvailableMonth(months(all)), false);
    assert.equal(hasAvailableMonth([]), false);
    assert.equal(hasAvailableMonth(undefined), false);
  });

  it("16. no client file computes a month from a wall clock", () => {
    for (const [name, src] of CLIENT_FILES) {
      for (const forbidden of ["new Date", "Date.now", "getMonth", "getFullYear", "toISOString"]) {
        assert.ok(!src.includes(forbidden), `${name} must not read a clock (${forbidden})`);
      }
    }
    assert.ok(!PAGE.includes("CURRENT_MONTH") && !DRAWER.includes("CURRENT_MONTH"),
      "even the app clock is the server's to send");
  });

  it("17. a taken month stays visible, and is disabled rather than hidden", () => {
    assert.ok(DRAWER.includes("disabled: m.taken"), "the option is offered and refused, not removed");
    assert.ok(!/months\.filter\(\(m\) => !m\.taken\)/.test(DRAWER), "no month is dropped from the list");
  });

  it("18. save is disabled when there is no month to write", () => {
    assert.ok(DRAWER.includes("hasAvailableMonth(months)"));
    assert.ok(DRAWER.includes("canSave={canSave}"));
    assert.ok(/const canSave = editing \|\| \(!monthsLoading && hasAvailableMonth\(months\)\)/.test(DRAWER));
  });
});

/* =========================================================================
 * 3. Score presentation — a missing score is not a zero
 * ====================================================================== */

describe("Review score — absence is not a low mark", () => {
  it("19. a student with no review has no score at all", () => {
    assert.equal(reviewScore(null), null);
    assert.equal(reviewScore(undefined), null);
    assert.equal(reviewScore(Number.NaN), null);
  });

  it("20. a real average becomes one decimal, the existing label and the existing colour", () => {
    const score = reviewScore(4.2)!;
    assert.equal(score.value, "4.2");
    assert.equal(score.label, perfLabel(4.2));
    assert.equal(score.color, perfColor(4.2));
    assert.equal(reviewScore(5)!.value, "5.0");
    assert.equal(reviewScore(3)!.value, "3.0");
  });

  it("21. nothing renders 0 for a student who has not been assessed", () => {
    assert.equal(reviewScore(null), null);
    // A real zero is not attainable — the scale starts at 1 — so the only way a
    // "0.0" could appear is by coercing null, which the guard above prevents.
    assert.ok(!PAGE.includes("?? 0") && !PAGE.includes("|| 0"), "no null-to-zero coercion on the page");
    assert.ok(!UI.includes("?? 0") && !UI.includes("|| 0"));
  });

  it("22. perfLabel and perfColor are called in exactly one guarded place", () => {
    for (const [name, src] of [["page.tsx", PAGE], ["review-drawer.tsx", DRAWER]] as const) {
      assert.ok(!src.includes("perfLabel"), `${name} must not call perfLabel directly`);
      assert.ok(!src.includes("perfColor"), `${name} must not call perfColor directly`);
    }
    // reviews-ui.ts is that one place, and it returns null before it calls either.
    const guardAt = UI.indexOf("if (typeof latestAverage !== \"number\"");
    const callAt = UI.indexOf("perfColor(latestAverage)");
    assert.ok(guardAt > 0 && guardAt < callAt, "the null guard precedes the call");
  });

  it("23. the rating control reuses the existing performance colours, defining none", () => {
    assert.ok(UI.includes("perfColor(rating)"));
    for (const threshold of ["4.5", "3.8", "3.0", "2.2"]) {
      assert.ok(!UI.includes(threshold), `reviews-ui.ts restates threshold ${threshold}`);
    }
    // The drawer is checked by its imports instead of by digits, because a card
    // geometry like fontSize 14.5 is not a threshold. Test 22 already proves it
    // calls neither perfLabel nor perfColor.
    assert.ok(!DRAWER.includes("var(--green)") && !DRAWER.includes("var(--amber)"),
      "the drawer names no performance band of its own");
    assert.ok(!/#[0-9a-fA-F]{6}/.test(UI), "no literal hex — tokens only");
  });

  it("24. colour is never the only signal of a selected rating", () => {
    assert.ok(UI.includes("fontWeight: active ? 700 : 500"), "weight changes too");
    assert.ok(UI.includes("border: `1px solid ${active ? color"), "the border changes too");
    assert.ok(DRAWER.includes("aria-checked={active}"), "and the state is published to assistive tech");
  });

  it("25. the count noun comes from the design's own dictionary entries", () => {
    assert.equal(reviewCountKey(1), " review");
    assert.equal(reviewCountKey(0), " reviews");
    assert.equal(reviewCountKey(2), " reviews");
    assert.ok(" review" in DICT && " reviews" in DICT);
  });
});

/* =========================================================================
 * 4. Copy provenance
 * ====================================================================== */

/* Every string these files hand to `t()`. The engine is gettext-style — the
 * English source IS the key — so a literal that is not in the dictionary renders
 * in English rather than breaking, but it also means an unnoticed new string
 * would silently stay untranslated. This pins the exact set. */
function translatedLiterals(src: string): string[] {
  return [...src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
}

/** Strings the Reviews client renders that the dictionary does not yet carry.
 *
 * REPORTED, NOT ADDED. Gate 4.3 authorises exactly one new key — "No linked
 * parent" — and requires anything else to be reported rather than added, so
 * these five are listed here instead of in i18n-vi.json:
 *
 *  - three are the performance labels from src/lib/calc.ts, existing app
 *    vocabulary whose other two members ("Excellent", "Good") the dictionary
 *    already carries. The gap predates Reviews;
 *  - two are the Gate 4.1 validation messages this form is the first to render.
 *
 * Each falls back to English, which is exactly what the i18n engine is built to
 * do. Listing them here means a sixth cannot appear unnoticed. */
const REPORTED_MISSING = [
  "Strong", "Developing", "Needs support",
  "Write at least one note about this month", "Pick a month",
  "Couldn't load reviews", "Couldn't save review",
];

describe("Review copy — provenance", () => {
  it("26. exactly one new dictionary key was added, and it is the authorised one", () => {
    assert.equal(DICT["No linked parent"], "Chưa liên kết phụ huynh");
    // Everything else the Reviews screen says is an entry that predates it.
    for (const key of [
      "Monthly reviews", "Monthly review", "Write review", "No review yet", "Review saved",
      "Review month", "Save review", "Save changes", "View performance", "avg / 5",
      "Teacher comment", "Strengths", "Areas for improvement", "Learning goals", "Parent notes",
      "Write an overall reflection on the month…", "What is this student doing well?",
      "Where should we focus next?", "Goals for next month…", "A private note for the family…",
      "No parent linked. Edit this student to assign one.", "No students", "Try again", "Refresh",
      "Month", " review", " reviews",
    ]) {
      assert.ok(key in DICT, `${JSON.stringify(key)} must already exist`);
    }
  });

  it("27. every skill label the drawer shows is an existing entry", () => {
    // The drawer renders SKILL_LABEL, so the labels themselves are the keys.
    for (const key of SKILL_KEYS) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      assert.ok(label in DICT, `${label} must already exist`);
    }
  });

  it("28. no Review literal is passed through t() outside the dictionary and the reported list", () => {
    const seen = new Set([...translatedLiterals(raw("src", "app", "(app)", "reviews", "page.tsx")),
      ...translatedLiterals(raw("src", "components", "reviews", "review-drawer.tsx"))]);
    const missing = [...seen].filter((s) => s !== "" && !(s in DICT));
    assert.deepEqual(
      missing.sort(),
      [...REPORTED_MISSING].filter((s) => seen.has(s)).sort(),
      "an unreported new string appeared — report it rather than adding it"
    );
  });

  it("29. the reported gaps are genuinely absent, so the list stays honest", () => {
    for (const s of REPORTED_MISSING) {
      assert.ok(!(s in DICT), `${JSON.stringify(s)} is in the dictionary — drop it from the report`);
    }
  });
});

/* =========================================================================
 * 5. Mutation and cache behaviour
 * ====================================================================== */

describe("Review mutations — what they invalidate", () => {
  it("30. the Dashboard is marked stale WITHOUT being refetched", () => {
    assert.ok(
      /invalidateQueries\(\{\s*queryKey:\s*\["dashboard"\],\s*refetchType:\s*"none",?\s*\}\)/.test(PAGE),
      "GET /api/dashboard advances the lesson lifecycle and WRITES to Lessons — "
      + "a review must never trigger it"
    );
  });

  it("31. the Dashboard is never fetched from a Reviews surface", () => {
    for (const [name, src] of CLIENT_FILES) {
      assert.ok(!src.includes("/api/dashboard"), `${name} must not call the dashboard`);
      assert.ok(!src.includes("fetchDashboard"), name);
    }
    // The only mention of the dashboard anywhere is the stale-marking key.
    assert.equal([...PAGE.matchAll(/dashboard/g)].length, 1);
  });

  it("32. reviews are the only cache actually refreshed", () => {
    const keys = [...PAGE.matchAll(/queryKey:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    const unique = [...new Set(keys)].sort();
    assert.deepEqual(unique, ['["dashboard"]', "reviewKeys.all", "reviewKeys.list", "reviewKeys.student(studentId)"]);
  });

  it("33. no unrelated domain is invalidated — a review changes none of them", () => {
    for (const forbidden of [
      "studentKeys", "classKeys", "lessonKeys", "attendanceKeys", "homeworkKeys", "parentKeys",
      '["students"]', '["classes"]', '["lessons"]', '["attendance"]', '["homework"]',
    ]) {
      assert.ok(!PAGE.includes(forbidden), `${forbidden} must not be invalidated`);
    }
  });

  it("34. a duplicate month refreshes the reviews caches and does not retry", () => {
    assert.ok(PAGE.includes('e.code === "review_already_exists"'));
    assert.ok(PAGE.includes("ReviewApiError"));
    assert.ok(!/retry:/.test(PAGE), "no retry option — a refused create is answered once");
  });

  it("35. a successful create closes the drawer and says so with existing copy", () => {
    assert.ok(PAGE.includes('toast(t("Review saved"))'));
    assert.ok(PAGE.includes("setWritingFor(null)"));
    assert.ok(!PAGE.includes("router.push"), "a save never navigates away");
  });
});

/* =========================================================================
 * 6. The API client's surface
 * ====================================================================== */

describe("Reviews API client — what it can and cannot call", () => {
  it("36. exposes the three keys the phase defined", () => {
    assert.ok(API.includes("all: [\"reviews\"]"));
    assert.ok(API.includes("list: [\"reviews\", \"list\"]"));
    assert.ok(API.includes("student: (studentId: string)"));
  });

  it("37. has no DELETE function and issues no DELETE request", () => {
    assert.ok(!/deleteReview/.test(API));
    assert.ok(!/method:\s*"DELETE"/.test(API));
    for (const [name, src] of CLIENT_FILES) {
      assert.ok(!src.includes('method: "DELETE"'), `${name} must issue no DELETE`);
    }
  });

  it("38. has no fetch-by-review-id function", () => {
    assert.ok(!/fetchReview\b/.test(API), "GET /api/reviews/:id does not exist and must not be called");
    const gets = [...API.matchAll(/fetch\(`?\/api\/reviews([^`")]*)/g)].map((m) => m[1]);
    for (const suffix of gets) {
      assert.ok(
        suffix === "" || suffix.startsWith("/student/") || suffix.startsWith("/${encodeURIComponent(id"),
        `unexpected reviews endpoint: ${suffix}`
      );
    }
  });

  it("39. every write goes to the two endpoints the API actually offers", () => {
    assert.ok(API.includes('method: "POST"'));
    assert.ok(API.includes('method: "PATCH"'));
    assert.ok(!/method:\s*"PUT"/.test(API));
  });

  it("40. keeps the server's machine-readable code alongside the sentence", () => {
    assert.ok(API.includes("class ReviewApiError extends Error"));
    assert.ok(API.includes("data.code"));
  });
});

/* =========================================================================
 * 7. UI / business separation
 * ====================================================================== */

describe("The Reviews client holds no business logic", () => {
  it("41. reaches no other module's domain helpers", () => {
    for (const [name, src] of CLIENT_FILES) {
      for (const forbidden of [
        "lib/attendance", "lib/homework", "lib/finance", "lib/lifecycle", "lib/recurrence",
        "lib/reconciler", "lib/lessons", "lib/dashboard", "lib/repo", "advanceLessonLifecycle",
      ]) {
        assert.ok(!src.includes(forbidden), `${name} must not import ${forbidden}`);
      }
    }
  });

  it("42. touches no model and opens no database", () => {
    for (const [name, src] of CLIENT_FILES) {
      for (const forbidden of ["ReviewModel", "StudentModel", "mongoose", "dbConnect", "server-only"]) {
        assert.ok(!src.includes(forbidden), `${name} must not reference ${forbidden}`);
      }
    }
  });

  it("43. re-derives no domain rule of its own", () => {
    for (const [name, src] of [["page.tsx", PAGE], ["review-drawer.tsx", DRAWER], ["form.ts", FORM]] as const) {
      for (const forbidden of ["reviewAverage(", "canReviewStudent(", "isSelectableMonth(", "rankSkills("]) {
        assert.ok(!src.includes(forbidden), `${name} must not recompute ${forbidden}`);
      }
    }
    // The average shown on a card is the server's; the client only formats it.
    assert.ok(PAGE.includes("reviewScore(c.latestAverage)"));
  });

  it("44. the drawer's scale comes from the domain's own bounds", () => {
    assert.ok(DRAWER.includes("REVIEW_RATING_MAX") && DRAWER.includes("REVIEW_RATING_MIN"));
    assert.ok(!/\[1, ?2, ?3, ?4, ?5\]/.test(DRAWER), "the five points are derived, not retyped");
  });

  it("45. the ten skills are rendered from the canonical list, in canonical order", () => {
    assert.ok(DRAWER.includes("SKILL_KEYS.map"));
    assert.ok(DRAWER.includes("SKILL_LABEL["));
    assert.ok(!/"listening"|"speaking"|"pronunciation"/.test(DRAWER), "no skill key is retyped");
  });
});

/* =========================================================================
 * 8. Phase boundary
 * ====================================================================== */

describe("Gate 4.3 stays inside its phase", () => {
  it("46. the index offers Create only — no edit entry point on a card", () => {
    assert.ok(PAGE.includes("review={null}"), "the drawer is always opened in create mode");
    assert.ok(!PAGE.includes("onUpdate"), "no update is reachable from a card");
    assert.ok(!PAGE.includes("updateReview"), "the page imports no update client");
  });

  it("47. the drawer nevertheless supports Edit, ready for the profile timeline", () => {
    assert.ok(DRAWER.includes("toUpdateBody"));
    assert.ok(DRAWER.includes("props.onUpdate(props.review.id"));
    // And an edit renders the month as text rather than a control.
    assert.ok(DRAWER.includes("{!editing ? ("));
  });

  it("48. View performance navigates to the profile's Reviews tab", () => {
    assert.ok(PAGE.includes("href={`/students/${c.studentId}?tab=Reviews`}"));
  });

  it("49. no Student Profile file was drawn into this phase", () => {
    const profile = raw("src", "app", "(app)", "students", "[id]", "page.tsx");
    assert.ok(!profile.includes("components/reviews"), "Gate 4.4 owns the profile's Reviews tab");
  });

  it("50. models.ts still declares no Review compound index", () => {
    const models = code("src", "lib", "models.ts");
    assert.ok(!models.includes("ReviewSchema.index"));
    assert.ok(!/studentId:\s*1/.test(models));
  });

  it("51. the Reviews client is exactly the four files this phase adds", () => {
    const dir = path.join(process.cwd(), "src", "components", "reviews");
    for (const f of ["api.ts", "form.ts", "reviews-ui.ts", "review-drawer.tsx"]) {
      assert.ok(existsSync(path.join(dir, f)), f);
    }
    assert.ok(!existsSync(path.join(dir, "review-card.tsx")), "the card is drawn by the page, as the comp draws it");
  });
});

/* =========================================================================
 * 9. The mobile geometry contract
 *
 * NO DOM, exactly as tests/responsive-components.test.ts explains: this project
 * ships no browser harness, so these assertions read the components as text and
 * check the arithmetic on the numbers they state. That is a real limitation and
 * it is why a human still re-verifies on a device — this file keeps the contract
 * from drifting, it does not replace the device pass.
 *
 * Every rule below is one the Gate 5 Phase 0 remediation already established for
 * Homework and Attendance. Reviews adopts them rather than adding a breakpoint
 * of its own: there is no Reviews-specific CSS anywhere.
 * ====================================================================== */

describe("Reviews — the mobile geometry contract", () => {
  const CSS = raw("src", "app", "globals.css");

  it("52. adds no Reviews-specific responsive CSS at all", () => {
    for (const selector of ["rv-", "review-card", "review-seg", "reviews-grid"]) {
      assert.ok(!CSS.includes(`.${selector}`), `globals.css must carry no .${selector} rule`);
    }
  });

  it("53. the card grid track can shrink below its own minimum", () => {
    // `minmax(min(300px,100%),1fr)` is the post-remediation pattern: at 375px the
    // track is 100% of the column rather than a 300px floor the column cannot pay.
    const tracks = [...PAGE.matchAll(/gridTemplateColumns:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tracks.length > 0);
    for (const track of tracks) {
      assert.equal(track, "repeat(auto-fill,minmax(min(300px,100%),1fr))");
    }
  });

  it("54. every card is a grid item that may shrink", () => {
    assert.ok(UI.includes("minWidth: 0"), "reviewCardStyle must not default to min-width:auto");
    assert.ok(UI.includes("minWidth: 0,\n    background: \"var(--card)\"".replace(/\n\s+/, "\n    "))
      || /minWidth: 0,[\s\S]{0,80}background: "var\(--card\)"/.test(UI));
  });

  it("55. a long student name yields rather than widening the card", () => {
    // The name block is the flexible child; the avatar and the score are fixed.
    assert.ok(PAGE.includes('flex: 1, minWidth: 0'), "the name column shrinks");
    assert.ok(PAGE.includes('textOverflow: "ellipsis", whiteSpace: "nowrap"'), "and truncates");
    assert.equal([...PAGE.matchAll(/flex: "none"/g)].length, 3, "avatar side, score and icon stay fixed");
  });

  it("56. the no-parent pill can never widen a card", () => {
    assert.ok(UI.includes('maxWidth: "100%"') && UI.includes('textOverflow: "ellipsis"'));
  });

  it("57. no drawer field states a width of its own", () => {
    assert.match(DRAWER, /width: "100%", minWidth: 0, maxWidth: "100%"/, "the field family");
    assert.ok(DRAWER.includes('flexDirection: "column", minWidth: 0'), "and the form itself");
  });

  it("58. the five rating segments fit the narrowest supported panel", () => {
    /* At 375px the drawer is a full-screen sheet (globals.css, .app-drawer) and
     * the body pads 22px a side, so the row has 375 - 44 = 331px. Five segments
     * with four 6px gaps leave (331 - 24) / 5 ≈ 61px each — a single digit in a
     * 34px-tall box, comfortably past the 44px touch target on the long axis and
     * far past what "1".."5" needs. Nothing in the row is nowrap-with-a-floor,
     * which is the shape that failed for Attendance's four labelled segments. */
    assert.ok(UI.includes("flex: 1, minWidth: 0"), "each segment shrinks with the row");
    assert.ok(DRAWER.includes('display: "flex", gap: 6, minWidth: 0'), "and so does the group");
    const panel = 375 - 44;
    const segment = (panel - 4 * 6) / 5;
    assert.ok(segment > 44, `a segment is ${segment.toFixed(1)}px`);
    // `minWidth: 0` is the point; a NONZERO floor is the failure shape.
    assert.ok(!/minWidth: [1-9]\d*/.test(UI.slice(UI.indexOf("ratingSegmentStyle"))), "no width floor");
  });

  it("59. the drawer is the shared sheet, with no panel geometry of its own", () => {
    assert.ok(DRAWER.includes("<Drawer"), "the shared chrome, not a new panel");
    assert.ok(!DRAWER.includes("position: \"fixed\""), "no panel positioning is restated");
    assert.match(CSS, /\.app-drawer\{\s*inset:0 !important;width:100% !important/);
  });

  it("60. the page states no fixed pixel width anywhere", () => {
    const widths = [...PAGE.matchAll(/width:\s*(\d+)/g)].map((m) => Number(m[1]));
    for (const w of widths) {
      assert.ok(w <= 52, `a ${w}px fixed width belongs to an icon or avatar, not a layout`);
    }
  });
});
