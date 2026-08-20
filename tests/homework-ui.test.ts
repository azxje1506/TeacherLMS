/* Homework — the client's form rules, and what the screen may render.
 *
 * Run with:  npm test
 *
 * NO DOM. This project ships no component-render harness (`npm test` runs
 * `tsx --test tests/*.test.ts`, and there is no testing-library dependency), and
 * Gate 4.3 is not the place to introduce one. So the client is tested the way
 * Attendance's is: the DECISIONS live in a pure module —
 * src/components/homework/form.ts, the counterpart of
 * src/components/attendance/draft.ts — and are exercised directly, while the
 * things that only exist as JSX are asserted by scanning the source.
 *
 * The payload builders are the important cases. `toCreateBody` and
 * `toUpdateBody` are the last point at which a field could reach the wire, so
 * "an edit can never send an ownership field" is proven here as a function call
 * rather than inferred from a component.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  emptyValues, filterByClass, studentOptions, toCreateBody, toUpdateBody,
  valuesFrom, valuesFromDuplicate, withClass, withScope,
  type HomeworkFormValues,
} from "../src/components/homework/form";
import { homeworkCardStyle } from "../src/components/homework/homework-ui";
import {
  buildAssignableClasses, buildFilterClasses, buildHomeworkList, HOMEWORK_ERROR, HOMEWORK_STATUSES,
} from "../src/lib/homework";
import type { Homework, Klass, Student } from "../src/lib/types";

function code(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PAGE = code("src", "app", "(app)", "homework", "page.tsx");
const DRAWER = code("src", "components", "homework", "homework-drawer.tsx");
const CLIENT = code("src", "components", "homework", "api.ts");
const FORM = code("src", "components", "homework", "form.ts");
const SHELL_DRAWER = code("src", "components", "ui", "drawer.tsx");
const I18N = JSON.parse(readFileSync(path.join(process.cwd(), "src", "lib", "i18n-vi.json"), "utf8")) as Record<string, string>;

/* ------------------------------------------------------------------ fixtures */

const ASSIGNABLE = [
  { id: "c1", name: "Little Explorers · A1", students: [{ id: "s8x", name: "Ana" }, { id: "s2", name: "Lucas Chen" }] },
  { id: "c2", name: "Grammar Stars · B1", students: [{ id: "s3", name: "Liam Park" }] },
  { id: "c4", name: "Emma Chen · 1-on-1", students: [] },
];

function item(over: Partial<import("../src/lib/homework").HomeworkListItem> = {}) {
  return {
    id: "hw-1", title: "T", description: "D", classId: "c1",
    className: "Little Explorers · A1", classColor: "#e11",
    scope: "class" as const, studentId: null, assigneeName: "Little Explorers · A1",
    dueDate: "2026-07-04", status: "Completed" as const, teacherNotes: "N",
    createdAt: "2026-06-15", deleteEligible: false,
    ...over,
  };
}

/* ------------------------------------------------------------- form values */

describe("Form values", () => {
  it("1. a blank form defaults to class scope and nothing else", () => {
    assert.deepEqual(emptyValues(), {
      title: "", description: "", classId: "", scope: "class",
      studentId: "", dueDate: "", teacherNotes: "",
    });
  });

  it("2. an edit starts from the record, ownership included so it can be shown", () => {
    const v = valuesFrom(item({ scope: "student", studentId: "s3", classId: "c2" }));
    assert.equal(v.classId, "c2");
    assert.equal(v.scope, "student");
    assert.equal(v.studentId, "s3");
    assert.equal(v.title, "T");
    assert.equal(v.teacherNotes, "N");
  });

  it("3. a null assignee becomes an empty select rather than a null", () => {
    assert.equal(valuesFrom(item({ scope: "class", studentId: null })).studentId, "");
  });

  it("4. form values carry no status, submissions, id or createdAt", () => {
    const keys = Object.keys(valuesFrom(item())).sort();
    assert.deepEqual(keys, ["classId", "description", "dueDate", "scope", "studentId", "teacherNotes", "title"]);
  });
});

/* ----------------------------------------------------------- class + scope */

