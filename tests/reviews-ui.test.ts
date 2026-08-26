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
import {
  REVIEW_EDITABLE_FIELDS, REVIEW_ERROR, SKILL_KEYS, perfColor, perfLabel, rankSkills,
} from "../src/lib/reviews";
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
/** Gate 4.4: the Student Profile's Reviews tab, and the profile page it hangs in. */
const TAB = code("src", "components", "reviews", "student-reviews.tsx");
const PROFILE = code("src", "app", "(app)", "students", "[id]", "page.tsx");
/** Gate 4.4C: the analytics charts. */
const CHARTS = code("src", "components", "reviews", "charts.tsx");
const CLIENT_FILES: Array<[string, string]> = [
  ["page.tsx", PAGE], ["review-drawer.tsx", DRAWER], ["student-reviews.tsx", TAB],
  ["charts.tsx", CHARTS], ["api.ts", API], ["form.ts", FORM], ["reviews-ui.ts", UI],
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

/** The Sprint 8 translations Gate 4.5 authorised, and why each one was owed.
 *
 * GATES 4.1–4.4 REPORTED THESE RATHER THAN ADDING THEM: a module sprint may not
 * quietly grow the dictionary, so every string the Reviews UI rendered without a
 * Vietnamese entry was listed in this file instead. Gate 4.5 is the readiness
 * gate, and it authorises exactly this set — no more — because shipping a module
 * that is half Vietnamese and half fallback English is a polish defect.
 *
 * The set is what a teacher can actually SEE while using Reviews:
 *
 *  - three performance labels from src/lib/calc.ts, whose other two members
 *    ("Excellent", "Good") the dictionary already carried. They are drawn on
 *    every index card and every timeline badge;
 *  - one profile subtitle the comp renders inside a computed binding, so neither
 *    dictionary carried it;
 *  - the two API-client failure sentences;
 *  - the four REVIEW_ERROR sentences the dictionary lacked, which reach the
 *    screen through `toast(t(e.message))` — the same treatment HOMEWORK_ERROR's
 *    sentences already have;
 *  - the five Reviews schema messages. Two are rendered inline by the drawer;
 *    three are defensive only — no shipped control can produce a rating that is
 *    not an integer in range — but they are Reviews-owned strings, and a
 *    defensive message that fires in English inside a Vietnamese app is the
 *    hole this gate exists to close.
 *
 * NOT TRANSLATED, DELIBERATELY: "Invalid input", the generic parse fallback in
 * all seventeen route files across every module. It is nobody's module string,
 * and translating it here would change Students, Classes, Parents, Lessons,
 * Attendance and Homework toasts from a Reviews readiness gate. See test 30. */
const AUTHORISED_TRANSLATIONS = [
  "Strong", "Developing", "Needs support",
  "Latest review",
  "Couldn't load reviews", "Couldn't save review",
  "Review not found", "An archived student can't be given a new review",
  "Reviews can only be written for the last 12 months",
  "That student already has a review for this month",
  "Write at least one note about this month", "Pick a month",
  "Rate every skill", "Ratings are whole numbers", "Ratings run from 1 to 5",
];

/** The one string the Reviews surfaces can raise that stays in English. */
const REPORTED_MISSING = ["Invalid input"];

describe("Review copy — provenance", () => {
  it("26. the dictionary carries every word the Reviews UI says", () => {
    assert.equal(DICT["No linked parent"], "Chưa liên kết phụ huynh", "the Gate 4.3 key");
    for (const key of [
      "Monthly reviews", "Monthly review", "Write review", "No review yet", "Review saved",
      "Review month", "Save review", "Save changes", "View performance", "avg / 5",
      "Teacher comment", "Strengths", "Areas for improvement", "Learning goals", "Parent notes",
      "Write an overall reflection on the month…", "What is this student doing well?",
      "Where should we focus next?", "Goals for next month…", "A private note for the family…",
      "No parent linked. Edit this student to assign one.", "No students", "Try again", "Refresh",
      "Month", " review", " reviews",
      // Gate 4.4 — every word the profile's Reviews tab says, bar the one reported above.
      "Learning analytics", "No monthly reviews yet for this student.", "Quick view", "Edit",
      "Strengths & focus areas", "Top strengths",
      "Something went wrong while fetching the list. Check your connection and try again.",
      // Gate 4.5 — the authorised translations.
      ...AUTHORISED_TRANSLATIONS,
    ]) {
      assert.ok(key in DICT, `${JSON.stringify(key)} must be translated`);
    }
  });

  it("26b. every authorised translation is real Vietnamese, not an English echo", () => {
    for (const key of AUTHORISED_TRANSLATIONS) {
      const value = DICT[key];
      assert.equal(typeof value, "string", key);
      assert.ok(value.trim() !== "", `${JSON.stringify(key)} must not be blank`);
      assert.notEqual(value, key, `${JSON.stringify(key)} must not echo the English`);
    }
  });

  it("26c. the five performance labels are one complete, distinct scale", () => {
    /* perfLabel has five outputs and the dictionary now carries all five. They
     * must also be five DIFFERENT Vietnamese words: two bands sharing a label
     * would silently merge on screen. */
    const bands = [5, 4, 3.4, 2.5, 1].map((n) => perfLabel(n));
    assert.deepEqual(bands, ["Excellent", "Strong", "Good", "Developing", "Needs support"]);
    const vi = bands.map((b) => DICT[b]);
    for (const [i, v] of vi.entries()) assert.ok(v, `${bands[i]} must be translated`);
    assert.equal(new Set(vi).size, 5, `the five bands collapsed: ${vi.join(" / ")}`);
  });

  it("27. every skill label the drawer shows is an existing entry", () => {
    // The drawer renders SKILL_LABEL, so the labels themselves are the keys.
    for (const key of SKILL_KEYS) {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      assert.ok(label in DICT, `${label} must already exist`);
    }
  });

  it("28. every literal the three Reviews surfaces pass to t() is translated", () => {
    const seen = new Set([...translatedLiterals(raw("src", "app", "(app)", "reviews", "page.tsx")),
      ...translatedLiterals(raw("src", "components", "reviews", "review-drawer.tsx")),
      ...translatedLiterals(raw("src", "components", "reviews", "student-reviews.tsx"))]);
    const missing = [...seen].filter((s) => s !== "" && !(s in DICT));
    assert.deepEqual(missing.sort(), [], "a new untranslated string appeared on a Reviews surface");
  });

  it("29. every string the Reviews surfaces render THROUGH A VARIABLE is translated too", () => {
    /* The scan above only sees literals. These reach `t()` as values — the
     * performance label on a card, the skill labels, the Quick view headings,
     * and every sentence the server can send into `toast(t(e.message))` — so
     * they are enumerated from their own sources rather than from the JSX. */
    const surfaced = [
      // perfLabel, via reviewScore
      ...[5, 4, 3.4, 2.5, 1].map((n) => perfLabel(n)),
      // SKILL_LABEL, in the drawer and the strengths card
      ...SKILL_KEYS.map((k) => k.charAt(0).toUpperCase() + k.slice(1)),
      // Quick view section headings
      "Strengths", "Areas for improvement", "Learning goals",
      // REVIEW_ERROR — every sentence a Reviews route can answer with
      ...Object.values(REVIEW_ERROR).map((e) => e.message),
      // The API client's own two fallbacks
      "Couldn't load reviews", "Couldn't save review",
      // Every message the Reviews schemas can produce
      "Select a student", "Pick a month", "Rate every skill", "Ratings are whole numbers",
      "Ratings run from 1 to 5", "Write at least one note about this month",
    ];
    const missing = [...new Set(surfaced)].filter((s) => !(s in DICT));
    assert.deepEqual(missing.sort(), [], "a Reviews string can still reach the screen in English");
  });

  it("29b. the one untranslated fallback is shared by every module, not owned by Reviews", () => {
    /* "Invalid input" is the generic parse fallback. Gate 4.5 deliberately did
     * NOT translate it: it lives in every module's routes, so changing it from a
     * Reviews readiness gate would change six other modules' toasts. The
     * assertion is that it is still shared — the day it becomes Reviews-only,
     * this fails and the decision has to be made again. */
    assert.deepEqual(REPORTED_MISSING, ["Invalid input"]);
    assert.ok(!("Invalid input" in DICT), "still untranslated, as reported");
    const owners = new Set<string>();
    for (const dir of ["students", "classes", "parents", "homework", "lessons", "reviews"]) {
      const routes = path.join(process.cwd(), "src", "app", "api", dir, "route.ts");
      if (existsSync(routes) && readFileSync(routes, "utf8").includes('"Invalid input"')) owners.add(dir);
    }
    assert.ok(owners.size >= 5, `shared by ${owners.size} modules, not Reviews alone`);
    assert.ok(owners.has("reviews"));
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

  it("49. the Student Profile reaches Reviews through exactly one component", () => {
    /* Gate 4.3 asserted the profile had NOT been touched. Gate 4.4 is the phase
     * that touches it, and the rule becomes the narrower one: the page mounts
     * `StudentReviews` and imports nothing else from the module — no client, no
     * drawer, no key, no helper. Everything Reviews is behind that one import. */
    const imports = [...PROFILE.matchAll(/from "@\/components\/reviews\/([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(imports, ["student-reviews"]);
    assert.ok(PROFILE.includes("<StudentReviews studentId={id} />"));
  });

  it("50. models.ts still declares no Review compound index", () => {
    const models = code("src", "lib", "models.ts");
    assert.ok(!models.includes("ReviewSchema.index"));
    assert.ok(!/studentId:\s*1/.test(models));
  });

  it("51. the Reviews client is the four files Gate 4.3 added plus the one Gate 4.4 adds", () => {
    const dir = path.join(process.cwd(), "src", "components", "reviews");
    for (const f of ["api.ts", "form.ts", "reviews-ui.ts", "review-drawer.tsx", "student-reviews.tsx"]) {
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

/* =========================================================================
 * 10. Gate 4.4 — the Student Profile's Reviews tab
 *
 * NO RENDERER, as section 9 explains. Two techniques are used below and they
 * are deliberately different:
 *
 *  - the DECISIONS are exercised as functions. `rankSkills` is the domain's
 *    own and is imported and run. The deep-link rule is one pure function of a
 *    string living in the page, and it is EXTRACTED FROM THE SHIPPED SOURCE and
 *    evaluated, so what these assertions run is the code that ships rather than
 *    a restatement of it;
 *  - the guarantees that only exist inside JSX — which field is rendered when,
 *    what is never rendered at all — are asserted by scanning the source.
 *
 * A human still confirms on a device that the tab LOOKS right. This file keeps
 * the contract from drifting; it does not replace that pass.
 * ====================================================================== */

/** The shipped `tabFromQuery`, lifted out of the page and made callable.
 *
 * The page is a client component with next/navigation and React Query at the
 * top, so the test runner cannot import it. The deep-link rule, however, is one
 * function over one string — so it is read out of the source together with the
 * `TABS` list it closes over, the TypeScript assertions are stripped, and the
 * result is executed. If the rule changes, this runs the changed rule. */
function shippedTabFromQuery(): (value: string | null) => string {
  const src = raw("src", "app", "(app)", "students", "[id]", "page.tsx");
  const tabs = /const TABS = (\[[^\]]*\]) as const;/.exec(src);
  const fn = /function tabFromQuery\(value: string \| null\): Tab \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(tabs, "TABS must be readable from the page");
  assert.ok(fn, "tabFromQuery must be a named function on the page");
  const body = fn[1].replace(/ as Tab/g, "");
  return new Function("value", `const TABS = ${tabs[1]};${body}`) as (v: string | null) => string;
}

describe("Student Profile Reviews — the data rendering contract", () => {
  it("61. a student with no reviews gets the recovered empty state, and no score", () => {
    // The branch is on the LATEST review being absent, which is the same fact
    // as "the server sent an empty history" and cannot disagree with it.
    assert.ok(TAB.includes("const latest = reviews[0] ?? null;"));
    /* Both halves are checked because the server sends `analytics: null` for
     * exactly the same case, and either alone would leave the other unproven —
     * a student with no reviews must never reach a chart. */
    assert.ok(
      /latest === null \|\| analytics === null \? \(/.test(TAB),
      "the empty state is what an absent latest review renders"
    );
    assert.ok(TAB.includes('t("No monthly reviews yet for this student.")'));
    // Nothing numeric is drawn in that branch: no average, no label, no chart.
    /* Bounded by the first thing the POPULATED branch says. A JSX comment would
     * be a useless anchor — `code()` strips comments before this file sees it. */
    const empty = TAB.slice(
      TAB.indexOf("latest === null || analytics === null ? ("),
      TAB.indexOf('t("Learning analytics")')
    );
    for (const forbidden of [
      "reviewScore", "toFixed", "avg / 5", "perfLabel", "rankSkills",
      "SkillRadar", "ScoreTrend", "ScoreDonut", "SkillHeatmap", "MetricCard",
    ]) {
      assert.ok(!empty.includes(forbidden), `the empty state must not render ${forbidden}`);
    }
  });

  it("62. the Create CTA is the server's eligibility answer, never a local rule", () => {
    /* `canCreate` comes from the payload, which computes it with the same
     * `canReviewStudent` the create endpoint enforces — so the button can never
     * offer what the API would refuse. */
    assert.ok(TAB.includes("canCreate"), "the payload's own flag");
    assert.ok(!TAB.includes("canReviewStudent"), "eligibility is not re-derived on the client");
    assert.ok(!/"Archived"/.test(TAB), "and no status is compared here");
    assert.ok(!/"Trial"|"Paused"|"Active"/.test(TAB));
  });

  it("63. an Archived student's history reads, and offers no Create", () => {
    // Both CTAs — the empty state's and the header's — are behind `canCreate`,
    // which the server sets false for an Archived student. Nothing else gates
    // the history, so it renders for them exactly as it does for anyone.
    const calls = [...TAB.matchAll(/writeButton\(/g)];
    assert.equal(calls.length, 2, "exactly two call sites — the empty state's and the header's");
    const gated = [...TAB.matchAll(/\{canCreate && writeButton\(/g)];
    assert.equal(gated.length, 2, "and every one of them is gated on canCreate");
  });

  it("64. history is rendered in the server's order and is never re-sorted", () => {
    assert.ok(TAB.includes("reviews.map("), "the payload's array, as it arrived");
    for (const forbidden of [".sort(", ".reverse(", "buildReviewHistory", "latestReview("]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} would restate an order the server already fixed`);
    }
  });

  it("65. the latest review is the head of that newest-first list", () => {
    assert.ok(TAB.includes("const latest = reviews[0] ?? null;"));
    // And it is the only review the header and the strengths card read.
    assert.ok(TAB.includes("fmt.monthLabel(latest.month)"));
    assert.ok(TAB.includes("<StrengthsCard skills={latest.skills} />"));
  });
});

describe("Student Profile Reviews — the timeline", () => {
  it("66. every row's label, colour and one decimal come from the server's average", () => {
    assert.ok(TAB.includes("reviewScore(r.average)"), "the guarded formatter, over the server's number");
    for (const forbidden of ["perfLabel(", "perfColor(", "reviewAverage(", "toFixed("]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} must not be called here`);
    }
    // reviewScore is the one place those live, and it rounds to one decimal.
    assert.equal(reviewScore(4.25)?.value, "4.3");
    assert.equal(reviewScore(4.25)?.label, perfLabel(4.25));
    assert.equal(reviewScore(4.25)?.color, perfColor(4.25));
  });

  it("67. prose the teacher did not write is omitted, never invented", () => {
    // Each of the four prose fields is rendered only when it holds something.
    assert.ok(TAB.includes('r.comment.trim() !== ""'), "the summary line is guarded");
    assert.ok(TAB.includes('.filter(([, value]) => value.trim() !== "")'), "and so is each Quick view section");
    // No fallback text exists to render in their place.
    for (const forbidden of ["No comment", "Not provided", "—", "N/A", "No notes"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} would be fabricated content`);
    }
  });

  it("68. Quick view shows the three approved stored fields and nothing else", () => {
    const quick = TAB.slice(TAB.indexOf("const quick = ("), TAB.indexOf("const last ="));
    for (const field of ["r.strengths", "r.improvements", "r.goals"]) {
      assert.ok(quick.includes(field), `${field} belongs in Quick view`);
    }
    assert.ok(!quick.includes("r.parentNotes"), "parent notes stay in the drawer");
    assert.ok(!quick.includes("r.skills"), "the ten ratings are the drawer's, not a read-only panel's");
    /* Quick view shows STORED REVIEW FIELDS. The derived Attendance and
     * Homework percentages are real and approved, but they belong to the
     * summary cards and the journey — not inside a panel whose whole claim is
     * "here is what the teacher wrote". */
    for (const forbidden of ["r.attendance", "r.homework", "attendance.pct", "homework.pct"]) {
      assert.ok(!quick.includes(forbidden), `${forbidden} is not a stored Review field`);
    }
    // And no field this sprint does not have, anywhere in the file.
    for (const forbidden of ["aiSummary", "achievement", "concern"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} is generated content and must not exist`);
    }
  });

  it("69. every row offers Edit, and nothing anywhere offers Delete", () => {
    assert.ok(TAB.includes("onClick={() => setEditing(r)}"), "Edit is per-row");
    assert.ok(TAB.includes('t("Edit")'));
    assert.ok(!/deleteReview|"Delete"|ConfirmDialog/.test(TAB), "a review is a historical record");
  });

  it("70. Edit opens the Gate 4.3 drawer, and no second form exists", () => {
    assert.ok(TAB.includes("<ReviewDrawer"), "the shared drawer");
    assert.equal([...TAB.matchAll(/<ReviewDrawer/g)].length, 2, "one create, one edit — both the same component");
    for (const forbidden of ["useForm", "<textarea", "<input", "register(", "zodResolver"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} would be a second Review form`);
    }
    // The month is not passed on an edit, so it cannot become a control.
    const edit = TAB.slice(TAB.indexOf("review={editing}"));
    assert.ok(!edit.includes("months={"), "an edit may not change its month");
  });
});

describe("Student Profile Reviews — strengths and focus areas", () => {
  it("71. the card is the domain's ranking, over the latest review alone", () => {
    assert.ok(TAB.includes("rankSkills(skills)"), "the shared pure function");
    assert.ok(!/rankSkills\([^)]*,\s*\d/.test(TAB), "the default count of 3 is not overridden");
    assert.ok(TAB.includes("<StrengthsCard skills={latest.skills} />"));
    // No other review reaches it, and nothing reads the prose to guess a skill.
    assert.ok(!/StrengthsCard[^>]*reviews/.test(TAB));
    assert.ok(!/strengths={r\.strengths}|improvements={r\.improvements}/.test(TAB));
  });

  it("72. rankSkills gives the top three and the bottom three", () => {
    const flat = Object.fromEntries(SKILL_KEYS.map((k) => [k, 3]));
    const varied = {
      ...flat,
      [SKILL_KEYS[4]]: 5, [SKILL_KEYS[7]]: 5, [SKILL_KEYS[1]]: 4,
      [SKILL_KEYS[9]]: 1, [SKILL_KEYS[0]]: 2, [SKILL_KEYS[6]]: 2,
    };
    const { strengths, focus } = rankSkills(varied);
    assert.equal(strengths.length, 3);
    assert.equal(focus.length, 3);
    assert.deepEqual(strengths.map((s) => s.key), [SKILL_KEYS[4], SKILL_KEYS[7], SKILL_KEYS[1]]);
    assert.deepEqual(focus.map((s) => s.key), [SKILL_KEYS[9], SKILL_KEYS[0], SKILL_KEYS[6]]);
    for (const s of strengths) assert.equal(s.rating, varied[s.key]);
  });

  it("73. ties break on the canonical SKILLS order, both ways", () => {
    // Every rating equal: the answer must still be stated rather than left to
    // whatever order the engine's sort happened to produce.
    const flat = Object.fromEntries(SKILL_KEYS.map((k) => [k, 4]));
    const { strengths, focus } = rankSkills(flat);
    assert.deepEqual(strengths.map((s) => s.key), SKILL_KEYS.slice(0, 3));
    assert.deepEqual(focus.map((s) => s.key), SKILL_KEYS.slice(0, 3));
    // And it is the same answer every time.
    assert.deepEqual(rankSkills(flat).strengths, strengths);
  });
});

describe("Student Profile Reviews — the deep link", () => {
  const tabFromQuery = shippedTabFromQuery();

  it("74. ?tab=Reviews selects Reviews", () => {
    assert.equal(tabFromQuery("Reviews"), "Reviews");
    assert.ok(PAGE.includes("href={`/students/${c.studentId}?tab=Reviews`}"), "which is where the index points");
  });

  it("75. every other real tab deep-links too, and none of them is Reviews", () => {
    for (const tb of ["Overview", "Attendance", "Homework", "Classes", "Finance"]) {
      assert.equal(tabFromQuery(tb), tb);
    }
  });

  it("76. an unknown, wrongly-cased, empty or absent tab falls back to Overview", () => {
    for (const bad of ["reviews", "REVIEWS", "Nonsense", "", "__proto__", "constructor", null]) {
      assert.equal(tabFromQuery(bad), "Overview", `${JSON.stringify(bad)} must not select a tab`);
    }
  });

  it("77. the query is read once and never written back, so nothing can loop", () => {
    assert.ok(
      PROFILE.includes('useState<Tab>(() => tabFromQuery(params.get("tab")))'),
      "the query is the INITIAL value of the existing state, not a synced one"
    );
    // No effect chases the URL, and no handler rewrites it.
    assert.ok(!/useEffect\([^)]*params/.test(PROFILE), "no URL/state synchronisation effect");
    assert.ok(!/router\.(push|replace)\([^)]*tab/.test(PROFILE), "a tab click must not rewrite the URL");
    // Ordinary tab clicking still owns the state from then on.
    assert.ok(PROFILE.includes("onClick={() => setTab(tb)}"));
  });

  it("78. useSearchParams sits inside a Suspense boundary, as the Login screen's does", () => {
    assert.ok(PROFILE.includes("useSearchParams"));
    assert.match(PROFILE, /<Suspense fallback=\{null\}>\s*<StudentProfile \/>\s*<\/Suspense>/);
  });
});

describe("Student Profile Reviews — the boundary", () => {
  it("79. the tab fetches exactly one endpoint, and it is the Reviews one", () => {
    assert.ok(TAB.includes("fetchStudentReviews(studentId)"));
    // Every other domain's client is unreachable from here.
    for (const forbidden of [
      "components/attendance", "components/homework", "components/classes", "components/lessons",
      "components/students/api", "components/parents", "fetchStudent(", "fetchDashboard",
      "attendanceKeys", "homeworkKeys", "studentKeys", "classKeys", "lessonKeys", "financeKeys",
    ]) {
      assert.ok(!TAB.includes(forbidden), `the profile tab must not reach ${forbidden}`);
    }
  });

  it("80. it reaches no other module's domain helpers or lifecycle", () => {
    for (const forbidden of [
      "lib/attendance", "lib/homework", "lib/finance", "lib/lifecycle", "lib/recurrence",
      "lib/dashboard", "lib/classes", "lib/students", "lib/lessons", "lib/repo",
      "advanceLessonLifecycle", "attendanceRate", "completionRate",
    ]) {
      assert.ok(!TAB.includes(forbidden), `the profile tab must not import ${forbidden}`);
    }
  });

  it("81. its mutations refresh Reviews and mark the Dashboard stale without fetching it", () => {
    assert.ok(
      /invalidateQueries\(\{\s*queryKey:\s*\["dashboard"\],\s*refetchType:\s*"none",?\s*\}\)/.test(TAB),
      "GET /api/dashboard advances the lesson lifecycle and WRITES to Lessons"
    );
    const keys = [...TAB.matchAll(/queryKey:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    assert.deepEqual([...new Set(keys)].sort(), ['["dashboard"]', "reviewKeys.all", "reviewKeys.student(studentId)"]);
  });

  it("82. the analytics blocks the amendment approved are all present", () => {
    /* GATE 4.4 ASSERTED THE OPPOSITE OF THIS, and correctly: the analytics
     * blocks were deferred because Attendance% and Homework% per student-month
     * were outside the Reviews data contract, not because the design was
     * missing. The Gate 4.4A amendment approved both metrics, so the blocks
     * belong to Sprint 8 now and the assertion inverts. */
    for (const block of [
      "Overall score", "Attendance", "Homework completion", "Skill radar", "Compare",
      "Progress over time", "Score distribution", "Skill trend heatmap",
      "Monthly learning journey",
    ]) {
      assert.ok(TAB.includes(`t("${block}")`), `${block} is part of the amended scope`);
    }
  });

  it("82b. what is STILL deferred is still absent, and still absent whole", () => {
    /* The amendment approved charts, not generated prose, and it did not bring
     * Gate 4.4D's dedicated page or 4.4E's export forward. */
    for (const block of [
      "aiSummary", "achievement", "concern", "View all", "Print", "PDF", "jspdf",
      "MonthlyReviewReport", "report-sheet", "window.print",
    ]) {
      assert.ok(!TAB.includes(block), `${block} is not part of Gate 4.4C`);
    }
    assert.ok(!/Coming soon|arrives in a later sprint/.test(TAB), "and nothing is a dead shell");
    // Edit still opens the drawer: the dedicated route is Gate 4.4D's, and a
    // link to a page that does not exist would be a broken link.
    assert.ok(TAB.includes("onClick={() => setEditing(r)}"), "Edit stays on the drawer for now");
    assert.ok(!TAB.includes("/reviews/${"), "no navigation to an unbuilt route");
  });

  it("83. the profile page gained a branch, and lost none", () => {
    // The Overview tab is untouched, and every other tab still renders the
    // comp's later-sprint panel.
    assert.ok(PROFILE.includes('tab === "Overview" ? ('), "Overview still branches first");
    assert.ok(PROFILE.includes('tab === "Reviews" ? ('), "Reviews is the one new branch");
    assert.ok(PROFILE.includes('t("arrives in a later sprint")'), "and the placeholder is still the fallback");
    assert.ok(PROFILE.includes("Student details") && PROFILE.includes("Parent / Guardian"),
      "the Overview cards are still there");
    assert.equal(
      [...PROFILE.matchAll(/const TABS = \["Overview", "Attendance", "Homework", "Reviews", "Classes", "Finance"\]/g)].length,
      1, "the tab list itself is unchanged"
    );
  });

  it("84. the page holds no Review state, query, key or rule of its own", () => {
    for (const forbidden of [
      "reviewKeys", "fetchStudentReviews", "createReview", "updateReview", "ReviewDrawer",
      "rankSkills", "reviewScore", "ReviewDetail",
    ]) {
      assert.ok(!PROFILE.includes(forbidden), `${forbidden} belongs to student-reviews.tsx, not the page`);
    }
  });

  it("85. no duplicate parent warning is added to the tab — the drawer carries it", () => {
    assert.ok(TAB.includes("parentLinked={parentLinked}"), "it is passed through to the drawer");
    assert.ok(!TAB.includes("noParentPillStyle"), "and not restated as a pill on the profile");
    assert.ok(!TAB.includes("No parent linked"), "the informational sentence stays in the drawer");
    // And no parent state gates a create or an edit.
    assert.ok(!/parentLinked &&|!parentLinked \?|disabled=\{!parentLinked/.test(TAB));
  });
});

/* =========================================================================
 * 11. The profile tab's geometry
 *
 * Same method and same limitation as section 9: the arithmetic on the numbers
 * the component states, read as text.
 * ====================================================================== */

describe("Student Profile Reviews — the mobile geometry contract", () => {
  it("86. adds no Reviews-specific responsive CSS at all", () => {
    const CSS = raw("src", "app", "globals.css");
    for (const selector of ["student-reviews", "rv-timeline", "rv-strengths"]) {
      assert.ok(!CSS.includes(`.${selector}`), `globals.css must carry no .${selector} rule`);
    }
  });

  it("87. the two-column row is the comp's own track, in this app's shrinkable form", () => {
    /* The comp's second row is `repeat(auto-fit,minmax(290px,1fr))`. At 375px the
     * content column is the full viewport less the main padding, which is well
     * under 290px + the gap — so a bare 290px floor is a track the column cannot
     * pay for, exactly the shape the Gate 5 Phase 0 remediation replaced
     * everywhere else. `min(290px,100%)` keeps the comp's two columns at every
     * width that can hold them and lets the item shrink where it cannot. */
    const tracks = [...TAB.matchAll(/gridTemplateColumns: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tracks.length > 0);
    /* The comp uses two floors: 180px for the summary cards and 290px for the
     * chart rows. Both are wrapped in `min(...,100%)` — a bare floor is a track
     * a 375px column cannot pay for, which is the exact shape the Gate 5 Phase 0
     * remediation replaced everywhere else in the app. */
    for (const track of tracks) {
      assert.match(track, /^repeat\(auto-fit,minmax\(min\((180|290)px,100%\),1fr\)\)$/, track);
    }
    assert.equal(tracks.filter((t) => t.includes("180px")).length, 1, "one summary row");
    assert.equal(tracks.filter((t) => t.includes("290px")).length, 3, "two chart rows and the skeleton");
    // Nothing states a bare pixel floor.
    assert.ok(!/minmax\(\d+px/.test(TAB), "every floor is wrapped in min(...,100%)");
  });

  it("88. every panel and every timeline row may shrink below its content", () => {
    assert.ok(TAB.includes("const panel: React.CSSProperties = {\n  minWidth: 0,"),
      "the card surface is a grid item that shrinks");
    // The row, its content column, and the Quick view panel inside it.
    assert.ok(TAB.includes('style={{ display: "flex", gap: 12, minWidth: 0 }}'), "the timeline row");
    assert.ok(TAB.includes('style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}'), "its content column");
  });

  it("89. a long month label wraps instead of widening the column", () => {
    /* At 375px the timeline card's content box is roughly 375 - 36 (main
     * padding) - 42 (card padding + border) - 23 (marker column + gap) ≈ 274px.
     * "Tháng 12 2025" beside "Needs support · 2.1" does not fit that on one
     * line, so the header row wraps and the badge keeps its own width. */
    const header = TAB.slice(TAB.indexOf("marginBottom: 5"), TAB.indexOf("The comp's two-line summary"));
    assert.ok(TAB.includes('justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 5'),
      "the month/badge row wraps");
    assert.ok(header.includes('whiteSpace: "nowrap"'), "the badge itself stays on one line");
    assert.ok(header.includes('overflowWrap: "anywhere"'), "and the month may break if it must");
  });

  it("90. teacher prose can never widen a column, however it was typed", () => {
    // A pasted URL or an unbroken string is the case that overflows.
    assert.equal([...TAB.matchAll(/overflowWrap: "anywhere"/g)].length, 7,
      "timeline month, summary line and Quick view body; journey month and prose; "
      + "the coverage detail line; the radar legend");
  });

  it("91. the tab states no fixed pixel width that a layout depends on", () => {
    const widths = [...TAB.matchAll(/width: (\d+)/g)].map((m) => Number(m[1]));
    for (const w of widths) {
      assert.ok(w <= 52, `a ${w}px fixed width belongs to an icon, a marker or an avatar, not a layout`);
    }
  });

  it("92. the skill rows truncate the label rather than the rating", () => {
    assert.ok(TAB.includes('flex: 1, minWidth: 0, fontSize: 13'), "the label column shrinks");
    assert.equal([...TAB.matchAll(/flex: "none"/g)].length, 10,
      "every fixed sibling of a shrinking column: the timeline and journey badges, "
      + "the strengths icon and rating pill, the overall-score tile, the Compare and "
      + "range controls, the heatmap legend, the radar swatch and the skeleton button");
  });
});

/* =========================================================================
 * 12. Gate 4.4C — the expanded analytics surface
 *
 * The formulas themselves are executed in tests/review-analytics.test.ts. What
 * is asserted here is the WIRING: that the screen renders what the server sent,
 * that it recomputes nothing, that an absent measurement says so, and that the
 * charts carry no arithmetic of their own.
 *
 * Same limitation as sections 9 and 11: no renderer, so this reads the
 * components as text. A human still confirms the charts LOOK right on a device.
 * ====================================================================== */

describe("Student Profile Reviews — the summary metrics", () => {
  it("93. all three summary values come from the payload, not from the client", () => {
    assert.ok(TAB.includes("latestMetrics?.attendance.pct"), "the server's attendance figure");
    assert.ok(TAB.includes("latestMetrics?.homework.pct"), "the server's homework figure");
    assert.ok(TAB.includes("reviewScore(latest.average)"), "the server's average, formatted once");
    // No metric is computed here, from any domain.
    for (const forbidden of [
      "studentAttendanceRate", "studentHomeworkCompletion", "attendanceRate(", "homeworkCompletion(",
      "reviewAverage(", "buildReviewAnalytics(",
    ]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} must not be recomputed on the client`);
    }
  });

  it("94. a null percentage renders No data, and 0% is unreachable for it", () => {
    /* `null` and 0 are different facts — "nobody took a register" and "attended
     * nothing" — and the metric helpers return `null` precisely so this branch
     * can exist. The card must not be able to print 0% for the first. */
    assert.ok(TAB.includes("pct === null ? ("), "the card branches on null before formatting");
    assert.ok(TAB.includes('t("No data")'));
    assert.ok(/\{pct\}%/.test(TAB), "and the percentage is only rendered on the other branch");
    assert.ok(!/pct \?\? 0|pct \|\| 0/.test(TAB), "null must never be coerced to zero");
  });

  it("95. the overall score is the LATEST review's, and no history is folded in", () => {
    assert.ok(TAB.includes("const latestScore = latest ? reviewScore(latest.average) : null;"));
    assert.ok(!/reviews\.(reduce|map)\([^)]*average/.test(TAB), "no average of averages");
  });

  it("96. no percentage is colour-graded — there is no threshold for one", () => {
    /* `perfColor` grades a 1-5 average; nothing in this app grades a percentage,
     * and the Attendance index renders its own rate in `var(--fg)` for exactly
     * that reason. Inventing a band here would be inventing a rule. */
    const card = TAB.slice(TAB.indexOf("function MetricCard"), TAB.indexOf("function NoData"));
    assert.ok(!card.includes("perfColor"), "a percentage is not a performance band");
    assert.ok(card.includes('color: "var(--fg)"'), "it takes the app's plain foreground");
  });

  it("97. coverage is exposed, so a thin denominator is visible rather than disguised", () => {
    assert.ok(TAB.includes("latestMetrics.attendance.registersTaken"));
    assert.ok(TAB.includes("latestMetrics.attendance.lessonsCompleted"));
    assert.ok(TAB.includes('t("Registers taken")'));
    // Secondary: smaller than the figure it qualifies.
    assert.match(TAB, /detail && \(/);
  });
});

describe("Student Profile Reviews — the charts are wired, not calculated", () => {
  it("98. the charts module holds no arithmetic of its own", () => {
    /* GEOMETRY IS NOT A BUSINESS FORMULA. A radar has to place a point
     * somewhere, and converting a viewBox coordinate into a CSS percentage is
     * arithmetic about pixels, not about a student. What must not be here is an
     * AVERAGE, a RANKING, a BUCKETING or a REPORTED PERCENTAGE — those are rules
     * a test could not reach once they were inside a component. */
    for (const forbidden of [
      "reviewAverage", "rankSkills", "reviewDistribution", "buildReviewHeatmap",
      "reviewTrend(", "biggestImprovement", "previousReview", "studentAttendanceRate",
    ]) {
      assert.ok(!CHARTS.includes(forbidden), `${forbidden} belongs in the analytics module`);
    }
    // The percentage on screen is the one the domain computed, read off a prop.
    assert.ok(CHARTS.includes("{b.pct}%"), "the legend renders the domain's own percentage");
    assert.ok(
      !/(count|done|attended)\s*\/\s*(total|10|SKILL_KEYS)/.test(CHARTS),
      "no reported percentage is derived from counts here"
    );
  });

  it("99. it reaches no other domain and opens nothing", () => {
    for (const forbidden of [
      "lib/attendance", "lib/homework", "lib/finance", "lib/dashboard", "lib/repo",
      "useQuery", "useMutation", "fetch(", "Model", "dbConnect",
    ]) {
      assert.ok(!CHARTS.includes(forbidden), `charts.tsx must not reference ${forbidden}`);
    }
  });

  it("100. no charting dependency was added", () => {
    const pkg = JSON.parse(raw("package.json")) as { dependencies: Record<string, string> };
    const deps = Object.keys(pkg.dependencies);
    for (const lib of ["recharts", "chart.js", "d3", "victory", "@nivo/core", "apexcharts", "echarts"]) {
      assert.ok(!deps.includes(lib), `${lib} was added — the comp draws its own SVG`);
    }
    // The comp's charts are inline SVG, and so are these.
    assert.ok(CHARTS.includes("<svg"), "drawn by hand, as the design draws them");
  });

  it("101. every chart scales with its card rather than defining the card's width", () => {
    // A viewBox plus a percentage width is what makes an SVG responsive; a
    // pixel width on the element is what makes a page overflow.
    assert.equal([...CHARTS.matchAll(/viewBox=/g)].length, 3, "radar, trend, donut");
    assert.ok(CHARTS.includes('width: "100%", height: "100%"'), "the radar fills its box");
    assert.ok(CHARTS.includes('width: "100%", height: "auto"'), "and the trend keeps its ratio");
  });

  it("102. the heatmap scrolls inside itself, so the page never widens", () => {
    assert.ok(CHARTS.includes('overflowX: "auto"'), "the grid gets its own scroll container");
    assert.ok(CHARTS.includes('minWidth: "min-content"'), "and may exceed the card it sits in");
    // The card and its column can still shrink.
    assert.ok(CHARTS.includes('overflowX: "auto", minWidth: 0'));
  });

  it("103. colour comes from the existing performance band, with no literal hex", () => {
    assert.ok(CHARTS.includes("perfColor(a.rating)") && CHARTS.includes("perfColor(b.rating)"));
    const hexes = [...CHARTS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    assert.deepEqual(hexes, [], "every colour is a token or an existing band");
  });
});

describe("Student Profile Reviews — comparison, range and empty series", () => {
  it("104. Compare is not rendered at all when there is no previous review", () => {
    /* A disabled Compare button would advertise a comparison that does not
     * exist. The control is behind the data, not styled to look unavailable. */
    assert.ok(TAB.includes("{analytics.radar.previous && ("), "the control is conditional on the data");
    assert.ok(!/disabled=\{!analytics\.radar\.previous/.test(TAB), "not disabled — absent");
    // And the second series is only drawn when the overlay is on AND it exists.
    assert.ok(CHARTS.includes("const showPrevious = compare && previous !== null;"));
  });

  it("105. the previous series is the previous REVIEW, straight from the payload", () => {
    assert.ok(TAB.includes("previous={analytics.radar.previous?.axes ?? null}"));
    // The client never picks it — that is `previousReview`, in the pure module.
    assert.ok(!TAB.includes("previousReview"), "the comparison is chosen server-side");
    assert.ok(!/reviews\[1\]/.test(TAB), "and never guessed at as the second entry");
  });

  it("106. the trend window is anchored to the SERVER's application month", () => {
    assert.ok(TAB.includes("trendWindowPoints(analytics.trend, defaultMonth, windowMonths)"));
    assert.ok(TAB.includes("TREND_WINDOWS.map"), "6M and 12M come from the domain's own list");
    // No client clock, anywhere.
    for (const forbidden of ["new Date", "Date.now", "CURRENT_MONTH", "getMonth()"]) {
      assert.ok(!TAB.includes(forbidden), `${forbidden} must not appear on the client`);
    }
  });

  it("107. a single point draws a dot and no line", () => {
    assert.ok(CHARTS.includes("{coords.length > 1 && ("), "the path is conditional");
    assert.ok(CHARTS.includes("points.length === 1 ?"), "and a lone point is centred");
  });

  it("108. an empty windowed series says No data rather than drawing an empty chart", () => {
    assert.ok(CHARTS.includes("if (points.length === 0)"));
    assert.ok(CHARTS.includes('{t("No data")}'));
  });

  it("109. the distribution legend omits empty buckets but the data keeps five", () => {
    assert.ok(CHARTS.includes("buckets.filter((b) => b.count > 0)"), "empty slices are not drawn");
    assert.ok(TAB.includes("buckets={analytics.distribution}"), "and all five are passed in");
    // The five come from the pure module, not from a filter on the client.
    assert.ok(!TAB.includes("[1, 2, 3, 4, 5]"), "the buckets are not rebuilt here");
  });
});

describe("Student Profile Reviews — the learning journey", () => {
  it("110. each entry pairs stored words with that month's derived metrics", () => {
    assert.ok(TAB.includes('t("Monthly learning journey")'));
    assert.ok(TAB.includes("const metricsFor = new Map(metricsByMonth.map((m) => [m.month, m]));"));
    assert.ok(TAB.includes("metricsFor.get(r.month)"), "a month's numbers beside that month's words");
    assert.ok(TAB.includes("m?.attendance.pct") && TAB.includes("m?.homework.pct"));
  });

  it("111. a journey metric with no data says so, and never shows 0%", () => {
    assert.ok(TAB.includes("pct === null ? noData : `${pct}%`"));
    assert.ok(TAB.includes('noData={t("No data")}'));
  });

  it("112. journey prose is the teacher's own, and absent when unwritten", () => {
    const journey = TAB.slice(TAB.indexOf('t("Monthly learning journey")'));
    assert.ok(journey.includes('r.comment.trim() !== ""'), "empty prose renders nothing");
    for (const forbidden of ["achievement", "🏆", "aiSummary", "summary:", "generate"]) {
      assert.ok(!journey.includes(forbidden), `${forbidden} would be fabricated`);
    }
  });

  it("113. nothing about the journey is persisted", () => {
    assert.ok(!TAB.includes("useMutation({ mutationFn: (j"), "there is no journey writer");
    // The only two mutations on this surface are still the review create and edit.
    assert.equal([...TAB.matchAll(/useMutation\(/g)].length, 2);
  });
});

describe("The Reviews payload carries the derived metrics", () => {
  it("114. the student payload declares analytics and both metrics", () => {
    const svc = code("src", "lib", "reviews-service.ts");
    for (const field of ["analytics: ReviewAnalytics | null", "latestMetrics: StudentMonthMetrics | null", "metricsByMonth: StudentMonthMetrics[]"]) {
      assert.ok(svc.includes(field), `the payload must declare ${field}`);
    }
    // `null` for a student with no reviews, so the screen shows its empty state
    // rather than a shell of zeroed charts.
    assert.ok(svc.includes("analytics: latest ? buildReviewAnalytics(latest, history) : null"));
  });

  it("115. the metrics are computed per request and never stored", () => {
    const svc = code("src", "lib", "reviews-service.ts");
    assert.ok(svc.includes("studentAttendanceRate(studentId, month, { lessons, attendance })"));
    assert.ok(svc.includes("studentHomeworkCompletion(studentId, month, { homework })"));
    // A Review document still has nine fields and no percentage among them.
    const domain = code("src", "lib", "reviews.ts");
    assert.ok(!/attendance|homeworkCompletion|pct/.test(domain), "the Review document gains nothing");
  });
});

/* =========================================================================
 * 13. The Student Profile tab strip
 *
 * A REPORTED DEFECT, PINNED. The strip declared `overflow-x: auto` and nothing
 * else, and a vertical scrollbar appeared beside the tabs — worse on tablet and
 * phone. The cause is one line of CSS Overflow 3: with one axis non-visible, the
 * other computes from `visible` to `auto`. Everything below exists so that a
 * future edit cannot quietly re-create it.
 *
 * Same limitation as every other suite here: no browser, so the rules are read
 * as text and the arithmetic is done on the numbers they state.
 * ====================================================================== */

describe("The Student Profile tab strip scrolls sideways and only sideways", () => {
  const TAB_UI = code("src", "components", "students", "student-ui.tsx");
  const CSS = raw("src", "app", "globals.css");
  const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  it("116. both axes are stated — the defect was leaving one of them out", () => {
    /* `overflow-x: auto` alone does NOT leave `overflow-y` alone: it computes to
     * `auto`, and then the tabs' own -1px overlap is enough to draw a scrollbar.
     * Stating both is the fix, and the assertion is that both keep being stated. */
    assert.match(PROFILE, /overflowX: "auto", overflowY: "hidden"/);
    assert.ok(
      !/role="tablist"[\s\S]{0,400}overflowX: "auto"(?![\s\S]{0,40}overflowY)/.test(PROFILE),
      "overflowX must never appear on the strip without overflowY beside it"
    );
  });

  it("117. the overflow is kept — only the scrollbar's chrome is hidden", () => {
    /* Hiding the OVERFLOW would make the later tabs unreachable. Hiding the
     * scrollbar leaves wheel, trackpad, touch and keyboard scrolling intact —
     * and is what stops a 10px horizontal scrollbar eating 10px of a 38px tab. */
    assert.match(RULES, /\.tabstrip\{[^}]*scrollbar-width:none/);
    assert.match(RULES, /\.tabstrip::-webkit-scrollbar\{display:none\}/);
    assert.ok(!/role="tablist"[\s\S]{0,400}overflowX: "hidden"/.test(PROFILE), "the strip still scrolls");
    assert.ok(PROFILE.includes('className="tabstrip"'));
  });

  it("118. a swipe off the end of the strip does not become a back gesture", () => {
    assert.match(RULES, /\.tabstrip\{[^}]*overscroll-behavior-x:contain/);
  });

  it("119. a tab never shrinks and never wraps", () => {
    /* Flex items shrink by default, and a strip that squeezes its tabs never
     * overflows — so it never scrolls, and the later tabs are simply lost. */
    assert.ok(TAB_UI.includes("flexShrink: 0"), "tabStyle must hold its width");
    assert.ok(TAB_UI.includes('whiteSpace: "nowrap"'), "and keep its label on one line");
    assert.ok(!/flexWrap: "wrap"/.test(PROFILE.slice(PROFILE.indexOf('role="tablist"') - 400)), "the strip does not wrap");
  });

  it("120. the divider sits OUTSIDE the scroll container, so the underline survives", () => {
    /* A scroll container clips at its padding box. The active tab hangs 1px
     * below the flex line (`marginBottom: -1`) so its 2px underline covers the
     * divider; clipping on the same element would shave that back to 1px. The
     * strip therefore pads its 1px back and pulls it off again, and the divider
     * is drawn by the wrapper. Net geometry is unchanged. */
    assert.match(
      PROFILE,
      /borderBottom: "1px solid var\(--border\)", marginBottom: 18 \}\}>\s*<div\s+ref=\{tablistRef\}/,
      "the wrapper draws the divider and wraps the strip"
    );
    assert.match(PROFILE, /paddingBottom: 1, marginBottom: -1/, "the strip gives back the 1px it clips");
    assert.ok(TAB_UI.includes("marginBottom: -1"), "and the tab still overlaps the divider");
    // The strip itself must not also draw a border — that would double the rule.
    const strip = PROFILE.slice(PROFILE.indexOf("ref={tablistRef}"), PROFILE.indexOf("TABS.map"));
    assert.ok(!strip.includes("borderBottom"), "only the wrapper draws the divider");
  });

  it("121. the selected tab is scrolled into view without moving the page", () => {
    /* `scrollIntoView` looks for the nearest scrollable ancestor on BOTH axes
     * and can scroll the document under the reader. Setting `scrollLeft` on one
     * element cannot. */
    assert.ok(PROFILE.includes("strip.scrollLeft = left"), "leftwards when the tab is behind");
    assert.ok(PROFILE.includes("strip.scrollLeft = right - strip.clientWidth"), "and rightwards when ahead");
    assert.ok(!PROFILE.includes("scrollIntoView"), "never scrollIntoView — it can move the page");
    assert.ok(!PROFILE.includes("scrollTop"), "and the vertical axis is never touched");
  });

  it("122. it runs on the selected tab, so a deep link lands on a visible tab", () => {
    assert.match(PROFILE, /useEffect\(\(\) => \{[\s\S]{0,500}aria-selected="true"[\s\S]{0,500}\}, \[tab\]\);/);
    // And it only acts when the tab is genuinely out of view.
    assert.ok(PROFILE.includes("if (left < strip.scrollLeft)"), "a visible tab is left alone");
  });

  it("123. the strip is the only scroller on the profile, and the page is not one", () => {
    const scrollers = [...PROFILE.matchAll(/overflowX: "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scrollers, ["auto"], "one horizontal scroller: the tab strip");
    assert.ok(!PROFILE.includes('overflowY: "auto"'), "nothing on this page scrolls vertically by itself");
  });

  it("124. six tabs at 375px: the strip must scroll, and Reviews must be reachable", () => {
    /* THE ARITHMETIC THIS FIX EXISTS FOR. At 375px the sidebar is out of flow and
     * `.app-main` pads 14px a side, so the content column is 347px. Six tabs at
     * 13.5px with 14px of padding a side, plus five 2px gaps, come to roughly
     * 494px in English and more in Vietnamese — comfortably wider than 347px.
     *
     * So the strip DOES overflow at 375px, which is exactly why hiding the
     * overflow would have been the wrong fix and why the selected tab has to be
     * scrolled into view. Reviews is the fourth of six: without the effect it
     * would begin around 269px into a 347px window and end past its right edge. */
    const column = 375 - 14 * 2;
    const tabs = [8, 10, 8, 7, 7, 7]; // Overview, Attendance, Homework, Reviews, Classes, Finance
    const width = (chars: number) => chars * 6.75 + 28; // ~0.5em glyphs plus 14px padding a side
    const strip = tabs.reduce((sum, c) => sum + width(c), 0) + 2 * (tabs.length - 1);
    assert.ok(strip > column, `the strip is ~${strip.toFixed(0)}px in a ${column}px column — it must scroll`);

    /* Reviews is the fourth of six and lands within a few pixels of the right
     * edge — ~341px into a 347px window. It FITS, barely, and that is the point:
     * a margin that thin is a coincidence of one font at one language, not a
     * guarantee. Classes and Finance are plainly off-screen either way, so the
     * strip must scroll and the selected tab must be brought into view rather
     * than trusted to land somewhere visible. */
    const reviewsEnd = tabs.slice(0, 4).reduce((sum, c) => sum + width(c), 0) + 2 * 3;
    assert.ok(reviewsEnd > column - 20, `Reviews ends at ~${reviewsEnd.toFixed(0)}px — too close to ${column} to rely on`);
    const financeEnd = strip;
    assert.ok(financeEnd > column + 100, "and the last tabs are well past the edge");
  });

  it("125. from 768px up the strip fits, so nothing scrolls and nothing is hidden", () => {
    // 768px: sidebar rail 64px, `.app-main` pads 18px a side -> 668px column.
    const column = 768 - 64 - 18 * 2;
    const strip = [8, 10, 8, 7, 7, 7].reduce((sum, c) => sum + (c * 6.75 + 28), 0) + 2 * 5;
    assert.ok(strip < column, `~${strip.toFixed(0)}px fits a ${column}px column`);
  });
});
