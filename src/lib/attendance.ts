/* Attendance — the PURE core.
 *
 * WHAT THIS IS. Everything Attendance decides, expressed as functions over plain
 * values: which lessons may be marked, who is on the register, what a register
 * summarises to, what the index screen shows, and — the one that matters most —
 * exactly what a save is allowed to write. Nothing here connects to a database.
 *
 * WHY THE SPLIT. The live Attendance collection contains records carrying entries
 * for students whose documents no longer exist. Those entries are the only record
 * that those lessons were ever taught to those people, they are invisible to the
 * UI (the roster cannot resolve them), and a save that replaced the `entries`
 * object would erase all of them silently. `planAttendanceWrite` therefore returns
 * the update as DATA rather than performing it, so a test can assert precisely
 * which keys a save touches without a database in the loop — see
 * tests/attendance.test.ts. The executor (src/lib/attendance-service.ts) does
 * nothing but hand that plan to Mongo.
 *
 * NO `server-only`, for the same reason src/lib/lifecycle.ts has none: the pure
 * decisions are exercised by the test runner, which cannot resolve that module.
 * Nothing here is imported by a client component for its behaviour — the payload
 * TYPES are shared with the client, which costs nothing at runtime.
 */

import { TODAY_ISO } from "./constants";
import { attendanceRate } from "./finance";
import type {
  AttendanceEntry, AttendanceRecord, AttendanceStatus, Klass, Lesson, LessonType, Student,
} from "./types";

/* ------------------------------------------------------------- what counts */

/** The three lesson types that support attendance (PROJECT_RULES, Lesson Types).
 * `satisfies` ties it to LessonType so a value that is not a lesson type cannot
 * be listed here; a fourth type that is NOT listed fails closed as
 * `unsupported_type`, which is the safe direction. */
export const ATTENDANCE_LESSON_TYPES = ["regular", "makeup", "extra"] as const satisfies readonly LessonType[];

/** Which statuses mean the student was there. Present / Late / Excused are all
 * "attended" and all fully chargeable; Absent is the only status that withholds
 * a student's contribution. This mirrors `computeRevenue` and `attendanceRate`
 * (src/lib/finance.ts) — it does NOT redefine them, and neither is touched. */
const ATTENDED: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>(["Present", "Late", "Excused"]);

/** How many of the most recent past lessons the index lists. 8 is the count the
 * imported design's own placeholder hint carries (`hint-placeholder-count="8"`),
 * and the screen has no pager, so this is the whole list. */
export const RECENT_LIMIT = 8;

/* --------------------------------------------------------------- eligibility */

export type AttendanceEligibleKind = "completed" | "today";

export type AttendanceIneligibleReason =
  | "future"
  | "cancelled"
  | "unsupported_status"
  | "unsupported_type";

/** Discriminated so a caller cannot read `kind` off a rejection, or a `reason`
 * off an acceptance, without the compiler noticing. */
export type AttendanceEligibility =
  | { eligible: true; kind: AttendanceEligibleKind }
  | { eligible: false; reason: AttendanceIneligibleReason };

const eligible = (kind: AttendanceEligibleKind): AttendanceEligibility => ({ eligible: true, kind });
const rejected = (reason: AttendanceIneligibleReason): AttendanceEligibility => ({ eligible: false, reason });

/** May attendance be taken for this lesson?
 *
 * THE SINGLE AUTHORITY. The API enforces this independently of the UI, because
 * hiding a button is not a rule — a stale tab or a hand-made request must be
 * refused by the same function that decided not to draw the button.
 *
 * FAILS CLOSED. A lesson is eligible only when it positively proves it is: a
 * supported type, not cancelled, not in the future, and then either already
 * Completed or sitting on today's date while still Upcoming. Everything else — an
 * unknown status from a hand-edited document, a Regular lesson whose date has
 * passed but which the lifecycle has not yet resolved, a type this module has
 * never heard of — returns a rejection, and nothing is written.
 *
 * ORDER IS PART OF THE RULE, not an implementation detail:
 *
 *   1. unsupported type   — a type we do not model has no attendance semantics
 *   2. Cancelled          — outside the MVP whether or not it is chargeable
 *   3. future date        — INCLUDING a lesson somehow already marked Completed;
 *                           a future Completed lesson is a data fault, and the
 *                           honest answer is "not yet", not "go ahead"
 *   4. Completed          — the ordinary historical case
 *   5. today + Upcoming   — today is not past (the `isPastDate` convention), so
 *                           the lesson is still Upcoming while it is being taught
 *   6. otherwise          — unsupported_status, the fail-closed floor
 *
 * `appClock` defaults to the app clock (TODAY_ISO) so callers cannot introduce a
 * second time source, and tests can inject one. Dates are ISO "YYYY-MM-DD", so
 * string comparison IS date comparison. */
