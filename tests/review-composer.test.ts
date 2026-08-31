/* The dedicated Review composer — routes, modes, saving, guards and boundaries.
 *
 * Run with:  npm test
 *
 * NO RENDERER, same as every other client suite here. What can be exercised as a
 * function is exercised — the shared form shaping lives in
 * src/components/reviews/form.ts and the whole report model in
 * src/lib/review-report.ts, which is why the live-preview promise is tested for
 * real in tests/review-report.test.ts. What only exists inside JSX — that Save
 * is the only thing that POSTs, that a create REPLACES itself with the record it
 * made, that Back is guarded, that no dead Print button shipped — is asserted by
 * scanning the source, the technique this repository already uses for this class
 * of rule.
 *
 * NOTHING HERE OPENS A SOCKET, A DATABASE OR A BROWSER.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { emptyValues, toCreateBody, toUpdateBody } from "../src/components/reviews/form";
import { REVIEW_EDITABLE_FIELDS, SKILL_KEYS, firstUntakenMonth } from "../src/lib/reviews";
import type { ReviewMonthOption } from "../src/lib/reviews";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function raw(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}
function has(...parts: string[]): boolean {
  return existsSync(path.join(process.cwd(), ...parts));
}

/** The ONE `@media` block matching `query` that contains `marker`, brace-matched
 * to its own closing brace.
 *
 * globals.css carries several blocks per breakpoint — three at 620px, two at
 * 767px — so slicing on the query alone reads whichever came first, and slicing
 * to the end of the file runs on into the narrower blocks below and reports
 * their rules as this one's. Both mistakes pass an assertion while proving the
 * opposite of what it claims, so neither is available here: this finds the block
 * that actually holds the rule under test, and stops where that block does. */
function mediaBlock(query: string, marker: string): string {
  const open = `@media ${query}{`;
  let from = 0;
  for (;;) {
    const start = CSS.indexOf(open, from);
    assert.ok(start >= 0, `no "${query}" block contains ${marker}`);
    let depth = 0;
    let i = start + open.length - 1;
    for (; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) break;
    }
    const body = CSS.slice(start + open.length, i);
    if (body.includes(marker)) return body;
    from = start + open.length;
  }
}

const CREATE_ROUTE = ["src", "app", "(app)", "reviews", "new", "page.tsx"];
const EDIT_ROUTE = ["src", "app", "(app)", "reviews", "[reviewId]", "page.tsx"];
const COMPOSER_API = ["src", "app", "api", "reviews", "composer", "route.ts"];
const REPORT_API = ["src", "app", "api", "reviews", "[id]", "report", "route.ts"];

const CREATE_PAGE = code(...CREATE_ROUTE);
const EDIT_PAGE = code(...EDIT_ROUTE);
const COMPOSER = code("src", "components", "reviews", "review-composer.tsx");
const FIELDS = code("src", "components", "reviews", "review-form-fields.tsx");
const REPORT_VIEW = code("src", "components", "reviews", "monthly-review-report.tsx");
const STATES = code("src", "components", "reviews", "composer-states.tsx");
/** Gate 4.4D remediation: the stage, identity and month rules, extracted so the
 * cross-month isolation defect became testable. */
const STATE = code("src", "components", "reviews", "composer-state.ts");
const SERVICE = code("src", "lib", "reviews-service.ts");
const API = code("src", "components", "reviews", "api.ts");
const INDEX = code("src", "app", "(app)", "reviews", "page.tsx");
const TAB = code("src", "components", "reviews", "student-reviews.tsx");
const CSS = raw("src", "app", "globals.css");
const DICT = JSON.parse(raw("src", "lib", "i18n-vi.json")) as Record<string, string>;

/* =========================================================================
 * 1. Architecture — two routes, one surface
 * ====================================================================== */

describe("Gate 4.4D · architecture", () => {
  it("1. a dedicated Create route exists, keyed on the student", () => {
    assert.ok(has(...CREATE_ROUTE), "/reviews/new must exist");
    assert.ok(CREATE_PAGE.includes('params.get("studentId")'), "the student comes from the query");
    assert.ok(CREATE_PAGE.includes("<ReviewComposer key={studentId} data={data} />"));
  });

  it("2. a dedicated Edit route exists, keyed on the REVIEW and on nothing else", () => {
    assert.ok(has(...EDIT_ROUTE), "/reviews/[reviewId] must exist");
    assert.ok(EDIT_PAGE.includes("useParams<{ reviewId: string }>()"));
    assert.ok(EDIT_PAGE.includes("<ReviewComposer key={reviewId} data={data} />"));
    /* THE STUDENT IS NOT IN THE EDIT ADDRESS. The Review owns the relationship,
     * so a URL cannot be made to disagree with the record about whose it is. */
    assert.ok(!EDIT_PAGE.includes("studentId"), "an edit route names no student");
    assert.ok(!has("src", "app", "(app)", "students", "[id]", "reviews"),
      "and there is no student-nested review route");
  });

  it("3. both routes render ONE composer, and hold no Review rule of their own", () => {
    for (const [name, src] of [["new", CREATE_PAGE], ["[reviewId]", EDIT_PAGE]] as const) {
      assert.ok(src.includes('from "@/components/reviews/review-composer"'), name);
      /* THE KEY IS LOAD-BEARING. The composer seeds React Hook Form through
       * `defaultValues`, read once per mount — which is what makes the dirty
       * baseline honest. Pointing a route at a different record must therefore
       * REMOUNT it: Edit's month chips navigate between a student's reviews, and
       * when the destination is already cached the data swaps with no loading
       * state to unmount anything, so without a key the form would keep showing
       * the previous record's ratings under the new one's header. */
      assert.ok(
        src.includes("<ReviewComposer key={reviewId} data={data} />")
        || src.includes("<ReviewComposer key={studentId} data={data} />"),
        `${name}/page.tsx must key the composer on the record it is showing`
      );
      for (const forbidden of [
        "useForm", "<textarea", "register(", "zodResolver", "useMutation",
        "toCreateBody", "toUpdateBody", "SKILL_KEYS", "reviewAverage",
      ]) {
        assert.ok(!src.includes(forbidden), `${name}/page.tsx must not hold ${forbidden}`);
      }
    }
  });

  it("4. Create, View and Edit are one component in three stages, not three forms", () => {
    assert.ok(COMPOSER.includes("useState<ComposerStage>(() => initialStage(data.mode))"));
    assert.equal([...COMPOSER.matchAll(/export function ReviewComposer/g)].length, 1);
    assert.ok(!has("src", "components", "reviews", "review-create.tsx"));
    assert.ok(!has("src", "components", "reviews", "review-edit.tsx"));
    /* VIEW/EDIT IS LOCAL STATE, NOT AN ADDRESS. A separate /edit route would
     * make a mode into a URL, and make the back button mean something different
     * depending on which of the two you were on. */
    assert.ok(!has("src", "app", "(app)", "reviews", "[reviewId]", "edit"), "no /edit route");
    assert.ok(!EDIT_PAGE.includes("stage") && !EDIT_PAGE.includes("mode="),
      "the route decides nothing about the stage");
  });

  it("5. the report preview is one shared component over one shared DTO", () => {
    assert.equal([...REPORT_VIEW.matchAll(/export function MonthlyReviewReportView/g)].length, 1);
    assert.ok(REPORT_VIEW.includes("report: MonthlyReviewReport"), "it takes plain data");
    /* THE SPLIT PREVIEW AND THE FULL-SCREEN OVERLAY ARE THE SAME COMPONENT over
     * the same object — which is the structural guarantee that Gate 4.4E's Print
     * and PDF cannot become a third rendering of the report. */
    assert.equal([...COMPOSER.matchAll(/<MonthlyReviewReportView report=\{report\} \/>/g)].length, 2);
  });

  it("6. the report component computes nothing — it renders what it is handed", () => {
    for (const forbidden of [
      "reviewAverage", "rankSkills", "buildTeacherSummary", "perfColor(", "perfLabel(",
      "useQuery", "useMutation", "fetch(",
    ]) {
      assert.ok(!REPORT_VIEW.includes(forbidden), `the report view must not call ${forbidden}`);
    }
    /* The band is checked by ABSENT CALLS above rather than by digits: a font
     * size like 14.5 is not a threshold, and the existing drawer test draws the
     * same distinction for the same reason. What WOULD restate the rule is a
     * comparison against one of the four numbers, so that is what is matched —
     * as a regex literal, because a pattern built from a template literal
     * silently loses its backslashes and passes vacuously. */
    for (const compare of REPORT_VIEW.matchAll(/[><]=?\s*(\d+(?:\.\d+)?)/g)) {
      assert.ok(
        !["4.5", "3.8", "3.0", "2.2"].includes(compare[1]),
        `the report view compares against threshold ${compare[1]}`
      );
    }
    assert.ok(REPORT_VIEW.includes("summary.performanceColor"), "the band arrives on the DTO");
    assert.ok(REPORT_VIEW.includes("summary.performanceLabel"));
  });

  it("7. it is a document, not a screen: nothing in the report is interactive", () => {
    for (const forbidden of ["<button", "onClick", "<input", "<a ", "href="]) {
      assert.ok(!REPORT_VIEW.includes(forbidden), `a printed report has no ${forbidden}`);
    }
    // And it carries the comp's own report classes, which globals.css already
    // gives print rules — the structural preparation Gate 4.4E needs.
    for (const cls of ["report-sheet", "rp-head", "rp-block", "rp-foot"]) {
      assert.ok(REPORT_VIEW.includes(cls), `the sheet must carry .${cls}`);
      assert.ok(CSS.includes(`.${cls}`), `globals.css must style .${cls}`);
    }
  });
});

/* =========================================================================
 * 2. Create
 * ====================================================================== */