describe("Choosing a class", () => {
  it("5. keeps a student who belongs to it", () => {
    const v: HomeworkFormValues = { ...emptyValues(), scope: "student", classId: "c1", studentId: "s2" };
    assert.equal(withClass(v, "c1", ASSIGNABLE).studentId, "s2");
  });

  it("6. clears a student who does not", () => {
    const v: HomeworkFormValues = { ...emptyValues(), scope: "student", classId: "c1", studentId: "s2" };
    const next = withClass(v, "c2", ASSIGNABLE);
    assert.equal(next.classId, "c2");
    assert.equal(next.studentId, "", "a stale selection must not be submitted");
  });

  it("7. refuses to hold a class the picker cannot offer", () => {
    const next = withClass(emptyValues(), "c7", ASSIGNABLE);
    assert.equal(next.classId, "", "an unassignable class has no control to represent it");
  });

  it("8. offers a class's students in roster order, and only resolvable ones", () => {
    assert.deepEqual(studentOptions("c1", ASSIGNABLE), [
      { value: "s8x", label: "Ana" },
      { value: "s2", label: "Lucas Chen" },
    ]);
  });

  it("9. a class with no resolvable students offers none — not an error", () => {
    assert.deepEqual(studentOptions("c4", ASSIGNABLE), []);
  });

  it("10. an unknown class offers none", () => {
    assert.deepEqual(studentOptions("nope", ASSIGNABLE), []);
  });

  it("11. switching to class scope drops the assignee", () => {
    const v: HomeworkFormValues = { ...emptyValues(), scope: "student", studentId: "s3" };
    assert.equal(withScope(v, "class").studentId, "");
  });

  it("12. switching to student scope keeps a selection already made", () => {
    const v: HomeworkFormValues = { ...emptyValues(), scope: "class", studentId: "s3" };
    assert.equal(withScope(v, "student").studentId, "s3");
  });

  it("13. neither helper mutates its input", () => {
    const v = Object.freeze({ ...emptyValues(), classId: "c1", studentId: "s2" }) as HomeworkFormValues;
    withClass(v, "c2", ASSIGNABLE);
    withScope(v, "student");
    assert.equal(v.classId, "c1");
    assert.equal(v.studentId, "s2");
  });
});

/* ------------------------------------------------------------ POST payload */

describe("The create payload", () => {
  const full: HomeworkFormValues = {
    title: "T", description: "D", classId: "c2", scope: "class",
    studentId: "", dueDate: "2026-07-18", teacherNotes: "N",
  };

  it("14. carries exactly the seven writable fields", () => {
    assert.deepEqual(Object.keys(toCreateBody(full)).sort(), [
      "classId", "description", "dueDate", "scope", "studentId", "teacherNotes", "title",
    ]);
  });

  it("15. never carries a server-owned field", () => {
    const wire = toCreateBody(full) as unknown as Record<string, unknown>;
    for (const owned of ["id", "status", "submissions", "lessonId", "createdAt"]) {
      assert.ok(!(owned in wire), `${owned} must never be sent`);
    }
  });

  it("16. an empty student select becomes null", () => {
    assert.equal(toCreateBody({ ...full, scope: "student", studentId: "" }).studentId, null);
  });

  it("17. a class-scoped body carries no student at all, even if one is held", () => {
    assert.equal(toCreateBody({ ...full, scope: "class", studentId: "s3" }).studentId, null);
  });

  it("18. a student-scoped body carries the chosen student", () => {
    assert.equal(toCreateBody({ ...full, scope: "student", studentId: "s3" }).studentId, "s3");
  });

  it("19. a past due date is passed through — back-dating is a correction", () => {
    assert.equal(toCreateBody({ ...full, dueDate: "2026-01-05" }).dueDate, "2026-01-05");
  });
});

/* ----------------------------------------------------------- PATCH payload */