export function attendanceEligibilityFor(
  lesson: Pick<Lesson, "type" | "status" | "date">,
  appClock: string = TODAY_ISO
): AttendanceEligibility {
  if (!(ATTENDANCE_LESSON_TYPES as readonly string[]).includes(lesson.type)) return rejected("unsupported_type");
  if (lesson.status === "Cancelled") return rejected("cancelled");
  if (lesson.date > appClock) return rejected("future");
  if (lesson.status === "Completed") return eligible("completed");
  if (lesson.date === appClock && lesson.status === "Upcoming") return eligible("today");
  return rejected("unsupported_status");
}

/* -------------------------------------------------------------------- errors */

export type AttendanceOpError = "not_found" | "class_not_found" | "not_eligible" | "invalid_student";

/** HTTP status + message per failure, so every Route Handler maps one the same
 * way. Plain data, no framework coupling — the shape, and the wording of the two
 * "not found" cases, are lifted from LESSON_ERROR (src/lib/lessons.ts) so the two
 * modules answer the same question with the same sentence. */
export const ATTENDANCE_ERROR: Record<AttendanceOpError, { status: number; message: string }> = {
  not_found: { status: 404, message: "Lesson not found" },
  class_not_found: { status: 404, message: "Class not found" },
  not_eligible: { status: 422, message: "Attendance isn't available for this lesson" },
  invalid_student: { status: 422, message: "That student isn't on this lesson's register" },
};

/* -------------------------------------------------------------------- roster */

/** A student as the register renders them. Resolved from the Class's roster
 * against real Student documents — Attendance stores no copy of any of this. */
export interface RegisterStudent {
  id: string;
  name: string;
  initials: string;
  gradeLabel: string;
  avatar: string | null;
  avatarColor: string;
}

/** Who is on this lesson's register: lesson -> class -> class.studentIds ->
 * existing Student documents, in the class's own order.
 *
 * "RESOLVABLE" MEANS THE DOCUMENT EXISTS — nothing else. Student.status is
 * deliberately NOT consulted, so a Trial, Paused or Archived student still
 * appears: they are enrolled, the lesson is being taught to them, and a teacher
 * marking a register needs to see the people in the room. This differs from
 * `computeRevenue`, which drops Archived students; that mismatch is real, is
 * recorded as deferred debt, and is NOT resolved by quietly aligning this side to
 * the finance side.
 *
 * A roster id with no Student document is simply absent — it is not repaired, not
 * reported and not written back. Its stored attendance entry, if any, stays
 * exactly where it is (see `planAttendanceWrite`). */