describe("Gate 4.4D · Create", () => {
  it("8. eligibility is decided by the SERVER, on the read, before a form is drawn", () => {
    assert.ok(SERVICE.includes(
      'if (!canReviewStudent(student)) return { ok: false, reason: "student_not_eligible" };'
    ), "an Archived student is refused");
    assert.ok(SERVICE.includes(
      'if (!student) return { ok: false, reason: "student_not_found" };'
    ), "and so is a student who does not resolve");
    // The page never decides this for itself.
    assert.ok(!CREATE_PAGE.includes("canReviewStudent") && !CREATE_PAGE.includes("Archived"));
  });

  it("9. a create with no student in the URL asks the server nothing", () => {
    assert.ok(CREATE_PAGE.includes('enabled: studentId !== ""'));
    assert.ok(CREATE_PAGE.includes('if (studentId === "")'), "and says so instead");
    // The route answers the same way for an empty id, so the two cannot diverge.
    const route = code(...COMPOSER_API);
    assert.ok(route.includes('if (studentId === "")'));
    assert.ok(route.includes("REVIEW_ERROR.student_not_found"));
  });

  it("10. the month is the teacher's to choose, from the server's twelve", () => {
    assert.ok(SERVICE.includes("reviewMonthOptions(CURRENT_MONTH, history.map((r) => r.month))"));
    assert.ok(COMPOSER.includes("if (choice.kind === \"select\") requestMonth(choice.month);"));
    // No arithmetic and no clock on the client, in either file.
    for (const [name, src] of [["review-composer.tsx", COMPOSER], ["composer-state.ts", STATE]] as const) {
      for (const forbidden of ["new Date", "Date.now", "CURRENT_MONTH", "getMonth()"]) {
        assert.ok(!src.includes(forbidden), `${name} must not compute a month (${forbidden})`);
      }
    }
  });

  it("10b. ONE compact selector, not a wall of month buttons", () => {
    /* Twelve buttons grew noisier with every month and, worse, appeared to
     * collapse the moment a review was saved — Create listed the window while
     * the persisted route listed only the months that had reviews. It is the
     * app's existing Select now, over one twelve-month list in both modes. */
    assert.ok(COMPOSER.includes('import { Select } from "@/components/ui/select";'));
    assert.ok(COMPOSER.includes("options={selectOptions}"));
    assert.ok(COMPOSER.includes('ariaLabel={t("Review month")}'));
    assert.ok(!/monthChips|\.map\(\(o\) => \{[\s\S]{0,400}<button/.test(COMPOSER),
      "no per-month button is rendered");
    // Each row says what it is, rather than being silently greyed.
    assert.ok(COMPOSER.includes('t("Reviewed")') && COMPOSER.includes('t("No review")'));
    for (const key of ["Reviewed", "No review"]) {
      assert.ok(key in DICT, `${key} must be translated`);
    }
  });

  it("11. a taken month is VISIBLE, disabled, and goes nowhere", () => {
    /* The decision itself is a pure function and is exercised over three months
     * of frozen fixtures in tests/review-isolation.test.ts — including that a
     * create can only ever answer "select" and a saved review only ever
     * "navigate". Here we assert the screen consults it and nothing else. */
    assert.ok(STATE.includes('if (stage === "create") return { kind: "select", month: option.month };'));
    assert.ok(STATE.includes('disabled: stage === "edit" ? true : creating ? o.taken : !o.taken,'));
    assert.ok(!/options\.filter\(\(o\) => !o\.taken\)/.test(STATE), "no month is dropped from the list");
    assert.ok(COMPOSER.includes("const choice = monthChoice(data, month, stage);"));
    assert.ok(COMPOSER.includes('if (choice.kind === "select")'));
    assert.ok(COMPOSER.includes('else if (choice.kind === "navigate") leaveTo(`/reviews/${choice.reviewId}`);'));
    // No third branch: "none" does nothing at all.
    assert.ok(!COMPOSER.includes('choice.kind === "create"'));
  });

  it("12. the default month is the newest untaken one, decided once in the domain", () => {
    const opts = (taken: string[]): ReviewMonthOption[] =>
      ["2026-07", "2026-06", "2026-05"].map((m) => ({ month: m, taken: taken.includes(m) }));
    assert.equal(firstUntakenMonth(opts([])), "2026-07");
    assert.equal(firstUntakenMonth(opts(["2026-07"])), "2026-06");
    assert.equal(firstUntakenMonth(opts(["2026-07", "2026-06", "2026-05"])), null);
    assert.equal(firstUntakenMonth([]), null);
    // The server applies it; the client does not re-derive it.
    assert.ok(SERVICE.includes("review === null ? firstUntakenMonth(options) : review.month"));
    assert.ok(!COMPOSER.includes("firstUntakenMonth"), "the client takes the answer given");
  });

  it("13. all twelve taken means NO create — not a thirteenth month, not an edit", () => {
    assert.ok(COMPOSER.includes("if (creating && data.month.current === null) {"));
    assert.ok(COMPOSER.includes('t("This student already has a review for every month in the window.")'));
    assert.ok(!COMPOSER.includes("shiftMonth") && !COMPOSER.includes("+ 1"),
      "no month is invented");
    // The refusal branch renders the header and a sentence — no form, no save.
    const branch = COMPOSER.slice(
      COMPOSER.indexOf("if (creating && data.month.current === null) {"),
      COMPOSER.indexOf("const previous = previousReviewOf")
    );
    assert.ok(!branch.includes("<form") && !branch.includes("ReviewSkillFields"));
  });

  it("14. the create baseline is ratings at 3, the server's month, and blank prose", () => {
    const values = emptyValues("s1", "2026-07");
    assert.deepEqual(values.skills, Object.fromEntries(SKILL_KEYS.map((k) => [k, 3])));
    assert.equal(values.month, "2026-07");
    assert.equal(values.comment + values.strengths + values.improvements + values.goals + values.parentNotes, "");
    /* THE MONTH IS PART OF THE BASELINE, not a change against it — so opening a
     * create and immediately leaving prompts nothing. It is passed as
     * `defaultValues`, which is possible because the page waits for the read
     * before mounting the form at all.
     *
     * THE SEED ITSELF IS NOW A PURE FUNCTION (`baselineValues`), which is what
     * lets tests/review-isolation.test.ts prove over frozen fixtures that it
     * shares no memory with the cache and that each month gets its own. */
    assert.ok(STATE.includes('return emptyValues(data.student.id, data.month.current ?? "");'));
    assert.ok(COMPOSER.includes("const defaults = useMemo(() => baselineValues(data), [data]);"));
    assert.ok(COMPOSER.includes("defaultValues: defaults,"));
  });

  it("15. Save is the only thing that POSTs — a preview never writes", () => {
    assert.ok(COMPOSER.includes("mutationFn: (body: ReviewCreateBody) => createReview(body)"));
    /* The create client is called from exactly one place: the mutation. Nothing
     * in a render path, an effect or the preview reaches it. */
    assert.equal([...COMPOSER.matchAll(/createReview\(/g)].length, 1);
    assert.ok(COMPOSER.includes("createMutation.mutate(toCreateBody(values))"));
    assert.ok(COMPOSER.includes("const submit = handleSubmit("), "and only behind validation");
    // No effect writes anything.
    assert.ok(!/useEffect\([^)]*\)\s*=>\s*\{[^}]*Mutation\.mutate/.test(COMPOSER));
  });

  it("16. the create body is the eight fields, with an explicit month", () => {
    const body = toCreateBody({
      studentId: "s1", month: "2026-07", skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, 4])),
      comment: "c", strengths: "s", improvements: "i", goals: "g", parentNotes: "p",
    });
    assert.deepEqual(Object.keys(body).sort(), [
      "comment", "goals", "improvements", "month", "parentNotes", "skills", "strengths", "studentId",
    ]);
    assert.equal(body.month, "2026-07");
  });

  it("17. a successful create REPLACES itself with the persisted review's page", () => {
    assert.ok(COMPOSER.includes("router.replace(`/reviews/${saved.id}`)"));
    assert.ok(!COMPOSER.includes("router.push(`/reviews/${saved"),
      "push would leave a create page behind that offers to rewrite the month");
    assert.ok(!/dashboard["'`]\s*\)/.test(COMPOSER), "and never to the Dashboard");
    /* THE BASELINE IS RESET BEFORE THE NAVIGATION, so the page being left is no
     * longer dirty and the guard has nothing to prompt about. */
    const success = COMPOSER.slice(
      COMPOSER.indexOf("onSuccess: (saved) => {"),
      COMPOSER.indexOf("onError: (e: Error) => {")
    );
    assert.ok(success.indexOf("reset(") < success.indexOf("router.replace"));
  });
});

/* =========================================================================
 * 3. Edit
 * ====================================================================== */

describe("Gate 4.4D · Edit", () => {
  it("18. a ghost review is refused with the same answer a missing one gets", () => {
    assert.ok(SERVICE.includes("const loaded = await loadInteractable(reviewId);"),
      "the edit read passes the write's own gate");
    assert.ok(SERVICE.includes('if (!student) return { ok: false, reason: "not_found" };'));
    assert.ok(!/ghost|deleted_student|student_gone/.test(SERVICE),
      "no distinct code may advertise a ghost");
    const route = code(...REPORT_API);
    assert.ok(route.includes("REVIEW_ERROR[res.reason]"), "and the route maps it through the one table");
  });

  it("19. an Archived student's review is still readable and still editable", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function getReviewComposerForReview"),
      SERVICE.indexOf("async function composerFor")
    );
    assert.ok(!fn.includes("canReviewStudent"), "eligibility gates create, and only create");
  });

  it("20. the student and the month are immutable, and not merely undrawn", () => {
    assert.ok(SERVICE.includes("immutable: review !== null,"));
    /* THE GUARANTEE IS `toUpdateBody`, not the screen. It names six fields and
     * no others, so no request this client can make moves a review to another
     * student or another month. */
    const patch = toUpdateBody({
      studentId: "s1", month: "2026-07", skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, 4])),
      comment: "c", strengths: "s", improvements: "i", goals: "g", parentNotes: "p",
    });
    assert.deepEqual(Object.keys(patch).sort(), [...REVIEW_EDITABLE_FIELDS].sort());
    assert.ok(!("studentId" in patch) && !("month" in patch) && !("id" in patch));
    assert.ok(COMPOSER.includes("toUpdateBody(values)"));
    /* AND THE SAVED ROUTE CANNOT SET A MONTH AT ALL. `monthChoice` answers
     * "select" only in create mode, so the one code path that writes the month
     * field is unreachable from a persisted review — proven over fixtures in
     * tests/review-isolation.test.ts, test 20. */
    assert.ok(STATE.includes('if (stage === "edit") return { kind: "none" };'));
    assert.equal([...COMPOSER.matchAll(/setValue\("month"/g)].length, 0,
      "the month is never written into an existing form — a Create month change re-seeds instead");
  });

  it("21. a successful edit stays on the page and returns to View", () => {
    const editBlock = COMPOSER.slice(
      COMPOSER.indexOf("const updateMutation"),
      COMPOSER.indexOf("const saving =")
    );
    assert.ok(editBlock.includes("seed(draftToValues("), "the baseline moves to what was saved");
    assert.ok(editBlock.includes('setStage("view")'), "and the page goes back to reading");
    assert.ok(editBlock.includes('toast(t("Review saved"))'));
    assert.ok(!editBlock.includes("router."), "and nothing navigates");
  });

  it("22. on a saved review the selector navigates, by review id, through the guard", () => {
    assert.ok(COMPOSER.includes("leaveTo(`/reviews/${choice.reviewId}`)"), "guarded, by review id");
    // The service supplies those ids, and supplies months older than the window
    // so a historical correction finds its own month in the list.
    assert.ok(SERVICE.includes("reviewId: own ? own.id : null,"));
    assert.ok(SERVICE.includes("olderMonths"));
    /* THE TRIGGER SHOWS THE LOADED RECORD, NEVER THE DESTINATION — so answering
     * "Keep editing" leaves the selector on the month actually on screen,
     * without anything having to remember to put it back. */
    assert.ok(COMPOSER.includes("const shownMonth = selectedMonth(data, draft.month, stage);"));
    assert.ok(COMPOSER.includes("value={shownMonth}"));
    assert.ok(STATE.includes('return stage === "create" ? draftMonth : data.month.current ?? "";'));
  });
});

/* =========================================================================
 * 4. Unsaved work
 * ====================================================================== */