describe("The edit payload", () => {
  const v: HomeworkFormValues = {
    title: "T", description: "D", classId: "c2", scope: "student",
    studentId: "s3", dueDate: "2026-08-01", teacherNotes: "N",
  };

  it("20. carries exactly the four editable fields", () => {
    assert.deepEqual(Object.keys(toUpdateBody(v)).sort(), ["description", "dueDate", "teacherNotes", "title"]);
  });

  it("21. NEVER carries an ownership field, even though the form is holding one", () => {
    const wire = toUpdateBody(v) as unknown as Record<string, unknown>;
    for (const owned of ["classId", "scope", "studentId", "lessonId", "status", "submissions", "id", "createdAt"]) {
      assert.ok(!(owned in wire), `${owned} must never be sent`);
    }
    // The form genuinely held them — this is what makes the guarantee meaningful.
    assert.equal(v.classId, "c2");
    assert.equal(v.studentId, "s3");
  });

  it("22. a historical due date is sent like any other — no month lock", () => {
    assert.equal(toUpdateBody({ ...v, dueDate: "2026-06-01" }).dueDate, "2026-06-01");
  });

  it("23. clearing the teacher's notes sends an empty string, not an omission", () => {
    const wire = toUpdateBody({ ...v, teacherNotes: "" });
    assert.ok("teacherNotes" in wire);
    assert.equal(wire.teacherNotes, "");
  });
});

/* -------------------------------------------------------------- duplicate */

describe("Duplicate prefill", () => {
  const source = item({
    id: "hw-c2-0", title: "Vocabulary", description: "Learn 15 words.",
    classId: "c2", className: "Grammar Stars · B1", scope: "class", studentId: null,
    dueDate: "2026-07-08", status: "Missing", teacherNotes: "chase this up",
  });

  it("24. copies the teacher's own words", () => {
    const p = valuesFromDuplicate(source, ASSIGNABLE);
    assert.equal(p.title, "Vocabulary");
    assert.equal(p.description, "Learn 15 words.");
    assert.equal(p.teacherNotes, "chase this up");
    assert.equal(p.classId, "c2");
    assert.equal(p.scope, "class");
  });

  it("25. leaves the due date blank", () => {
    assert.equal(valuesFromDuplicate(source, ASSIGNABLE).dueDate, "");
  });

  it("26. carries no status, submissions, id or createdAt — the type has none", () => {
    const p = valuesFromDuplicate(source, ASSIGNABLE) as unknown as Record<string, unknown>;
    for (const forbidden of ["id", "status", "submissions", "lessonId", "createdAt"]) {
      assert.ok(!(forbidden in p), `${forbidden} must never be copied`);
    }
    assert.ok(!JSON.stringify(p).includes("Missing"), "no stored outcome may survive");
  });

  it("27. unsets a class that is no longer assignable", () => {
    // The original was set for a class since ended or archived.
    const p = valuesFromDuplicate(item({ classId: "c9" }), ASSIGNABLE);
    assert.equal(p.classId, "", "a create only goes to an Active class");
  });

  it("28. clears an assignee who is no longer on the class's roster", () => {
    const p = valuesFromDuplicate(item({ classId: "c2", scope: "student", studentId: "s99" }), ASSIGNABLE);
    assert.equal(p.classId, "c2");
    assert.equal(p.studentId, "");
  });

  it("29. keeps an assignee who still is", () => {
    const p = valuesFromDuplicate(item({ classId: "c2", scope: "student", studentId: "s3" }), ASSIGNABLE);
    assert.equal(p.studentId, "s3");
  });

  it("30. leaves the source item untouched", () => {
    const before = JSON.stringify(source);
    valuesFromDuplicate(source, ASSIGNABLE);
    assert.equal(JSON.stringify(source), before);
  });
});

/* ----------------------------------------------------------- class filter */

describe("The class filter", () => {
  const rows = [item({ id: "a", classId: "c1" }), item({ id: "b", classId: "c2" }), item({ id: "c", classId: "c1" })];

  it("31. an empty selection is unfiltered", () => {
    assert.deepEqual(filterByClass(rows, "").map((r) => r.id), ["a", "b", "c"]);
  });

  it("32. a selection narrows to that class", () => {
    assert.deepEqual(filterByClass(rows, "c1").map((r) => r.id), ["a", "c"]);
  });

  it("33. filtering never mutates the list it was given", () => {
    const out = filterByClass(rows, "");
    assert.notEqual(out, rows);
    assert.equal(rows.length, 3);
  });
});