export function resolveRoster(
  studentIds: readonly string[] | null | undefined,
  students: readonly Student[]
): RegisterStudent[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: RegisterStudent[] = [];
  for (const id of studentIds ?? []) {
    if (seen.has(id)) continue; // a roster listing an id twice is still one seat
    seen.add(id);
    const s = byId.get(id);
    if (!s) continue;
    out.push({
      id: s.id,
      name: s.name,
      initials: s.initials,
      gradeLabel: s.gradeLabel,
      avatar: s.avatar ?? null,
      avatarColor: s.avatarColor,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ register */

export interface RegisterRow extends RegisterStudent {
  status: AttendanceStatus;
  note: string;
  /** Was this row read from a stored entry, or is it the default? Presentation
   * and tests only — the save treats both identically. */
  saved: boolean;
}

function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return v === "Present" || v === "Absent" || v === "Late" || v === "Excused";
}

/** The register as the screen opens it.
 *
 * THE DEFAULT IS A READ, NOT A WRITE. Where no entry is stored a student is
 * Present with an empty note, because that is what PROJECT_RULES already says a
 * missing register means for revenue — "where none exists, every enrolled student
 * is treated as present". Building the rows persists nothing: opening a lesson
 * and walking away leaves zero Attendance documents behind.
 *
 * A stored entry carrying a status this app does not recognise falls back to the
 * default rather than reaching a screen as a blank segmented control. The row is
 * still marked `saved`, so nothing pretends the record is absent. */
export function buildRegisterRows(
  roster: readonly RegisterStudent[],
  entries: Readonly<Record<string, AttendanceEntry>> | null | undefined
): RegisterRow[] {
  const stored = entries ?? {};
  return roster.map((s) => {
    const hit = Object.prototype.hasOwnProperty.call(stored, s.id) ? stored[s.id] : undefined;
    return {
      ...s,
      status: isAttendanceStatus(hit?.status) ? hit.status : "Present",
      note: typeof hit?.note === "string" ? hit.note : "",
      saved: hit !== undefined,
    };
  });
}

export interface RegisterSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Present + Late + Excused. */
  attended: number;
  total: number;
  /** Percent attended, or `null` when there is nobody to attend. */
  rate: number | null;
}

/** Summarise the register that is ON SCREEN — the visible rows, live, including
 * unsaved edits.
 *
 * DELIBERATELY NOT `attendanceRate()`. That function answers a monthly reporting
 * question over every stored entry of every Completed lesson in a month, hidden
 * orphan entries included. This one answers "what does this lesson's register say
 * right now". The denominators are different on purpose, and the two formulas are
 * never unified — `attendanceRate` is untouched by this sprint.
 *
 * An empty roster rates `null`, not 0%. Nobody was absent from a lesson with no
 * students; 0% would be a claim, and there is nothing to claim. */
export function summarizeRegister(rows: readonly Pick<RegisterRow, "status">[]): RegisterSummary {
  let present = 0, late = 0, absent = 0, excused = 0, attended = 0;
  for (const r of rows) {
    if (r.status === "Present") present++;
    else if (r.status === "Late") late++;
    else if (r.status === "Absent") absent++;
    else if (r.status === "Excused") excused++;
    if (ATTENDED.has(r.status)) attended++;
  }
  const total = rows.length;
  return {
    present, late, absent, excused, attended, total,
    rate: total === 0 ? null : Math.round((attended / total) * 100),
  };
}

/* -------------------------------------------------------------- write planner */

/** What one submitted student carries. `note` is optional and never invented. */
export interface SubmittedEntry {
  status: AttendanceStatus;
  note?: string;
}

/** The Mongo update, as data. `$set` is absent when nothing was submitted (an
 * empty `$set` is not a legal update), so an explicit save on an empty register
 * still creates the record through `$setOnInsert` alone. */
export interface AttendanceWritePlan {
  filter: { lessonId: string };
  update: {
    $set?: Record<string, AttendanceEntry>;
    $setOnInsert: { lessonId: string };
  };
  upsert: true;
}

export type AttendanceWritePlanResult =
  | { ok: true; plan: AttendanceWritePlan }
  | { ok: false; reason: "invalid_student"; invalidIds: string[] };

/** Plan the one and only write Attendance ever performs.
 *
 * PER-STUDENT PATHS, NEVER THE WHOLE OBJECT. Every key is written as
 * `entries.<studentId>`, so a student the register never showed is not mentioned
 * by the update at all and Mongo leaves their stored entry untouched. Assigning
 * `entries` wholesale would take the live records that carry entries for deleted
 * students down with it, permanently and silently. That is the single
 * highest-value invariant in this module, and it is asserted from both ends: that
 * hidden keys never appear in the emitted paths, and that a submitted key is
 * emitted as a complete object.
 *
 * A SUBMITTED STUDENT'S ENTRY IS REPLACED WHOLE, not patched field by field.
 * `entries.s2 = { status: "Late" }` rather than `entries.s2.status = "Late"`,
 * because clearing a note has to actually clear it — a nested `$set` on `.status`
 * would leave last month's note stranded on the document, with no way to remove
 * it that does not also risk `$unset` reaching further than intended. Replacing
 * one key is the smallest operation that clears a note and preserves every
 * sibling.
 *
 * MEMBERSHIP IS SEMANTIC, SO IT IS ENFORCED HERE. Zod validates the SHAPE of the
 * payload; it cannot know who is on a roster. An id outside the currently visible
 * set fails the WHOLE request with zero writes — never a partial save with the
 * offending key quietly dropped, which would report success for something that
 * did not happen. This is also what stops a stale or hostile client from
 * addressing a hidden orphan entry by name.
 *
 * Keys are emitted in sorted order so the same payload always produces an
 * identical plan, which is what makes "saving twice changes nothing" testable. */
export function planAttendanceWrite(
  lessonId: string,
  visibleIds: Iterable<string>,
  submitted: Readonly<Record<string, SubmittedEntry>>
): AttendanceWritePlanResult {
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
  const ids = Object.keys(submitted).sort();

  const invalidIds = ids.filter((id) => !visible.has(id));
  if (invalidIds.length > 0) return { ok: false, reason: "invalid_student", invalidIds };

  const set: Record<string, AttendanceEntry> = {};
  for (const id of ids) {
    const e = submitted[id];
    // A note is carried only when there is one. An empty note is the ABSENCE of a
    // note, so it is written as an entry without the field rather than as an empty
    // string — and because the whole entry is replaced, that is what removes a
    // stale one. Non-empty text is preserved exactly: not trimmed, not truncated,
    // not normalised. Teachers write Vietnamese here.
    set[`entries.${id}`] = e.note ? { status: e.status, note: e.note } : { status: e.status };
  }

  return {
    ok: true,
    plan: {
      filter: { lessonId },
      // `lessonId` and nothing else. No `date` — the Lesson owns the date, and
      // AttendanceRecord.date is a legacy field this module never writes. No
      // createdAt/updatedAt — the schema carries no timestamps, and inventing one
      // would put a fabricated "Last updated" in front of a teacher.
      update: { ...(ids.length > 0 ? { $set: set } : {}), $setOnInsert: { lessonId } },
      upsert: true,
    },
  };
}

/* --------------------------------------------------------------- index payload */

export interface AttendanceStatCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

export interface AttendanceMonthSummary extends AttendanceStatCounts {
  /** `attendanceRate()` for the month, unchanged. */
  rate: number;
  /** Entries counted, i.e. the rate's denominator. 0 means "no data yet". */
  entries: number;
}

export interface AttendanceClassRate {
  classId: string;
  name: string;
  color: string;
  rate: number;
}

/** One lesson as the index renders it, in Today and in Recent alike — the two
 * sections of the design draw the same facts in two shapes. */
export interface AttendanceLessonCard {
  lessonId: string;
  classId: string;
  className: string;
  color: string;
  date: string;
  start: string;
  duration: number;
  classroom: string;
  type: LessonType;
  /** Roster students whose documents exist — what the register will show. */
  studentCount: number;
  /** Is there a stored AttendanceRecord? Drives Take vs Edit. */
  taken: boolean;
  /** The stored register's own rate, or `null` when nothing is stored. The
   * design's indicator has no "Taken" label to render, so a taken lesson shows
   * the figure it actually has. */
  rate: number | null;
}

export interface AttendanceIndexPayload {
  month: string;
  todayIso: string;
  summary: AttendanceMonthSummary;
  byClass: AttendanceClassRate[];
  today: AttendanceLessonCard[];
  recent: AttendanceLessonCard[];
}

export interface AttendanceIndexInput {
  classes: readonly Klass[];
  /** Only ids are read — this resolves roster membership, nothing more. */
  students: readonly Pick<Student, "id">[];
  /** Must cover the month AND the most recent past Completed lessons. */
  lessons: readonly Lesson[];
  /** Not `readonly`, unlike its neighbours: this array is forwarded verbatim to
   * `attendanceRate()`, whose signature is part of the frozen finance module and
   * takes a mutable array. Copying it just to satisfy variance would be waste;
   * nothing here mutates it. */
  attendance: AttendanceRecord[];
}

const inMonth = (iso: string, month: string) => iso.startsWith(month);

/** Which room a lesson PRESENTS.
 *
 * The same rule `src/lib/lessons.ts` applies (`classroomFor`): a Regular lesson
 * shows its class's current classroom, an ad-hoc lesson keeps the room chosen
 * when it was created. Restated here rather than imported because that module is
 * `server-only` — unreachable from this pure core and from the test runner — and
 * is frozen for this sprint. The alternative was to read `lesson.classroom` raw,
 * which would show a different room on the Attendance screen than the Lessons
 * list and the Calendar show for the same lesson.
 *
 * TODO(classroom): lift this into a module both sides can import the next time
 * `lessons.ts` is open for change. */
function classroomFor(l: Pick<Lesson, "type" | "classroom">, c: Klass | undefined): string {
  if (l.type === "regular") return c?.classroom ?? "";
  return l.classroom || c?.classroom || "";
}

/** A stored register's own rate, over the entries it actually holds — hidden
 * orphan entries included, because they are part of what was recorded. `null` for
 * an empty register, for the same reason `summarizeRegister` returns null. */
function storedRate(rec: AttendanceRecord): number | null {
  const keys = Object.keys(rec.entries ?? {});
  if (keys.length === 0) return null;
  let attended = 0;
  for (const k of keys) {
    const st = rec.entries[k]?.status;
    if (isAttendanceStatus(st) && ATTENDED.has(st)) attended++;
  }
  return Math.round((attended / keys.length) * 100);
}

function cardFor(
  l: Lesson,
  classById: Map<string, Klass>,
  studentIds: ReadonlySet<string>,
  recordByLesson: Map<string, AttendanceRecord>
): AttendanceLessonCard {
  const c = classById.get(l.classId);
  const rec = recordByLesson.get(l.id);
  // The count is what the register will actually render, so it is the RESOLVABLE
  // roster — a dangling id is not a student and is not counted.
  const roster = new Set((c?.studentIds ?? []).filter((id) => studentIds.has(id)));
  return {
    lessonId: l.id,
    classId: l.classId,
    className: c?.name ?? "—",
    color: c?.color ?? "var(--muted)",
    date: l.date,
    start: l.start,
    duration: l.duration,
    classroom: classroomFor(l, c),
    type: l.type,
    studentCount: roster.size,
    taken: rec !== undefined,
    rate: rec ? storedRate(rec) : null,
  };
}

/** Build the whole Attendance index screen's payload.
 *
 * PURE, so every rule the screen embodies is testable without a database: which
 * lessons reach Today, which reach Recent, how many, in what order, and which
 * classes appear in the by-class list at all.
 *
 * The caller is responsible only for supplying lessons that COVER what is asked
 * for (the month, plus enough recent history); this function does the selecting,
 * so a wider query cannot change the answer. */
export function buildAttendanceIndex(
  input: AttendanceIndexInput,
  month: string,
  appClock: string = TODAY_ISO
): AttendanceIndexPayload {
  const { classes, students, lessons, attendance } = input;
  const classById = new Map(classes.map((c) => [c.id, c]));
  const studentIds = new Set(students.map((s) => s.id));
  const recordByLesson = new Map(attendance.map((a) => [a.lessonId, a]));

  const monthLessons = lessons.filter((l) => inMonth(l.date, month));

  /* ---- This month ----------------------------------------------------- */

  // `attendanceRate` unchanged, over the month's lessons. It counts entries of
  // COMPLETED lessons only, so the four status counts below are taken over
  // exactly the same set — one denominator, two presentations.
  const rate = attendanceRate(month, { lessons: monthLessons, attendance });

  const countedLessonIds = new Set(
    monthLessons.filter((l) => l.status === "Completed").map((l) => l.id)
  );
  const counts: AttendanceStatCounts = { present: 0, late: 0, absent: 0, excused: 0 };
  let entries = 0;
  for (const rec of attendance) {
    if (!countedLessonIds.has(rec.lessonId)) continue;
    for (const sid of Object.keys(rec.entries ?? {})) {
      entries++;
      const st = rec.entries[sid]?.status;
      if (st === "Present") counts.present++;
      else if (st === "Late") counts.late++;
      else if (st === "Absent") counts.absent++;
      else if (st === "Excused") counts.excused++;
    }
  }

  /* ---- Attendance by class -------------------------------------------- */

  // ONLY CLASSES WITH REAL DATA. A class with no register this month is absent
  // from the list, never shown as 0% — 0% reads as "nobody turned up", which is a
  // statement about people, and the truth is that nothing has been recorded.
  const byClass: AttendanceClassRate[] = [];
  for (const c of classes) {
    const classLessons = monthLessons.filter((l) => l.classId === c.id);
    const hasData = classLessons.some((l) => {
      if (l.status !== "Completed") return false;
      const rec = recordByLesson.get(l.id);
      return rec ? Object.keys(rec.entries ?? {}).length > 0 : false;
    });
    if (!hasData) continue;
    byClass.push({
      classId: c.id,
      name: c.name,
      color: c.color,
      // The same formula, over this class's lessons. Not a second formula.
      rate: attendanceRate(month, { lessons: classLessons, attendance }),
    });
  }
  // Highest first, then by name — the ordering `computeRevenue().perClass`
  // already uses for a derived per-class list.
  byClass.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));

  /* ---- Today ----------------------------------------------------------- */

  // Eligibility decides, not the date alone: a lesson cancelled today has no
  // register to take, so it does not appear as something to do.
  const today = lessons
    .filter((l) => l.date === appClock && attendanceEligibilityFor(l, appClock).eligible)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map((l) => cardFor(l, classById, studentIds, recordByLesson));

  /* ---- Recent ---------------------------------------------------------- */

  // Past and Completed, all three types, newest first, capped. Today is never
  // "recent" — it has its own section — and an Upcoming lesson whose date has
  // passed is not here either: it is unresolved, and the lifecycle owns that.
  const recent = lessons
    .filter((l) => l.date < appClock && l.status === "Completed")
    .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start) || b.id.localeCompare(a.id))
    .slice(0, RECENT_LIMIT)
    .map((l) => cardFor(l, classById, studentIds, recordByLesson));

  return {
    month,
    todayIso: appClock,
    summary: { ...counts, rate, entries },
    byClass,
    today,
    recent,
  };
}