describe("Gate 4.4D · the dirty guard", () => {
  it("23. every navigation this page initiates goes through ONE function", () => {
    assert.ok(COMPOSER.includes("const leaveTo = (href: string) => {"));
    assert.ok(COMPOSER.includes("if (dirty) setPendingHref(href);"));
    /* Back and the month selector are the two, and neither calls the router
     * directly — guarding one function guards both. */
    assert.ok(COMPOSER.includes('onClick={() => leaveTo("/reviews")}'), "Back is guarded");
    assert.ok(COMPOSER.includes("leaveTo(`/reviews/${choice.reviewId}`)"), "a month switch is guarded");
    const pushes = [...COMPOSER.matchAll(/router\.push\(/g)].length;
    assert.equal(pushes, 2, "one inside leaveTo, one on the confirm — and nowhere else");
  });

  it("23b. VIEW IS NEVER DIRTY, so leaving a page you only read never prompts", () => {
    /* React Hook Form's own flag is deliberately not trusted on its own: a stale
     * `isDirty` must not be able to trap a teacher on a page where nothing can
     * be changed. */
    assert.ok(COMPOSER.includes("const dirty = editable && isDirty;"));
    assert.ok(STATE.includes("export function canBeDirty(stage: ComposerStage): boolean {"));
    // Everything that consults dirtiness consults the derived flag.
    assert.equal([...COMPOSER.matchAll(/\bisDirty\b/g)].length, 2, "declared once, derived once");
  });

  it("23c. Cancel editing is guarded by the same prompt, and navigates nowhere", () => {
    assert.ok(COMPOSER.includes("const requestCancelEdit = () => {"));
    assert.ok(COMPOSER.includes("if (dirty) setPendingCancel(true);"));
    assert.ok(COMPOSER.includes("else returnToView();"), "a pristine cancel returns at once");
    /* Discarding restores the PRISTINE BASELINE — which is the last saved state,
     * not whatever the page was originally loaded with, so cancelling after a
     * save does not resurrect older values. */
    assert.ok(COMPOSER.includes("reset(baselineRef.current);"));
    assert.ok(COMPOSER.includes('setStage("view");'));
    const cancel = COMPOSER.slice(COMPOSER.indexOf("const returnToView = () => {"), COMPOSER.indexOf("const [previewOpen"));
    assert.ok(!cancel.includes("router."), "cancelling an edit is not a navigation");
  });

  it("24. it reuses the app's existing confirm and its existing copy", () => {
    assert.ok(COMPOSER.includes("<ConfirmDialog"), "not a second confirm architecture");
    for (const key of [
      "Discard unsaved changes?",
      "Your changes haven't been saved. If you leave now, they will be lost.",
      "Keep editing", "Discard changes",
    ]) {
      assert.ok(COMPOSER.includes(`t("${key}")`), `${key} must be the shared sentence`);
      assert.ok(key in DICT, `${JSON.stringify(key)} must be translated`);
    }
  });

  it("25. Keep editing only drops the prompt, and neither branch ever saves", () => {
    const dialog = COMPOSER.slice(COMPOSER.indexOf("<ConfirmDialog"));
    assert.ok(dialog.includes("onCancel={() => { setPendingHref(null); setPendingCancel(false); setPendingMonth(null); }}"),
      "Keep editing only drops the prompt — the form beneath is never touched");
    for (const forbidden of ["mutate(", "setValue(", "createReview", "updateReview"]) {
      assert.ok(!dialog.includes(forbidden), `the prompt must not ${forbidden}`);
    }
    /* Discard restores the persisted values through `returnToView`; it does not
     * reach into the form itself, and it saves nothing either way. */
    assert.ok(dialog.includes("if (cancelling) returnToView();"));
    assert.ok(dialog.includes("else if (href) router.push(href);"));
  });

  it("25b. the prompt is a portalled modal layer and takes part in no header layout", () => {
    /* Human verification found the confirmation competing with the header. It is
     * the app's existing centre dialog, which portals itself to <body> at
     * z-index 90/91 — above the composer header's 15 and above the preview
     * overlay's 85 — so Back, Preview and Save all stay reachable underneath and
     * nothing is pushed sideways to make room for it. */
    const DIALOG = code("src", "components", "ui", "dialog.tsx");
    assert.ok(DIALOG.includes("createPortal("), "it renders outside the composer's tree");
    assert.ok(DIALOG.includes("zIndex: 90") && DIALOG.includes("zIndex: 91"));
    assert.match(CSS, /\.rvc-head\{[^}]*z-index:15/);
    assert.match(CSS, /\.review-overlay\{[\s\S]*?z-index:85/);
    // The composer renders it as a sibling of the page, not inside the header.
    const head = COMPOSER.slice(COMPOSER.indexOf("const header = ("), COMPOSER.indexOf("if (creating &&"));
    assert.ok(!head.includes("ConfirmDialog"), "the header holds no dialog");
  });

  it("26. the browser prompt is armed ONLY while there is something to lose", () => {
    assert.ok(COMPOSER.includes("if (!dirty) return;"), "no listener on a pristine form, or in View");
    assert.ok(COMPOSER.includes('window.addEventListener("beforeunload", onBeforeUnload)'));
    assert.ok(COMPOSER.includes('window.removeEventListener("beforeunload", onBeforeUnload)'),
      "and it is removed when the form goes clean");
    // The browser owns that dialog's wording; nothing tries to replace it.
    assert.ok(!/returnValue\s*=\s*["'`].+["'`]/.test(COMPOSER.replace('e.returnValue = "";', "")),
      "no custom unload text");
  });

  it("27. no global route interception exists", () => {
    for (const forbidden of [
      "router.events", "beforePopState", "history.pushState", "popstate",
      "next/navigation.push =", "monkeyPatch",
    ]) {
      assert.ok(!COMPOSER.includes(forbidden), `${forbidden} is a brittle interception hack`);
    }
  });

  it("28. the preview neither saves nor disturbs the form", () => {
    const overlay = COMPOSER.slice(COMPOSER.indexOf("function PreviewOverlay"));
    for (const forbidden of ["mutate(", "createReview", "updateReview", "setValue(", "reset(", "<form"]) {
      assert.ok(!overlay.includes(forbidden), `the preview overlay must not ${forbidden}`);
    }
    /* CLOSING RETURNS TO THE EXACT UNSAVED STATE, because the form is never
     * unmounted: the overlay is rendered BESIDE it, gated on a boolean, not in
     * place of it. */
    assert.match(COMPOSER, /\{previewOpen && \(\s*<PreviewOverlay report=\{report\} onClose=\{\(\) => setPreviewOpen\(false\)\} actions=\{reportActions\} \/>/);
  });
});

/* =========================================================================
 * 5. Navigation into the composer
 * ====================================================================== */

describe("Gate 4.4D · the flows that reach it", () => {
  it("29. the Reviews index writes through the dedicated Create route", () => {
    assert.ok(INDEX.includes("href={`/reviews/new?studentId=${encodeURIComponent(c.studentId)}`}"));
  });

  it("30. the Student Profile writes through the same route, and edits by review id", () => {
    assert.ok(TAB.includes("href={`/reviews/new?studentId=${encodeURIComponent(student.id)}`}"));
    assert.ok(TAB.includes("href={`/reviews/${encodeURIComponent(r.id)}`}"));
  });

  it("31. View performance still goes to the profile's Reviews tab", () => {
    assert.ok(INDEX.includes("href={`/students/${c.studentId}?tab=Reviews`}"));
  });

  it("32. no link points anywhere that does not exist", () => {
    const hrefs = new Set<string>();
    for (const src of [INDEX, TAB, COMPOSER, STATES]) {
      for (const m of src.matchAll(/href=\{?["'`]([^"'`$]*)/g)) hrefs.add(m[1]);
      for (const m of src.matchAll(/href=\{`([^`$]*)/g)) hrefs.add(m[1]);
    }
    for (const href of hrefs) {
      if (href === "" || !href.startsWith("/")) continue;
      const first = href.split("?")[0].replace(/\/$/, "");
      const segments = first.split("/").filter(Boolean);
      // Every static prefix must resolve to a real route folder.
      assert.ok(
        has("src", "app", "(app)", ...segments, "page.tsx")
        || has("src", "app", "(app)", segments[0], "page.tsx"),
        `dead link: ${href}`
      );
    }
  });

  it("33. the Review Drawer has no consumer left in any Reviews user flow", () => {
    for (const [name, src] of [
      ["reviews/page.tsx", INDEX],
      ["student-reviews.tsx", TAB],
      ["review-composer.tsx", COMPOSER],
      ["reviews/new/page.tsx", CREATE_PAGE],
      ["reviews/[reviewId]/page.tsx", EDIT_PAGE],
    ] as const) {
      assert.ok(!src.includes("ReviewDrawer"), `${name} must not open the drawer`);
    }
    /* AND IN 4.4E IT WAS DELETED. 4.4D kept it unrouted on purpose — removing a
     * working component in the same gate that replaces it would have put two
     * risks in one change — and this gate, with the composer verified in a
     * browser, finished the job. Nothing in src/ imported it by then. */
    assert.ok(!has("src", "components", "reviews", "review-drawer.tsx"), "and is now gone");
    const importers = ["src/app/(app)/reviews/page.tsx", "src/components/reviews/student-reviews.tsx"];
    for (const f of importers) {
      assert.ok(!readFileSync(path.join(process.cwd(), f), "utf8").includes("review-drawer"), f);
    }
  });

  it("34. and there is ONE Review form, over the shared fields", () => {
    assert.ok(COMPOSER.includes("ReviewSkillFields") && COMPOSER.includes("ReviewProseFields"));
    assert.equal([...FIELDS.matchAll(/<textarea/g)].length, 5, "five prose boxes exist once");
    /* The shared field family survived the drawer's removal — it was extracted
     * in 4.4D precisely so the two forms could not drift, and it is now simply
     * the composer's. Nothing else in Reviews renders a rating or a prose box. */
    const others = ["student-reviews.tsx", "monthly-review-report.tsx", "reviews-ui.ts"];
    for (const f of others) {
      const src = code("src", "components", "reviews", f);
      assert.ok(!src.includes("<textarea"), `${f} renders no prose box of its own`);
    }
  });
});

/* =========================================================================
 * 6. The read API
 * ====================================================================== */

describe("Gate 4.4D · the composer reads", () => {
  it("35. both reads are authenticated", () => {
    for (const [name, parts] of [["composer", COMPOSER_API], ["report", REPORT_API]] as const) {
      const src = code(...parts);
      assert.ok(src.includes("await requireSession();"), `${name} must require a session`);
      assert.ok(src.includes('export const runtime = "nodejs";'), name);
    }
  });

  it("36. both are read-only, and neither writes anything", () => {
    for (const [name, parts] of [["composer", COMPOSER_API], ["report", REPORT_API]] as const) {
      const src = code(...parts);
      for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
        assert.ok(!src.includes(`export async function ${verb}`), `${name} must expose no ${verb}`);
      }
    }
    /* The service's composer path performs no write verb of any kind, and does
     * not reach the Dashboard, a lifecycle or a reconciler. */
    const fn = SERVICE.slice(
      SERVICE.indexOf("async function composerFor"),
      SERVICE.indexOf("export async function createReview")
    );
    for (const forbidden of [
      "updateOne", "create(", "deleteOne", "insert", "save(", "bulkWrite",
      "dashboard", "lifecycle", "reconcile",
    ]) {
      assert.ok(!fn.includes(forbidden), `composerFor must not ${forbidden}`);
    }
  });

  it("37. there is still no generic GET on /api/reviews/[id]", () => {
    const byId = code("src", "app", "api", "reviews", "[id]", "route.ts");
    assert.ok(!byId.includes("export async function GET"));
    assert.ok(!API.includes("fetchReview("), "and no client for one");
  });

  it("38. the composer payload is fetched once and covers every month it offers", () => {
    /* ONE ROUND TRIP. The metrics for every offered month ride along, so
     * changing the month changes Attendance and Homework without a request —
     * and so the client never has a reason to fetch per month. */
    assert.ok(SERVICE.includes("const metrics = await studentMonthMetrics(student.id, monthKeys);"));
    assert.equal([...SERVICE.matchAll(/studentMonthMetrics\(/g)].length, 3,
      "declared once, called by the profile read and by the composer read");
    assert.equal([...COMPOSER.matchAll(/useQuery\(/g)].length, 0, "the composer fetches nothing itself");
    for (const [name, src] of [["new", CREATE_PAGE], ["[reviewId]", EDIT_PAGE]] as const) {
      assert.equal([...src.matchAll(/useQuery\(/g)].length, 1, `${name} makes exactly one read`);
    }
  });

  it("39. the composer caches live under the Reviews key, so one invalidation covers them", () => {
    assert.ok(API.includes('composerForStudent: (studentId: string) => ["reviews", "composer", "student", studentId]'));
    assert.ok(API.includes('composerForReview: (reviewId: string) => ["reviews", "composer", "review", reviewId]'));
    assert.ok(COMPOSER.includes("qc.invalidateQueries({ queryKey: reviewKeys.all });"));
  });

  it("40. the client imports the service's TYPES only, never its runtime", () => {
    for (const [name, src] of [
      ["review-composer.tsx", COMPOSER], ["monthly-review-report.tsx", REPORT_VIEW],
      ["new/page.tsx", CREATE_PAGE], ["[reviewId]/page.tsx", EDIT_PAGE],
      ["review-form-fields.tsx", FIELDS], ["composer-states.tsx", STATES],
    ] as const) {
      for (const forbidden of ["ReviewModel", "StudentModel", "mongoose", "dbConnect", "server-only"]) {
        assert.ok(!src.includes(forbidden), `${name} must not reference ${forbidden}`);
      }
    }
  });
});

/* =========================================================================
 * 7. Scope — what 4.4D did NOT ship
 * ====================================================================== */

describe("Gate 4.4D stays inside its phase", () => {
  it("41. Print and Export PDF ship in 4.4E — and only from the composer", () => {
    /* 4.4D asserted the OPPOSITE: that no Print or Export control existed, so
     * neither could ship as a dead button ahead of the gate that built it. 4.4E
     * built it, so this inverts — and stays narrow, because the report itself
     * must still hold no control of any kind. */
    assert.ok(COMPOSER.includes('t("Print")'));
    assert.ok(COMPOSER.includes('t(exporting ? "Exporting…" : "Export PDF")'),
      "the export label states which of the two things is happening");
    assert.ok(COMPOSER.includes("printReportOverlay"), "and the composer owns the print route");
    for (const key of ["Print", "Export PDF", "Exporting…"]) {
      assert.ok(key in DICT, `${key} must be translated`);
    }
    for (const [name, src] of [
      ["monthly-review-report.tsx", REPORT_VIEW], ["composer-states.tsx", STATES],
    ] as const) {
      for (const forbidden of ["window.print", "jspdf", 't("Print")', 't("Export PDF")']) {
        assert.ok(!src.includes(forbidden), `${name} must not ship ${forbidden}`);
      }
    }
    /* THE DOCUMENT ITSELF STAYS INERT. It is printed untouched, so a control
     * inside it would end up on the paper — the report has no button, link or
     * input, and that is what lets the print stylesheet unwrap it as-is. */
    for (const forbidden of ["<button", "<a ", "<input", "onClick"]) {
      assert.ok(!REPORT_VIEW.includes(forbidden), `the report must contain no ${forbidden}`);
    }
    /* NO DEAD CONTROL ANYWHERE. Both actions work in all three stages; nothing
     * is drawn disabled-with-a-promise. */
    assert.ok(!/Coming soon/.test(COMPOSER));
    // And no rasterizing capture library was added to get here — see review-pdf.ts.
    assert.ok(!raw("package.json").includes("html2canvas"));
  });

  it("42. the header keeps its actions region for 4.4E, and labels each stage", () => {
    assert.ok(COMPOSER.includes("t(primaryActionKey(stage))"));
    assert.ok(STATE.includes('return stage === "create" ? "Save review" : stage === "view" ? "Edit review" : "Save changes";'));
    assert.ok(COMPOSER.includes('t("Preview")'), "and the responsive Preview control");
    for (const key of ["Preview", "Edit review", "Cancel editing"]) {
      assert.ok(key in DICT, `${key} must be translated`);
    }
  });

  it("43. no Review persistence changed — the two write clients are untouched", () => {
    assert.ok(API.includes('const res = await fetch("/api/reviews", {'));
    assert.ok(API.includes("method: \"POST\","));
    assert.ok(API.includes("method: \"PATCH\","));
    const create = code("src", "app", "api", "reviews", "route.ts");
    assert.ok(create.includes("reviewCreateSchema.safeParse(body)"));
    const patch = code("src", "app", "api", "reviews", "[id]", "route.ts");
    assert.ok(patch.includes("reviewUpdateSchema.safeParse(body)"));
  });

  it("44. the index is declared in models.ts alone, and no DDL is issued", () => {
    /* WAS "no index is declared". Gate 5.1 created the (studentId, month) unique
     * index in production and Gate 5.2 declared it; its exact spec is pinned in
     * tests/reviews-service.test.ts (65, 65a-e). What this test still guards is
     * the composer's side of it: the UI, the report view and the service issue no
     * DDL of their own and know nothing about indexes. */
    const models = code("src", "lib", "models.ts");
    assert.ok(models.includes("ReviewSchema.index"), "declared where the schemas live");
    for (const src of [SERVICE, COMPOSER, REPORT_VIEW]) {
      assert.ok(!/createIndex|\.index\(|dropIndex/.test(src));
    }
  });

  it("45. the report is never persisted — no model gains a field", () => {
    const models = code("src", "lib", "models.ts");
    for (const forbidden of ["generatedOn", "report", "publishedOn", "average:"]) {
      assert.ok(!models.includes(forbidden), `the Review schema must not gain ${forbidden}`);
    }
    assert.ok(!SERVICE.includes("generatedOn:"), "and nothing writes one");
  });
});

/* =========================================================================
 * 9. View / Edit — a saved review is read first, and edited deliberately
 *
 * The stage rules themselves are pure and are exercised over fixtures in
 * tests/review-isolation.test.ts. What is asserted here is that the SCREEN is
 * wired to them: that View renders no save, that the fields are genuinely
 * read-only rather than merely styled that way, and that a save returns to
 * reading.
 * ====================================================================== */

describe("Gate 4.4D remediation · View and Edit", () => {
  it("53. a saved review opens in View, and Create is editable at once", () => {
    assert.ok(COMPOSER.includes("useState<ComposerStage>(() => initialStage(data.mode))"));
    assert.ok(STATE.includes('return mode === "create" ? "create" : "view";'));
    // The route decides nothing about it — there is no /edit address.
    assert.ok(!has("src", "app", "(app)", "reviews", "[reviewId]", "edit"));
  });

  it("54. View shows NO save button, and Edit is what replaces it", () => {
    /* The primary action is one element whose label and behaviour come from the
     * stage, so "Save changes" cannot appear where nothing can be saved: in View
     * the button enters Edit instead of submitting. */
    assert.ok(COMPOSER.includes('const primaryActionFor = (surface: "desktop" | "mobile") => {'));
    assert.ok(COMPOSER.includes('return stage === "view" ? ('));
    assert.ok(COMPOSER.includes('onClick={() => setStage("edit")}'));
    assert.ok(COMPOSER.includes("t(primaryActionKey(stage))"));
    assert.ok(!COMPOSER.includes('t("Save changes")'), "the label is never hard-coded past the stage");
    /* ONE DEFINITION FOR BOTH REGIONS. The header region and the phone's sticky
     * bar both render it, so the two cannot drift about what the stage's action
     * is called or what pressing it does — and only ever one region is on screen
     * (see the ownership suite at the end of this file). */
    assert.equal(COMPOSER.split("primaryActionFor(surface)").length - 1, 1,
      "the shared builder places it; neither region reaches past it");
    assert.equal(COMPOSER.split("onClick={submit}").length - 1, 1,
      "one submitting button in the whole file, rendered into whichever region is showing");
    // Cancel editing exists only in Edit, in one place, through one handler.
    assert.ok(COMPOSER.includes('{stage === "edit" && cancelEditBtn(surface)}'));
    assert.ok(COMPOSER.includes('t("Cancel editing")'));
  });

  it("55. the fields are genuinely read-only in View, not merely styled so", () => {
    /* A read-only rating a keyboard could still move would be a control that
     * lies about itself, so the buttons are disabled and the whole group leaves
     * the tab order. The textareas carry the real attribute. */
    assert.ok(COMPOSER.includes("readOnly={!editable}"), "both field groups are told");
    assert.equal([...COMPOSER.matchAll(/readOnly=\{!editable\}/g)].length, 2);
    assert.ok(FIELDS.includes("disabled={readOnly}"));
    assert.ok(FIELDS.includes("tabIndex={readOnly ? -1 : active ? 0 : -1}"));
    assert.ok(FIELDS.includes("aria-readonly={readOnly || undefined}"));
    assert.ok(FIELDS.includes("readOnly={readOnly}"), "and the textareas too");
    assert.equal([...FIELDS.matchAll(/readOnly=\{readOnly\}/g)].length, 5, "all five prose boxes");
    // Both handlers refuse as well, so a synthetic event changes nothing either.
    assert.equal([...FIELDS.matchAll(/if \(readOnly\) return;/g)].length, 2);
  });

  it("56. a saved edit returns to View, so no Save remains until Edit is pressed again", () => {
    const editBlock = COMPOSER.slice(
      COMPOSER.indexOf("const updateMutation"),
      COMPOSER.indexOf("const saving =")
    );
    assert.ok(editBlock.includes('setStage("view")'));
    assert.ok(editBlock.includes("seed(draftToValues("), "and the baseline is what was written");
  });

  it("57. a successful create lands on the persisted route, which opens in View", () => {
    assert.ok(COMPOSER.includes("router.replace(`/reviews/${saved.id}`)"));
    /* The destination mounts fresh with `mode: "edit"` from the server, and
     * `initialStage` turns that into View — so the teacher plainly sees that
     * their review is now saved rather than being dropped back into a form. */
    assert.ok(STATE.includes('return mode === "create" ? "create" : "view";'));
    assert.ok(EDIT_PAGE.includes("<ReviewComposer key={reviewId} data={data} />"));
  });

  it("58. the report preview is shown at every stage, and never gated on Edit", () => {
    /* Gate 4.4E's Print and PDF attach to View, so the report must not be
     * something only an editor can see. It is rendered from `report`, which is
     * built the same way in all three stages. */
    const split = COMPOSER.slice(COMPOSER.indexOf('<div className="rvc-split">'));
    assert.ok(split.includes("<MonthlyReviewReportView report={report} />"));
    assert.ok(!/stage === "(view|edit)"[^\n]*MonthlyReviewReportView/.test(COMPOSER),
      "the preview is not conditional on a stage");
  });
});

/* =========================================================================
 * 10. The responsive header and the mobile action hierarchy
 * ====================================================================== */

describe("Gate 4.4D remediation · the header", () => {
  it("59. the identity is the flexible child; Back and the actions are fixed", () => {
    /* Human verification found the student's name squeezed to nothing as the
     * window narrowed, because all three were competing for one line. */
    assert.match(CSS, /\.rvc-head-id\{display:flex;align-items:center;gap:11px;flex:1;min-width:0\}/);
    assert.match(CSS, /\.rvc-head-actions\{display:flex;align-items:center;gap:8px;flex:none\}/);
    assert.ok(CSS.includes(".rvc-id-name{"));
    assert.ok(/\.rvc-id-name\{[^}]*text-overflow:ellipsis/.test(CSS), "and it truncates rather than pushing");
  });

  it("60. the tablet band keeps the name and sheds the secondary context", () => {
    const tablet = mediaBlock("(max-width:1099px)", ".rvc-id-grade");
    assert.ok(tablet.includes(".rvc-id-grade{font-size:11.5px;opacity:.85}"),
      "the least load-bearing thing in the row is what gives way");
    assert.ok(!tablet.includes(".rvc-id-name{display:none"), "the name never goes");
  });

  it("61. the phone gives the identity its own row, keeping the avatar and a gap", () => {
    /* 621–767 ONLY. Below 620 the avatar is dropped and the row holds Back and
     * Preview alone — see the remediation suite at the end of this file. */
    /* THE REMEDIATION SPLIT THIS INTO TWO BANDS. Below 768 the identity gets a
     * row of its own, so the avatar no longer competes with Back and the actions
     * for width and can keep a real gap — human verification found the two
     * packed against each other. Only at the NARROWEST band is the avatar
     * dropped; see test 70. */
    const phone = mediaBlock("(max-width:767px)", ".rvc-head-id");
    assert.ok(phone.length > 0, "the header changes shape at 768, not at 620");
    assert.ok(phone.includes(".rvc-head-id{"), "the identity moves");
    assert.ok(phone.includes("flex:1 0 100%"), "onto a row of its own");
    assert.ok(phone.includes("gap:10px;"), "and keeps the app's own identity gap");
    assert.ok(!phone.includes(".rvc-head-id>*:first-child{display:none}"),
      "the avatar survives this band — it is only dropped at the narrowest");
    assert.ok(!phone.includes(".rvc-id-name{display:none"), "and the name never goes at all");
    /* One context line at a time: the month replaces the grade, because on a
     * phone which month this is matters more than which school. */
    assert.ok(phone.includes(".rvc-id-grade{display:none}"));
    assert.ok(phone.includes(".rvc-id-period{display:block}"));
    assert.ok(CSS.includes(".rvc-id-period{display:none}"), "and the other way up above");
  });

  it("62. Back sheds its label below 768; PREVIEW KEEPS ITS WORDS", () => {
    /* A back chevron reads on its own. An eye does not: below 1100 the report is
     * the one thing on this screen a teacher cannot see, and an unlabelled icon
     * asks them to guess which control opens it. Preview is therefore icon +
     * label at every width where it exists at all. */
    const phone = mediaBlock("(max-width:767px)", ".rvc-btn-label");
    assert.ok(phone.includes(".rvc-back .rvc-btn-label{display:none}"), "Back becomes its icon");
    assert.ok(phone.includes(".rvc-back{padding:0 10px !important}"));
    assert.ok(!phone.includes(".rvc-preview-btn .rvc-btn-label"), "Preview's label is never hidden");
    assert.ok(!/\.rvc-preview-btn[^{]*\{[^}]*padding/.test(CSS),
      "and it keeps ghostBtn's own padding rather than the icon-only squeeze");
    // Both keep an accessible name whether or not the label is visible.
    assert.ok(COMPOSER.includes('aria-label={t("Close")}'));
    assert.ok(COMPOSER.includes('aria-label={t("Preview")}'));
    // The row's own 36px height is untouched, so nothing shrinks below a target.
    assert.ok(!phone.includes(".rvc-back{height"));
    assert.ok(!phone.includes(".rvc-preview-btn{height"));
  });

  it("63. the 621–767 band shapes the header row and decides no ownership", () => {
    /* THIS BAND USED TO SPLIT OWNERSHIP: it hid the header's save per stage and
     * switched the bar on for two of the three, so "header action gone, footer
     * missing" and "both showing" were both reachable widths. Both rules were
     * also inert in the browser. Ownership now changes at one line only — 620 —
     * and this block is layout, not visibility. */
    const phone = mediaBlock("(max-width:767px)", ".rvc-head-id");
    assert.ok(!phone.includes("rvc-actions-desktop"), "no action region is switched here");
    assert.ok(!phone.includes("rvc-actions-mobile"));
    assert.ok(!/rvc-head-action(?!s)|rvc-save|rvc-actionbar/.test(phone),
      "and the per-button hiding that never won is gone");
    // What it DOES do: two rows, icon-only navigation, the month as context.
    assert.ok(phone.includes(".rvc-head-nav{flex-wrap:wrap;gap:8px}"));
    assert.ok(phone.includes("flex:1 0 100%"), "the identity takes a row of its own");
    assert.ok(phone.includes(".rvc-back .rvc-btn-label{display:none}"));
    // The composer still publishes the stage, which the editor's rules key on.
    assert.ok(COMPOSER.includes('<div className="rvc" data-stage={stage}>'));
    assert.ok(COMPOSER.includes("height: 44"), "and the mobile action keeps a thumb-sized target");
  });
});

/* =========================================================================
 * 11. The month selector's three jobs, and the Preview action's two
 * ====================================================================== */

describe("Gate 4.4D final remediation", () => {
  it("64. Preview is ABSENT on desktop, where the report is already on screen", () => {
    /* A Preview button beside a report that is permanently visible in the right
     * pane is a control that does nothing a teacher can perceive. It exists only
     * where the report is not continuously visible. */
    assert.match(CSS, /@media \(min-width:1100px\)\{[\s\S]*?\.rvc-preview-btn\{display:none !important\}/);
    // Stated as its own min-width query, so neither shape depends on source order.
    assert.match(CSS, /@media \(min-width:1100px\)\{[\s\S]*?\.rvc-preview\{[\s\S]*?position:sticky/);
  });

  it("65. Preview is PRESENT below 1100, where it is the only way to the report", () => {
    /* Below 1100 the report is stacked under a long form; below 620 it is out of
     * the document entirely. The control is rendered unconditionally and the
     * stylesheet removes it above the breakpoint — there is no width test in the
     * component, so the two can never disagree about when it exists. */
    assert.ok(COMPOSER.includes('className="btn-ghost rvc-preview-btn"'));
    assert.ok(!/useMediaQuery|matchMedia|innerWidth/.test(COMPOSER),
      "the breakpoint is the stylesheet's, not a second one in JavaScript");
    const btn = CSS.split(".rvc-preview-btn{display:none !important}");
    assert.equal(btn.length, 2, "hidden in exactly one place — the desktop query");
    assert.ok(COMPOSER.includes("setPreviewOpen(true)"));
    assert.ok("Preview" in DICT);
  });

  it("65b. Preview is icon + label at every width where it exists", () => {
    /* THE APPROVED TWEAK. It used to collapse to a bare eye below 768, which
     * asked a teacher to guess which icon opens the report they cannot see.
     * Resolved per width — the only rules that touch this control are the
     * 1100 hide and the 767 label rules, so the whole matrix is decidable. */
    const hidden = (w: number) => w >= 1100;
    const labelled = (w: number) => !hidden(w);
    for (const w of [375, 620, 621, 768, 860]) {
      assert.equal(hidden(w), false, `${w}px shows Preview`);
      assert.equal(labelled(w), true, `${w}px shows its label`);
    }
    assert.equal(hidden(1100), true, "1100px has the report on screen instead");

    // What makes that matrix true: one hide rule, and no rule hiding the label.
    assert.match(CSS, /@media \(min-width:1100px\)\{[\s\S]*?\.rvc-preview-btn\{display:none !important\}/);
    assert.ok(!/\.rvc-preview-btn[^{]*\.rvc-btn-label/.test(CSS), "nothing strips the word");
    // Icon AND label, in that order, inside one ghost button. Never a primary.
    assert.match(COMPOSER, /className="btn-ghost rvc-preview-btn"[\s\S]{0,120}\{iconEye\}\s*<span className="rvc-btn-label">\{t\("Preview"\)\}<\/span>/);
    assert.ok(!COMPOSER.includes("btn-primary rvc-preview-btn"), "it is secondary, always");
    // Rendered once in the whole file — no second copy travels to the footer.
    assert.equal(COMPOSER.split("rvc-preview-btn").length - 1, 1);
    assert.equal(COMPOSER.split("const previewBtn").length - 1, 1);
    assert.equal(DICT["Preview"], "Xem trước");
  });

  it("66. the Edit stage disables the month trigger — no dropdown of destinations", () => {
    assert.ok(COMPOSER.includes("const monthEnabled = monthSelectorEnabled(stage);"));
    assert.ok(COMPOSER.includes("disabled={!monthEnabled}"));
    assert.ok(STATE.includes('return stage !== "edit";'));
    /* The field stays visible and keeps its value — the month is ownership
     * context, not a thing to hide — and says why it cannot be changed. */
    assert.ok(COMPOSER.includes('t("A review\'s month is fixed when it is created.")'));
    assert.ok("A review's month is fixed when it is created." in DICT);
    // The shared Select genuinely refuses to open, rather than being styled shut.
    const SELECT = code("src", "components", "ui", "select.tsx");
    assert.ok(SELECT.includes("disabled={disabled}"), "the trigger is a disabled button");
    assert.ok(SELECT.includes("onClick={() => { if (!disabled) setOpen((o) => !o); }}"));
    assert.ok(SELECT.includes("{open && !disabled && ("), "and the listbox cannot render");
    // Optional and false by default, so no existing Select consumer changes.
    assert.ok(SELECT.includes("disabled = false,"));
  });

  it("67. a Create month change RE-SEEDS rather than carrying the draft across", () => {
    /* The earlier behaviour — keep the ratings and words, move only the month —
     * read as though a review were being copied into a month nobody had written.
     * Each Create month is an independent draft now. */
    assert.ok(COMPOSER.includes("const startMonth = (month: string) => {"));
    assert.ok(COMPOSER.includes("seed(emptyValues(data.student.id, month));"));
    assert.ok(COMPOSER.includes("const requestMonth = (month: string) => {"));
    assert.ok(COMPOSER.includes("if (dirty) setPendingMonth(month);"), "dirty asks first");
    assert.ok(COMPOSER.includes("else startMonth(month);"), "pristine switches at once");
    /* AND THE RESET BECOMES THE NEW BASELINE — `seed` sets both — so switching
     * month and immediately leaving prompts nothing. */
    assert.ok(COMPOSER.includes("baselineRef.current = values;"));
    // No per-month stash of any kind.
    assert.ok(!/draftsByMonth|monthDrafts|cacheDraft/.test(COMPOSER));
  });

  it("68. all three things that can cost unsaved work ask the same question", () => {
    assert.ok(COMPOSER.includes("const confirming = pendingHref !== null || pendingCancel || pendingMonth !== null;"));
    /* One dialog, one sentence, three branches — and every branch clears all
     * three pending flags, so a decision can never leave one standing. */
    assert.ok(COMPOSER.includes("if (cancelling) returnToView();"));
    assert.ok(COMPOSER.includes("else if (month) startMonth(month);"));
    assert.ok(COMPOSER.includes("else if (href) router.push(href);"));
    assert.ok(COMPOSER.includes("onCancel={() => { setPendingHref(null); setPendingCancel(false); setPendingMonth(null); }}"));
    assert.equal([...COMPOSER.matchAll(/<ConfirmDialog/g)].length, 1, "one prompt, not three");
  });

  it("69. the month field fills the form on a phone, and is capped only when roomy", () => {
    assert.ok(COMPOSER.includes('<div className="rvc-month">'));
    assert.ok(CSS.includes(".rvc-month{max-width:320px;min-width:0}"));
    const phone = mediaBlock("(max-width:620px)", ".rvc-month");
    assert.ok(phone.includes(".rvc-month{max-width:none}"),
      "a 320px cap inside a 347px column reads as a control that failed to lay out");
    /* The Select's own trigger is width:100% of this wrapper and its listbox is
     * pinned left:0/right:0 against it, so both follow the wrapper rather than
     * needing a rule of their own. */
    const SELECT = code("src", "components", "ui", "select.tsx");
    assert.ok(SELECT.includes('width: "100%", height, padding: "0 11px"'));
    assert.ok(SELECT.includes('position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0'));
    // And the long localized labels have somewhere to go rather than forcing width.
    assert.ok(SELECT.includes('overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"'));
  });

  it("70. the identity keeps a real gap, and the avatar is what the narrowest width pays", () => {
    /* Human verification found the avatar and the name packed together. The
     * identity has its own row below 768 and a 10px gap there — the gap this app
     * uses everywhere else at this size — and the avatar is dropped only at the
     * narrowest band, where keeping it is what would crush the name. */
    /* BOUNDED AT THE NEXT MEDIA QUERY. Slicing to the end of the file would run
     * straight into the 620px block and read its avatar rule as though it
     * belonged to this band — which is how this assertion first passed while
     * proving the opposite of what it claimed. */
    const mid = mediaBlock("(max-width:767px)", ".rvc-head-id");
    assert.ok(mid.includes("gap:10px;"), "a real gap once the identity has its own row");
    assert.ok(!mid.includes("rvc-student-avatar"), "the avatar survives this band");

    /* AND IS DROPPED AT THE NARROWEST, BY NAME AND WITH !important — the disc's
     * own inline display:flex beats a plain rule, which is why the previous
     * structural selector matched it and left it on screen anyway. Test 75
     * holds the full cascade argument. */
    const phone = mediaBlock("(max-width:620px)", ".rvc-student-avatar");
    assert.ok(phone.includes(".rvc-student-avatar{display:none !important}"),
      "in favour of the name");
    assert.ok(!phone.includes(".rvc-id-name{display:none"), "the name is never what goes");

    // The text column is the flexible child, so the name ellipsis rather than
    // pushing the row wider than the viewport.
    assert.ok(CSS.includes(".rvc-id-text{flex:1;min-width:0}"));
    assert.ok(COMPOSER.includes('<div className="rvc-id-text">'));
    // Nothing shrank a touch target to buy the room.
    assert.ok(!/\.rvc-back\{height|\.rvc-preview-btn\{height/.test(CSS));
  });
});

/* =========================================================================
 * 8. Responsive shape
 * ====================================================================== */

describe("Gate 4.4D · the responsive contract", () => {
  it("46. the desktop split is a two-track grid with no intrinsic floor", () => {
    assert.match(CSS, /\.rvc-split\{display:grid;grid-template-columns:minmax\(400px,2fr\) minmax\(0,3fr\)/);
    /* THE PREVIEW IS THE DOMINANT TRACK — it holds an A4 document, and the
     * editor's form has a natural width of its own. The editor's `minmax` floor
     * is what stops the ratio from squeezing the rating controls; the preview's
     * `minmax(0,...)` is what stops a wide child — an A4 sheet, a long student
     * name — from pushing the page sideways. Both are asserted in the workspace
     * suite at the end of this file. */
    assert.ok(CSS.includes(".rvc-editor{min-width:0"));
    assert.ok(CSS.includes(".rvc-preview{min-width:0"));
  });

  it("47. the preview sticks below BOTH headers, and scrolls inside itself", () => {
    /* The app header is 60px and sticky (z-index 20); the composer's own header
     * sticks beneath it at 60 and below it at 15. The preview therefore starts
     * at 120 and is capped so a long report scrolls in place rather than
     * escaping the viewport. */
    assert.ok(CSS.includes(".rvc-head{\n  position:sticky;top:60px;z-index:15;")
      || /\.rvc-head\{[^}]*position:sticky;top:60px;z-index:15/.test(CSS));
    assert.match(CSS, /@media \(min-width:1100px\)\{[\s\S]*?\.rvc-preview\{[\s\S]*?position:sticky;top:120px;/);
    assert.match(CSS, /max-height:calc\(100vh - 140px\);overflow-y:auto;/);
  });

  it("48. the tablet band is ONE column — never a squeezed side-by-side report", () => {
    const tablet = mediaBlock("(max-width:1099px)", ".rvc-split");
    assert.ok(tablet.includes(".rvc-split{grid-template-columns:minmax(0,1fr)}"));
    assert.ok(tablet.includes(".rvc-preview{position:static"), "and the preview stops sticking");
    // No second tab system was introduced to get there.
    assert.ok(!COMPOSER.includes("role=\"tablist\"") && !COMPOSER.includes("aria-selected"));
  });

  it("49. the phone removes the inline preview and opens the overlay instead", () => {
    /* Matched as a BLOCK rather than by slicing from a literal offset: the
     * stylesheet is CRLF on this platform, so an anchor containing a bare \n
     * silently finds nothing and the assertion passes on an empty string. */
    const phone = mediaBlock("(max-width:620px)", ".rvc-preview");
    assert.ok(phone.length > 0, "the phone block exists");
    assert.ok(phone.includes(".rvc-preview{display:none !important}"),
      "an A4 sheet in a 375px column is horizontal overflow waiting to happen");
    // The overlay is the comp's own surface, which the print rules already know.
    assert.ok(CSS.includes(".review-overlay{"));
    assert.ok(COMPOSER.includes('className="review-overlay"'));
    assert.ok(COMPOSER.includes('<div className="report-body">'));
    assert.ok(COMPOSER.includes('<div className="report-scroll">'));
  });

  it("50. the Preview control exists only where the report is not already on screen", () => {
    assert.ok(COMPOSER.includes('className="btn-ghost rvc-preview-btn"'));
    assert.match(CSS, /@media \(min-width:1100px\)\{[\s\S]*?\.rvc-preview-btn\{display:none !important\}/);
  });

  it("51. the page's bleed mirrors .app-main's padding at every breakpoint", () => {
    /* The composer runs edge to edge inside the content column, so its negative
     * margins have to equal the padding they are cancelling — at all three
     * widths, or the page gains a horizontal scrollbar at one of them. */
    const pads = [...CSS.matchAll(/\.app-main\{padding:(\d+)px (\d+)px (\d+)px/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const bleeds = [...CSS.matchAll(/\.rvc\{margin:-(\d+)px -(\d+)px -(\d+)px/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    // The desktop padding is inline on <main>, so it is asserted directly.
    assert.deepEqual(bleeds[0], [28, 32, 48]);
    const shell = code("src", "components", "shell", "app-shell.tsx");
    assert.ok(shell.includes('padding: "28px 32px 48px"'), "which is the shell's own");
    assert.deepEqual(bleeds.slice(1), pads, "and every override matches its media block");
  });

  it("52. the sheet is light-locked, so it reads the same under any theme", () => {
    /* The radar and the performance colours are written against the app's
     * tokens, which under a dark theme resolve to values invisible on white. The
     * SHEET redeclares them, so every component inside gets the document palette
     * without any of them learning about a "document mode". */
    assert.match(CSS, /\.report-sheet\{\s*--bg:#f7f7f8;--card:#ffffff/);
    assert.ok(CSS.includes('[data-theme="dark"] .report-sheet{--primary:#d42525;--accent:#d14242'));
    assert.ok(CSS.includes("background:#ffffff;color:#18181b;"));
  });
});

/* =========================================================================
 * 12. Gate 4.4D mobile DOM/CSS remediation  (620px)
 * ======================================================================
 * WHY THIS SUITE WAS REWRITTEN. The previous version asserted that the hiding
 * rules existed, and they did — and the browser showed the hidden things anyway.
 * `primaryBtn` and `ghostBtn` carry `display:"inline-flex"` as an INLINE style
 * and the Avatar disc carries `display:flex`, so every plain stylesheet
 * `display:none` aimed at one of them lost the cascade. A test that reads a
 * selector and stops has no opinion about which declaration wins.
 *
 * So these tests pin the CASCADE, not the selector:
 *
 *  - an element whose visibility CSS controls must EITHER carry no inline
 *    display (the two region wrappers) OR be hidden with `!important` (the
 *    avatar) — and the tests check the JSX and the component to decide which
 *    case applies, rather than taking the stylesheet's word for it;
 *  - the two action regions are switched as a complementary pair, both halves
 *    in one media block, each declaration stated exactly once in the file;
 *  - no Review action is rendered outside the two owned regions.
 */

describe("Gate 4.4D remediation · action-region ownership at 620px", () => {
  /** Everything between the two region wrappers is owned by neither. */
  const DESKTOP_REGION = '<div className="rvc-actions-desktop">';
  const MOBILE_REGION = '<div className="rvc-actions-mobile">';
  const AVATAR_SRC = code("src", "components", "students", "student-ui.tsx");
  /** The 620px block that carries the region switch. */
  const PAIR = mediaBlock("(max-width:620px)", ".rvc-actions-desktop");
  /** The composer's own 620px block — header and page rules, not the pair. */
  const P620 = mediaBlock("(max-width:620px)", ".rvc-student-avatar");
  /** The 621-767 band, which gives the identity its own row. */
  const P767 = mediaBlock("(max-width:767px)", ".rvc-head-id");

  /** Every rule in `css` that sets `display` on `selector`, in source order,
   * with a flag for whether the declaration is `!important`. This is what makes
   * a cascade claim checkable instead of assumed. */
  function displayRules(selector: string): { value: string; important: boolean }[] {
    const out: { value: string; important: boolean }[] = [];
    let from = 0;
    for (;;) {
      const at = CSS.indexOf(selector, from);
      if (at < 0) return out;
      from = at + selector.length;
      // Only a rule whose selector list ENDS here — not a descendant of it.
      const after = CSS.slice(from).match(/^\s*(,|\{)/);
      if (!after || after[1] === ",") continue;
      const body = CSS.slice(from, CSS.indexOf("}", from));
      const decl = body.match(/display\s*:\s*([a-z-]+)(\s*!important)?/);
      if (decl) out.push({ value: decl[1], important: !!decl[2] });
    }
  }

  it("71. the two action regions are complementary, and both halves are one rule", () => {
    /* THE INVARIANT: there is no width at which both regions are visible, and
     * none at which neither is. Both halves are stated together so source order
     * cannot produce a half-state. */
    assert.ok(CSS.includes(".rvc-actions-desktop{display:flex;align-items:center;gap:8px;flex:none;min-width:0}"),
      "the header region is shown by default");
    const mobileDef = CSS.slice(CSS.indexOf(".rvc-actions-mobile{"));
    assert.ok(mobileDef.slice(0, mobileDef.indexOf("}") + 1).includes("display:none"),
      "and the mobile region is hidden by default — the inverse");

    assert.ok(PAIR.includes(".rvc-actions-desktop{display:none}"), "at 620 the header region goes");
    assert.ok(PAIR.includes(".rvc-actions-mobile{display:flex}"), "and the mobile region arrives");
    assert.ok(PAIR.indexOf(".rvc-actions-desktop") < PAIR.indexOf(".rvc-actions-mobile"),
      "stated adjacently, as one decision");

    /* EXACTLY ONE DECLARATION EACH, so nothing further down the file can flip
     * half the pair back. */
    const desk = displayRules(".rvc-actions-desktop");
    const mob = displayRules(".rvc-actions-mobile");
    assert.deepEqual(desk.map((r) => r.value), ["flex", "none"], "shown, then hidden at 620");
    assert.deepEqual(mob.map((r) => r.value), ["none", "flex"], "hidden, then shown at 620");
  });

  it("72. the regions are hideable at all — nothing inline can outrank their CSS", () => {
    /* THE ROOT CAUSE OF THE BROWSER FAILURE, pinned so it cannot return. The
     * buttons carry an inline display and are therefore NOT hideable by a plain
     * rule; the wrappers carry no style attribute at all and are. */
    assert.ok(COMPOSER.includes(DESKTOP_REGION), "the header region is a bare div");
    assert.ok(COMPOSER.includes(MOBILE_REGION), "and so is the mobile region");
    for (const region of [DESKTOP_REGION, MOBILE_REGION]) {
      assert.ok(!region.includes("style="), `${region} carries no inline style`);
    }
    // The buttons still do — which is exactly why the region owns visibility.
    assert.ok(COMPOSER.includes('display: "inline-flex"'), "primaryBtn/ghostBtn are inline-styled");
    /* And no rule anywhere tries the failed approach again: hiding a Review
     * action by a class ON THE BUTTON. Those rules matched and lost. */
    for (const dead of [/rvc-head-action(?!s)/, /rvc-save/, /rvc-bar-cancel/, /rvc-actionbar/]) {
      assert.ok(!dead.test(CSS), `${dead} is gone from the stylesheet`);
      assert.ok(!dead.test(COMPOSER), `${dead} is gone from the composer`);
    }
  });

  it("73. no Review action is rendered outside the two owned regions", () => {
    /* One builder, called once per region, and every action inside it. A button
     * added anywhere else would answer to no media query at all. */
    assert.ok(COMPOSER.includes('const reviewActions = (surface: "desktop" | "mobile") => ('));
    assert.equal(COMPOSER.split('reviewActions("desktop")').length - 1, 1);
    assert.equal(COMPOSER.split('reviewActions("mobile")').length - 1, 1);
    // Each call is the immediate and only child of its region wrapper.
    assert.match(COMPOSER, /<div className="rvc-actions-desktop">\s*\{reviewActions\("desktop"\)\}\s*<\/div>/);
    assert.match(COMPOSER, /<div className="rvc-actions-mobile">\s*\{reviewActions\("mobile"\)\}\s*<\/div>/);
    // The three handlers exist once each, so neither region can drift.
    assert.equal(COMPOSER.split("onClick={submit}").length - 1, 1, "one save handler");
    assert.equal(COMPOSER.split('onClick={() => setStage("edit")}').length - 1, 1, "one Edit review handler");
    assert.equal(COMPOSER.split("onClick={requestCancelEdit}").length - 1, 1, "one cancel handler");
    /* PREVIEW IS NOT A REVIEW ACTION and is deliberately outside both regions —
     * it changes presentation, not persistence, so it survives at 620. */
    const nav = COMPOSER.slice(COMPOSER.indexOf('<div className="rvc-head-actions">'));
    const navBlock = nav.slice(0, nav.indexOf(DESKTOP_REGION));
    assert.ok(navBlock.includes("{previewBtn}"), "Preview sits in the row, not in the region");
  });

  it("74. the stage decides the action, and the region only decides where", () => {
    assert.ok(COMPOSER.includes('const primaryActionFor = (surface: "desktop" | "mobile") => {'));
    assert.ok(COMPOSER.includes('const cancelEditBtn = (surface: "desktop" | "mobile") => {'));
    assert.ok(COMPOSER.includes('return stage === "view" ? ('), "View offers Edit review, never a save");
    assert.ok(STATE.includes('return stage === "create" ? "Save review" : stage === "view" ? "Edit review" : "Save changes";'));
    assert.ok(!COMPOSER.includes('t("Save changes")'), "no label is hard-coded past the stage");
    // Cancel editing exists only in Edit, and only inside the builder.
    assert.ok(COMPOSER.includes('{stage === "edit" && cancelEditBtn(surface)}'));
    // The mobile copy fills the row and keeps a thumb target; neither shrinks.
    assert.ok(COMPOSER.includes("const style = bar ? { ...primaryBtn, flex: 1, height: 44 } : primaryBtn;"));
    assert.ok(COMPOSER.includes("style={bar ? { ...ghostBtn, height: 44 } : ghostBtn}"));
    // No JavaScript breakpoint anywhere — CSS owns the width, alone.
    assert.ok(!/useMediaQuery|matchMedia|innerWidth/.test(COMPOSER));
  });

  it("75. the avatar is addressed by name, and hidden with a rule that WINS", () => {
    /* BY NAME. `.rvc-head-id > *:first-child` was a claim about DOM order, not
     * about the avatar, and it silently stops being true the moment anything is
     * inserted before it. */
    assert.ok(COMPOSER.includes('className="rvc-student-avatar"'), "the disc carries its own class");
    assert.ok(!CSS.includes(".rvc-head-id>*:first-child"), "and the structural selector is gone");
    assert.ok(AVATAR_SRC.includes("className?: string;"), "Avatar accepts it, optionally");
    assert.ok(AVATAR_SRC.includes("className={className}"), "and puts it on its own root");

    /* AND IT WINS. The component's root carries an inline `display:flex`, so a
     * plain `display:none` would match this element and still lose — which is
     * what the browser showed. This asserts the two facts TOGETHER: if the
     * inline display is ever removed the !important may go with it, and if it
     * stays, the !important must. */
    const root = AVATAR_SRC.slice(AVATAR_SRC.indexOf("<span"), AVATAR_SRC.indexOf("</span>"));
    const inlineDisplay = /display:\s*"flex"/.test(root);
    assert.ok(inlineDisplay, "Avatar's root still declares display inline");
    const rules = displayRules(".rvc-student-avatar");
    assert.equal(rules.length, 1, "one rule hides it");
    assert.equal(rules[0].value, "none", "and it hides rather than dimming");
    assert.equal(rules[0].important, inlineDisplay,
      "an inline display demands !important — that is the whole defect");
    assert.ok(P620.includes(".rvc-student-avatar{display:none !important}"), "at 620, and only there");
  });

  it("76. hiding the avatar leaves no reserved width behind it", () => {
    /* `display:none` removes the disc from the flex layout entirely, so its
     * 34px min-width, the parent's gap and any margin go with it. `visibility`
     * or `opacity` would each leave a hole where the avatar used to be. */
    const rules = displayRules(".rvc-student-avatar");
    assert.equal(rules[0].value, "none");
    assert.ok(!P620.includes("visibility:hidden"), "not merely invisible");
    assert.ok(!P620.includes("opacity:0"), "and not merely transparent");
    assert.ok(P620.includes(".rvc-head-id{gap:0}"), "no gap is reserved for what is not there");
    // Nothing in the band pads or indents the identity to make room either.
    const id = P620.slice(P620.indexOf(".rvc-head-id{"));
    const idBody = id.slice(0, id.indexOf("}") + 1);
    assert.ok(!idBody.includes("margin-left"), "no margin left over from avatar layout");
    assert.ok(!idBody.includes("padding-left"));
    /* THE NAME IS A SIBLING OF THE AVATAR, NOT INSIDE IT — so hiding one cannot
     * take the other with it. The Avatar element is self-closing and the text
     * column follows it. */
    assert.match(COMPOSER, /<Avatar\b[^>]*\/>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div className="rvc-id-text">/);
    assert.ok(!AVATAR_SRC.includes("children"), "Avatar renders no caller content at all");
  });

  it("77. the final 620px hierarchy: nav, student, content, one footer", () => {
    // Top row: Back and Preview, both surviving, both still tappable.
    assert.ok(COMPOSER.includes('className="btn-ghost rvc-back"'));
    assert.ok(COMPOSER.includes('className="btn-ghost rvc-preview-btn"'));
    assert.ok(!P620.includes(".rvc-back{display:none") && !P620.includes(".rvc-preview-btn{display:none"));
    assert.ok(P767.includes(".rvc-back{padding:0 10px !important}"),
      "Back is icon-only here, but never below a touch target");
    /* PREVIEW IS THE LABELLED ONE. It is a ghost/secondary control — never the
     * primary — and it carries the eye plus the word at every width below 1100. */
    assert.ok(COMPOSER.includes("{iconEye}") && COMPOSER.includes('<span className="rvc-btn-label">{t("Preview")}</span>'));
    assert.ok(!/\.rvc-preview-btn .rvc-btn-label\{display:none/.test(CSS));
    assert.equal(DICT["Preview"], "Xem trước", "and it is localized where it is read");
    // Student: its own full-width row, below the nav row, wrapping, min-width:0.
    assert.ok(P767.includes("flex:1 0 100%") && P767.includes("order:2"));
    assert.ok(P767.includes(".rvc-head-actions{order:1;margin-left:auto}"));
    assert.ok(CSS.includes(".rvc-head-id{display:flex;align-items:center;gap:11px;flex:1;min-width:0}"));
    assert.ok(CSS.includes(".rvc-id-text{flex:1;min-width:0}"));
    const name = P620.slice(P620.indexOf(".rvc-id-name{"));
    assert.ok(name.slice(0, name.indexOf("}") + 1).includes("white-space:normal"), "the name wraps");
    assert.ok(P767.includes(".rvc-id-period{display:block}") && P767.includes(".rvc-id-grade{display:none}"));
    assert.ok(COMPOSER.includes("fmt.monthLabel(shownMonth)") && "Monthly review" in DICT);
    // Content clears the bar, and the bar clears the device inset.
    assert.ok(P620.includes(".rvc-editor{padding:18px 14px calc(76px + env(safe-area-inset-bottom,0px));border-bottom:none}"));
    const barDef = CSS.slice(CSS.indexOf(".rvc-actions-mobile{"));
    const barBody = barDef.slice(0, barDef.indexOf("}") + 1);
    assert.ok(barBody.includes("padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))"));
    assert.ok(barBody.includes("position:sticky;bottom:0") && barBody.includes("z-index:16"));
    assert.ok(P620.includes(".rvc-actions-mobile .rvc-dirty{flex:1 0 100%}"),
      "and the unsaved marker never squeezes the two Edit buttons");
  });

  it("78. the mobile Cancel editing is the SAME dirty guard, not a second one", () => {
    assert.ok(COMPOSER.includes("const requestCancelEdit = () => {"));
    assert.ok(COMPOSER.includes("if (dirty) setPendingCancel(true);"));
    assert.ok(COMPOSER.includes("else returnToView();"));
    assert.equal(COMPOSER.split("<ConfirmDialog").length - 1, 1, "one prompt on the page");
    assert.ok(COMPOSER.includes('title={t("Discard unsaved changes?")}'));
    assert.ok(!COMPOSER.includes("window.confirm"), "and no second confirmation architecture");
  });

  it("79. 620 is the ONLY line, so no band can own half the actions", () => {
    /* THE HALF-STATE THAT MADE THIS POSSIBLE. Ownership used to be split across
     * two breakpoints — the bar arrived at 767 for two stages while the header
     * kept its actions — so "hidden footer plus missing header action" and
     * "visible footer plus visible header action" were both reachable. Both
     * regions now change at one width, in one rule. */
    assert.ok(!P767.includes("rvc-actions-desktop"), "the tablet band decides no ownership");
    assert.ok(!P767.includes("rvc-actions-mobile"));
    const tablet = mediaBlock("(max-width:1099px)", ".rvc-split");
    assert.ok(!tablet.includes("rvc-actions-"), "and neither does the tablet layout block");
    // The pair is declared in exactly one media block, at 620.
    assert.equal(CSS.split(".rvc-actions-desktop{display:none}").length - 1, 1);
    assert.equal(CSS.split(".rvc-actions-mobile{display:flex}").length - 1, 1);
    /* THE 620/621 TRANSITION. The two-row header hierarchy is stated once, at
     * 767, and 620 never restates it — so crossing the line moves the avatar and
     * the actions and nothing else. */
    assert.ok(P767.includes(".rvc-head-id{"), "the identity row is the 767 block's");
    assert.ok(!P620.includes(".rvc-head-id{order:"), "and 620 only drops the avatar");
    assert.ok(!P620.includes(".rvc-id-grade{display:none}"), "the context swap is the 767 block's too");
    // And the desktop split is untouched by any of it.
    assert.ok(CSS.includes(".rvc-split{display:grid;grid-template-columns:minmax(400px,2fr) minmax(0,3fr)"));
  });
});

/* =========================================================================
 * The composer's desktop workspace — a document-sized preview
 * ======================================================================
 * WHY THIS SUITE EXISTS. The right half of this screen is an A4 DOCUMENT, and it
 * was being drawn at 74% of the width the printed one has: at 1920px the shell's
 * 1400px cap and an even split left a 668px preview pane holding a 604px sheet,
 * whose 524px content column is nothing like the printed 703px. A preview that
 * wraps its paragraphs somewhere the real report does not is not previewing the
 * real report.
 *
 * These tests pin the GEOMETRY CONTRACT — the cap, the ratio, the editor's floor
 * and the fact that none of it leaks onto any other screen — by computing the
 * same numbers the browser will. They cannot prove what a monitor shows; that is
 * §19's job. They can prove the arithmetic is still what was agreed.
 */

describe("Gate 4.4E · the composer's desktop workspace", () => {
  /** The app shell's own geometry, read from the component rather than assumed. */
  const SHELL = code("src", "components", "shell", "app-shell.tsx");
  const SIDEBAR = code("src", "components", "shell", "sidebar.tsx");

  const shellCap = Number(SHELL.match(/maxWidth: (\d+)/)![1]);
  const shellPad = Number(SHELL.match(/padding: "(\d+)px (\d+)px/)![2]);
  const sidebarW = Number(SIDEBAR.match(/collapsed \? \d+ : (\d+)/)![1]);

  /** The composer's own cap, from the rule that lifts the shell's. */
  const wide = mediaBlock("(min-width:1100px)", ".app-main:has(>.rvc)");
  const composerCap = Number(wide.match(/max-width:(\d+)px !important/)![1]);
  /** The split, and the editor's floor. */
  const split = CSS.match(/\.rvc-split\{display:grid;grid-template-columns:minmax\((\d+)px,(\d+)fr\) minmax\(0,(\d+)fr\)/);
  const [editorFloor, editorFr, previewFr] = split!.slice(1).map(Number);
  /** The sheet's own bound, and its padding, from the report stylesheet. */
  const sheetCap = Number(CSS.match(/padding:36px (\d+)px;max-width:(\d+)px/)![2]);
  const sheetPad = Number(CSS.match(/padding:36px (\d+)px;max-width:\d+px/)![1]);
  /** The printed document's content column: A4 less `@page{margin:12mm}`, less
   * the sheet's own print padding, which print sets to zero. */
  const PRINTED_COLUMN = (210 - 24) * (96 / 25.4);

  /** What the browser will compute at a given viewport, sidebar expanded. */
  function geometry(viewport: number) {
    const box = Math.min(composerCap, viewport - sidebarW) - shellPad * 2;
    const editor = Math.max(editorFloor, (box * editorFr) / (editorFr + previewFr));
    const preview = box - editor;
    // .rvc-preview padding: clamp(16px,2.5vw,32px)
    const previewPad = Math.max(16, Math.min(viewport * 0.025, 32));
    const sheet = Math.min(sheetCap, preview - previewPad * 2);
    return { box, editor, preview, sheet, column: sheet - sheetPad * 2 };
  }

  it("100. the composer lifts the shell's ordinary content cap — and only there", () => {
    assert.equal(shellCap, 1400, "the shell's cap is what every other page gets");
    assert.ok(composerCap > shellCap, `the composer's ${composerCap}px exceeds it`);
    assert.ok(composerCap >= 1680 && composerCap <= 1800,
      `${composerCap}px is inside the agreed 1680-1800 band`);

    /* SCOPED TO A PAGE THAT ACTUALLY HOLDS A COMPOSER. `:has(>.rvc)` cannot match
     * anywhere else, so no list or form screen changes width. */
    assert.ok(wide.includes(".app-main:has(>.rvc){"), "reached through :has, from the composer itself");
    assert.equal(CSS.split(".app-main:has").length - 1, 1, "declared exactly once");
    assert.ok(!/\.app-main\{[^}]*max-width/.test(CSS), "and the shell's own cap is untouched");
    assert.ok(COMPOSER.includes('className="rvc" data-stage={stage}'), "the composer root carries .rvc");

    /* THE `!important` IS LOAD-BEARING: the shell sets its cap as an INLINE
     * style, which beats any stylesheet rule without it. */
    assert.ok(SHELL.includes("maxWidth: 1400"), "the cap really is inline");
    assert.ok(wide.includes("!important"), "so the override must be !important");
  });

  it("101. the preview is the dominant pane, and the editor keeps a floor", () => {
    const share = previewFr / (editorFr + previewFr);
    assert.ok(share >= 0.55 && share <= 0.62,
      `the preview takes ${(share * 100).toFixed(0)}% — the target is about 60`);
    assert.ok(previewFr > editorFr, "the document is the larger half");
    assert.ok(editorFloor >= 380, `the editor cannot shrink past ${editorFloor}px`);

    /* THE FLOOR IS NOT A REDUCTION. It is what the editor pane already had at
     * 1100px under the old even split, so no width loses room it used to have. */
    const oldAt1100 = (Math.min(shellCap, 1100 - sidebarW) - shellPad * 2) / 2;
    assert.ok(editorFloor <= oldAt1100 + 10,
      `the floor (${editorFloor}px) is about what 1100px already gave (${oldAt1100.toFixed(0)}px)`);

    /* AND IT IS ENOUGH FOR THE CONTROLS. A skill row is a label, a 12px gap and a
     * five-segment scale with a 240px basis; the month field caps at 320px. */
    assert.ok(FIELDS.includes('flex: "0 1 240px"'), "the rating scale's basis");
    assert.ok(CSS.includes(".rvc-month{max-width:320px"), "and the month field's cap");
    const editorPad = 40; // clamp(16px,3vw,40px) at its maximum
    assert.ok(editorFloor - editorPad * 2 >= 320,
      `the floor leaves ${editorFloor - editorPad * 2}px of content — the month field needs 320`);
    /* And at the padding the floor actually gets — `clamp(16px,3vw,40px)` is 33px
     * at 1100px, not its 40px maximum — there is real room over. */
    assert.ok(editorFloor - 33 * 2 > 320, "with the padding a 1100px screen really uses");
  });

  it("102. at desktop widths the sheet approaches the printed document", () => {
    /* THE POINT OF THE WHOLE CHANGE: the preview's content column against the
     * printed one. Anything much under it wraps paragraphs differently and the
     * preview stops describing the report. */
    const at = (v: number) => geometry(v).column / PRINTED_COLUMN;
    assert.ok(at(1920) > 0.93, `at 1920 the column is ${(at(1920) * 100).toFixed(0)}% of the printed one`);
    assert.ok(at(1600) > 0.85, `at 1600 it is ${(at(1600) * 100).toFixed(0)}%`);
    assert.ok(at(1440) > 0.72, `at 1440 it is ${(at(1440) * 100).toFixed(0)}%`);

    /* AND IT IS A REAL IMPROVEMENT, not a restatement: the same arithmetic under
     * the old cap and even split is what human verification called too narrow. */
    const before = (() => {
      const box = Math.min(shellCap, 1920 - sidebarW) - shellPad * 2;
      const preview = box / 2;
      return Math.min(sheetCap, preview - 32 * 2) - sheetPad * 2;
    })();
    assert.ok(geometry(1920).column > before * 1.25,
      `1920 goes from ${before.toFixed(0)}px to ${geometry(1920).column.toFixed(0)}px of column`);
  });

  it("103. the sheet stays bounded and centred — never stretched, never scaled", () => {
    /* It grows to its own maximum and stops; the pane's leftover width becomes
     * air on both sides rather than a wider document. */
    assert.ok(geometry(1920).sheet <= sheetCap && geometry(2560).sheet <= sheetCap,
      "the sheet never exceeds its own bound");
    assert.equal(geometry(2560).sheet, sheetCap, "and reaches it on a wide screen");
    assert.ok(CSS.includes("max-width:760px;margin:0 auto"), "bounded and centred by its own rule");
    /* NO TRANSFORM SCALING anywhere near the preview: a scaled sheet leaves a
     * layout box that lies about the size of what is drawn in it. */
    const composerCss = CSS.slice(CSS.indexOf(".rvc{"));
    assert.ok(!/\.rvc[^{]*\{[^}]*transform:\s*scale/.test(composerCss), "no scaled preview");
    assert.ok(!/zoom:/.test(composerCss), "and no zoom");
    /* BOTH TRACKS FLOOR AT A MINIMUM THEY CAN HONOUR, so a wide child pays for
     * itself instead of pushing the page sideways. */
    assert.ok(split![0].includes("minmax(0,3fr)"), "the preview track can shrink to zero");
  });

  it("104. an ultrawide screen is capped, not stretched", () => {
    const wideBox = geometry(2560).box;
    assert.equal(wideBox, composerCap - shellPad * 2, "the workspace stops at its cap");
    assert.equal(geometry(3440).box, wideBox, "and does not grow past it");
    /* The editor stops growing too — it has a natural width of its own. */
    assert.ok(CSS.includes(".rvc-editor-inner{max-width:620px"), "the form is bounded inside its pane");
  });

  it("105. nothing below 1100px changes", () => {
    /* The tablet block still collapses the split to one column, and it sits
     * later in the stylesheet, so it wins at equal specificity. */
    const tablet = mediaBlock("(max-width:1099px)", ".rvc-split");
    assert.ok(tablet.includes(".rvc-split{grid-template-columns:minmax(0,1fr)}"),
      "one column below the breakpoint");
    assert.ok(CSS.indexOf(tablet) > CSS.indexOf(".rvc-split{display:grid"),
      "and that block is declared after the desktop rule, so it wins at equal specificity");
    /* The wide cap is inside a min-width query, so it cannot reach a phone. */
    assert.ok(CSS.includes("@media (min-width:1100px){"), "the cap is gated at the same breakpoint");
    /* And none of the surfaces §13 protects were touched. */
    for (const untouched of [".rvc-preview-btn", ".rvc-actions-mobile", ".rvc-overlay-head", ".rvc-month"]) {
      assert.ok(CSS.includes(untouched), `${untouched} is still declared`);
    }
  });
});