/* ------------------------------------------------- filter / assignable lists */

describe("The two class lists answer two different questions", () => {
  const classes: Klass[] = [
    { id: "c1", name: "Active one", type: "group", level: "", fee: 0, classroom: "", status: "Active", studentIds: ["s2", "s8"], notes: "", schedule: [], color: "#1" },
    { id: "c7", name: "Archived one", type: "group", level: "", fee: 0, classroom: "", status: "Archived", studentIds: ["s6"], notes: "", schedule: [], color: "#2" },
    { id: "c8", name: "Ended one", type: "group", level: "", fee: 0, classroom: "", status: "Ended", studentIds: ["s2"], notes: "", schedule: [], color: "#3" },
  ];
  const students: Array<Pick<Student, "id" | "name">> = [{ id: "s2", name: "Lucas" }];

  const hw = (over: Partial<Homework>): Homework => ({
    id: "h", title: "T", description: "", classId: "c1", lessonId: null, scope: "class",
    studentId: null, dueDate: "2026-07-01", status: "Completed", submissions: {},
    teacherNotes: "", createdAt: "2026-06-15", ...over,
  });

  it("34. the FILTER list includes an Archived class that still has visible work", () => {
    const items = buildHomeworkList([hw({ id: "a", classId: "c7" })], classes, students);
    const filters = buildFilterClasses(items, classes);
    assert.deepEqual(filters.map((c) => c.id), ["c7"],
      "a class's current status must not make its past work unreachable");
  });

  it("35. and an Ended one", () => {
    const items = buildHomeworkList([hw({ id: "a", classId: "c8" })], classes, students);
    assert.deepEqual(buildFilterClasses(items, classes).map((c) => c.id), ["c8"]);
  });

  it("36. the filter list omits a class with no visible work", () => {
    const items = buildHomeworkList([hw({ id: "a", classId: "c1" })], classes, students);
    assert.deepEqual(buildFilterClasses(items, classes).map((c) => c.id), ["c1"]);
  });

  it("37. the ASSIGNABLE list is Active only", () => {
    assert.deepEqual(buildAssignableClasses(classes, students).map((c) => c.id), ["c1"]);
  });

  it("38. assignable students are resolvable roster ids, in roster order", () => {
    const [active] = buildAssignableClasses(classes, students);
    assert.deepEqual(active.students, [{ id: "s2", name: "Lucas" }], "the ghost roster id s8 is omitted");
  });

  it("39. assignable students expose id and name and nothing else", () => {
    const [active] = buildAssignableClasses(classes, students);
    assert.deepEqual(Object.keys(active.students[0]).sort(), ["id", "name"]);
  });

  it("40. an Active class whose roster resolves to nobody is still assignable", () => {
    const empty: Klass[] = [{ ...classes[0], id: "cx", name: "Empty", studentIds: ["gone"] }];
    const [only] = buildAssignableClasses(empty, students);
    assert.equal(only.id, "cx");
    assert.deepEqual(only.students, [], "class-scoped work may still be set for it");
  });
});

/* ------------------------------------------------------------- the screen */