/* ------------------------------------------------------------ register payload */

/** What GET/POST /api/attendance/:lessonId return.
 *
 * The lesson's date is the LESSON's date — `AttendanceRecord.date` is legacy and
 * is never read. Hidden orphan entries are never exposed. No timestamp is
 * returned, because none is stored and a fabricated one would be worse than
 * none. */
export interface AttendanceRegisterPayload {
  lesson: {
    id: string;
    date: string;
    start: string;
    duration: number;
    type: LessonType;
    status: Lesson["status"];
    classroom: string;
  };
  klass: { id: string; name: string; color: string };
  rows: RegisterRow[];
  register: { exists: boolean };
  summary: RegisterSummary;
}

/** Assemble the register payload from records already read. Pure, so the read
 * path's shape is testable without a database. */
export function buildRegisterPayload(
  lesson: Lesson,
  klass: Klass,
  students: readonly Student[],
  record: AttendanceRecord | null
): AttendanceRegisterPayload {
  const roster = resolveRoster(klass.studentIds, students);
  const rows = buildRegisterRows(roster, record?.entries);
  return {
    lesson: {
      id: lesson.id,
      date: lesson.date,
      start: lesson.start,
      duration: lesson.duration,
      type: lesson.type,
      status: lesson.status,
      classroom: classroomFor(lesson, klass),
    },
    klass: { id: klass.id, name: klass.name, color: klass.color },
    rows,
    register: { exists: record !== null },
    summary: summarizeRegister(rows),
  };
}