describe("The Homework page", () => {
  it("41. is no longer the module placeholder", () => {
    assert.ok(!PAGE.includes("ModulePlaceholder"));
    assert.ok(PAGE.includes('data-screen-label="Homework"'));
  });

  it("42. renders no KPI row", () => {
    for (const forbidden of ["hwKpis", "KPI", "Total<", "kpi"]) {
      assert.ok(!PAGE.includes(forbidden), `${forbidden} must not appear`);
    }
    // The four counter words must not be used as a tile set on this screen.
    assert.ok(!/Total/.test(PAGE), "no invented Total tile");
  });

  it("43. renders no status-chip row", () => {
    assert.ok(!PAGE.includes("chipStyle"), "the chip row is omitted whole");
    assert.ok(!/"Assigned"/.test(PAGE), "no chip vocabulary is invented for a word the design lacks");
  });

  it("44. renders no count subtitle", () => {
    assert.ok(!PAGE.includes("countLabel"));
  });

  it("45. uses the comp's own empty-state sentence", () => {
    assert.ok(PAGE.includes('t("No homework matches these filters.")'));
    assert.ok(I18N["No homework matches these filters."], "and it is a real dictionary entry");
  });

  it("46. every user-facing string it uses exists in the dictionary", () => {
    const keys = [...PAGE.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]);
    const missing = keys.filter((k) => !(k in I18N));
    // The readiness gate closed the two entries this assertion used to record as
    // outstanding — "Due" (the comp's own card-footer literal) and "Couldn't load
    // homework" (the app's per-module error family). The assertion is now the
    // stronger one: the screen may not ship a user-facing string the Vietnamese
    // dictionary cannot translate, so a new literal fails here rather than
    // rendering in English to a Vietnamese teacher.
    assert.deepEqual(missing, [], "every string on this screen needs a dictionary entry");
  });

  /* THE SCAN ABOVE CANNOT SEE THESE. Two families reach the screen through a
   * VARIABLE rather than a literal — the card badge renders t(h.status) and every
   * mutation’s error toast renders t(e.message) — so a source scan for t("...")
   * proves nothing about either. That blind spot is real: it is why "Assigned"
   * sat untranslated while the literal scan reported the screen clean. These two
   * assertions close it by naming the vocabularies themselves. */

  it("46b. every homework status has a Vietnamese entry — the card renders t(h.status)", () => {
    assert.ok(PAGE.includes("t(h.status)"), "the badge translates the stored status");
    const missing = HOMEWORK_STATUSES.filter((s) => !(s in I18N));
    assert.deepEqual(missing, [], "a status with no entry renders English on the card");
  });

  it("46c. every API refusal has a Vietnamese entry — the toast renders t(e.message)", () => {
    assert.ok(PAGE.includes("toast(t(e.message)"), "failures surface the server’s own sentence");
    const messages = Object.values(HOMEWORK_ERROR).map((e) => e.message);
    const missing = messages.filter((m) => !(m in I18N));
    assert.deepEqual(missing, [], "a refusal with no entry renders English in the toast");
  });

  it("47. shows the status badge from the stored status, deriving nothing", () => {
    assert.ok(PAGE.includes("homeworkBadgeStyle(h.status)"));
    assert.ok(!/dueDate\s*<|Date\.now|new Date/.test(PAGE), "status is never derived from time");
  });

  it("48. never renders a submission, a hidden id, a lesson or a timestamp", () => {
    for (const forbidden of ["submissions", "lessonId", "createdAt", "Last updated", "updatedAt"]) {
      assert.ok(!PAGE.includes(forbidden), `${forbidden} must not reach the screen`);
    }
  });

  it("49. disables Delete on settled work, and the button stays", () => {
    assert.ok(PAGE.includes("disabled={!h.deleteEligible}"),
      "the three-action row is the design; the button is disabled, not removed");
    assert.ok(!PAGE.includes("h.deleteEligible &&"), "it must not be conditionally rendered away");
  });

  it("50. offers no search, pager or bulk action", () => {
    for (const forbidden of ["Search", "page=", "pageSize", "selectAll", "bulk"]) {
      assert.ok(!PAGE.includes(forbidden), `${forbidden} is not in the design`);
    }
  });

  it("51. invalidates the homework list and the dashboard, and nothing else", () => {
    const keys = [...PAGE.matchAll(/invalidateQueries\(\{\s*queryKey:\s*([^}]+)\}/g)].map((m) => m[1].trim());
    assert.deepEqual(keys, ["homeworkKeys.all", '["dashboard"]']);
    assert.ok(!PAGE.includes("qc.clear()"), "no global cache clear");
    assert.ok(!PAGE.includes("classKeys") && !PAGE.includes("studentKeys") && !PAGE.includes("lessonKeys"),
      "homework writes touch no other collection");
  });

  it("52. duplicate opens the drawer and issues no request", () => {
    const dup = PAGE.slice(PAGE.indexOf("const duplicate ="), PAGE.indexOf("const assign ="));
    assert.ok(dup.includes("valuesFromDuplicate"));
    assert.ok(dup.includes("setDrawerFor(null)"));
    assert.ok(!/mutate|fetch\(/.test(dup), "duplicate writes nothing");
  });

  it("53. the filter's options come from filterClasses, not from assignable ones", () => {
    assert.ok(PAGE.includes("filterClasses.map"));
    assert.ok(!PAGE.includes("assignableClasses.map"), "the picker's list is not the filter's list");
  });
});

describe("The drawer", () => {
  it("54. renders the seven approved fields and no eighth", () => {
    const registered = [...DRAWER.matchAll(/register\("(\w+)"\)/g)].map((m) => m[1]);
    const controlled = [...DRAWER.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set([...registered, ...controlled])].sort(), [
      "classId", "description", "dueDate", "scope", "studentId", "teacherNotes", "title",
    ]);
  });

  it("55. has no status, lesson or submissions control", () => {
    for (const forbidden of ["status", "lessonId", "submissions", "createdAt"]) {
      assert.ok(!DRAWER.includes(`"${forbidden}"`), `${forbidden} must not be a field`);
    }
  });

  it("56. omits the ownership controls when editing, per the app's own convention", () => {
    assert.ok(DRAWER.includes("{!editing && ("), "class, scope and assignee are not drawn on an edit");
  });

  it("57. shows the assignee control only for student-scoped work", () => {
    assert.ok(DRAWER.includes('{scope === "student" && ('));
  });

  it("58. sends an edit through toUpdateBody and a create through toCreateBody", () => {
    assert.ok(DRAWER.includes("onUpdate(homework.id, toUpdateBody(values))"));
    assert.ok(DRAWER.includes("onCreate(toCreateBody(values))"));
  });

  it("59. validates with the server's own schema rather than a second opinion", () => {
    assert.ok(DRAWER.includes("zodResolver(homeworkCreateSchema)"));
  });

  it("60. every string it uses exists in the dictionary", () => {
    const keys = [...DRAWER.matchAll(/\bt\("([^"]+)"\)/g)].map((m) => m[1]);
    const missing = keys.filter((k) => !(k in I18N));
    assert.deepEqual(missing, [], "the S1 waiver permits no invented copy");
  });

  it("61. the scope vocabulary is the design's own recovered wording", () => {
    for (const key of ["Assign to", "Entire class", "Individual student"]) {
      assert.ok(I18N[key], `${key} must be an existing dictionary entry`);
    }
  });

  it("62. follows the shared drawer, adding no bespoke chrome", () => {
    assert.ok(DRAWER.includes("<Drawer"));
    assert.ok(!DRAWER.includes("createPortal"), "the panel is the shared one");
  });
});

describe("The client module", () => {
  it("63. defines no per-record key, because no per-record endpoint exists", () => {
    assert.ok(CLIENT.includes("all:"));
    assert.ok(CLIENT.includes("list:"));
    assert.ok(!CLIENT.includes("detail"), "there is no GET /api/homework/:id to key");
  });

  it("64. calls exactly the four approved endpoints", () => {
    const calls = [...CLIENT.matchAll(/fetch\(([^,)]+)[,)]/g)].map((m) => m[1].trim());
    assert.deepEqual(calls, ['"/api/homework"', '"/api/homework"', "`/api/homework/${id}`", "`/api/homework/${id}`"]);
    const methods = [...CLIENT.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(methods, ["DELETE", "PATCH", "POST"]);
  });

  it("65. sends no body with a delete", () => {
    const del = CLIENT.slice(CLIENT.indexOf("export async function deleteHomework"));
    assert.ok(!del.includes("body:"));
  });

  it("66. has no submission mutation", () => {
    assert.ok(!CLIENT.includes("submission"));
  });

  it("67. the form module reaches no network and no database", () => {
    for (const forbidden of ["fetch(", "Model", "dbConnect", "new Date"]) {
      assert.ok(!FORM.includes(forbidden), `${forbidden} has no place in the form rules`);
    }
  });
});

/* ------------------------------------------------------ mobile geometry */

/* WHY THESE EXIST. Gate 5 Phase 0 found the Homework index broken on a phone in
 * two ways that turned out to be one fault. The card grid asked for
 * `minmax(320px,1fr)`, and a minmax FLOOR is a hard minimum: the track keeps
 * that width even when its container is narrower. At <=860px the sidebar is a
 * 64px rail and .app-main pads 18px a side, so a 414px phone leaves a 314px
 * content box — and a 320px track overflowed it.
 *
 * That single overflow produced both reported symptoms. The visible one was the
 * page sitting wrong inside its own padding. The second only looked like a
 * drawer bug: the drawer never consumed layout width — it portals to <body> and
 * is position:fixed — but opening it runs useScrollLock, which sets
 * body{overflow:hidden} and so CLIPS the overflow the page had been showing.
 * The browser then re-laid the page out at the true viewport width, and the
 * header re-wrapped. The drawer was the trigger, not the cause.
 *
 * So these assertions pin the cause rather than the symptom: tracks that can
 * shrink, grid items that can shrink, and a page whose geometry never depends on
 * drawer state. No pixel snapshots — this project ships no DOM harness, and none
 * of these needs one. */

describe("Mobile geometry — the page cannot overflow its container", () => {
  it("68. every card grid track can shrink below its preferred width", () => {
    const tracks = [...PAGE.matchAll(/gridTemplateColumns:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tracks.length >= 2, "the card grid and its skeleton both declare a track");
    for (const track of tracks) {
      assert.ok(
        !/minmax\(\s*\d/.test(track),
        `"${track}" pins a hard pixel floor, which overflows a narrower container`
      );
      assert.match(track, /minmax\(\s*min\(/, "a track floor must be min(<preferred>,100%)");
    }
  });

  it("69. the real grid and the skeleton grid stay identical", () => {
    const tracks = [...PAGE.matchAll(/gridTemplateColumns:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(tracks).size, 1, "the loading state must not reflow into the ready state");
  });

  it("70. a card is a shrinkable grid item", () => {
    // Grid items default to min-width:auto and refuse to shrink below their own
    // content, which is the other way a long title reaches the page edge.
    assert.equal(homeworkCardStyle("var(--border-2)").minWidth, 0);
  });

  it("71. the page pins no fixed pixel width on a layout container", () => {
    const widths = [...PAGE.matchAll(/(?<![a-zA-Z])width:\s*(\d+)/g)].map((m) => Number(m[1]));
    // Only icon-sized boxes may carry a fixed width (action buttons, the error glyph).
    for (const w of widths) {
      assert.ok(w <= 60, `a ${w}px fixed width is a layout container, not an icon`);
    }
  });
});

describe("Mobile geometry — the drawer overlays instead of displacing", () => {
  it("72. the drawer leaves the page's layout entirely", () => {
    assert.ok(SHELL_DRAWER.includes("createPortal"), "it portals out of the page");
    assert.ok(SHELL_DRAWER.includes("document.body"), "and lands on <body>");
    assert.ok(SHELL_DRAWER.includes('position: "fixed"'), "so it is sized against the viewport");
  });

  it("73. the drawer panel is bounded by the viewport on a narrow screen", () => {
    assert.ok(SHELL_DRAWER.includes('width: "min(460px,94vw)"'), "never wider than the screen");
  });

  it("74. the drawer body scrolls inside the panel", () => {
    assert.ok(SHELL_DRAWER.includes('overflowY: "auto"'), "a tall form scrolls internally");
  });

  it("75. Homework uses the shared drawer and adds no panel of its own", () => {
    assert.ok(DRAWER.includes("<Drawer"));
    for (const bespoke of ["createPortal", 'position: "fixed"', "vw"]) {
      assert.ok(!DRAWER.includes(bespoke), `${bespoke} would be a second, divergent panel`);
    }
  });

  it("76. no page geometry is conditional on drawer or dialog state", () => {
    // The page may decide WHAT the drawer shows; it may never decide how the page
    // itself is laid out, or opening one would reflow the other.
    const geometry = /width|height|padding|margin|gridTemplate|flex|gap|position/;
    for (const line of PAGE.split("\n")) {
      if (!/drawerFor|prefill|confirm/.test(line)) continue;
      assert.ok(!geometry.test(line), `drawer state must not drive layout: ${line.trim()}`);
    }
  });
});
