/* Lessons — server-side data access, the runtime generation ("ensure") service
 * and the aggregate-root operations.
 *
 * Lesson is the aggregate root for everything lesson-related; future modules
 * (Attendance, Homework, Reviews, Billing, Reports) reference a lesson by id and
 * Lessons never depends on them.
 *
 * RUNTIME GENERATION is deliberately independent of the seed generator
 * (src/lib/generate.ts): the two share only the Regular-lesson id convention
 * `L-<classId>-<date>-<HHMM>` so their records never collide. `ensureRegularLessons`
 * is deterministic and idempotent — it creates only the *missing* Regular lessons
 * inside the configured rolling window and never overwrites, replaces, recreates
 * or mutates an existing lesson (so Cancelled / rescheduled / manually-edited
 * lessons are always preserved). Makeup and Extra lessons are never auto-generated.
 *
 * ENRICHMENT stays lightweight: list rows and the detail carry a little Class
 * information (name, colour, classroom, recurring schedule, student count) so the
 * client needs a single request; Student objects are never embedded — resolve
 * them from the related Class when a screen actually needs them.
 */

import "server-only";
import { dbConnect, isDupKey } from "./db";
import { ClassModel, LessonModel, StudentModel, mongoose } from "./models";
// The rolling-window, id and status helpers live in the pure recurrence core so
// this service and the (report-only) reconciliation planner cannot drift apart.
// Behaviour is unchanged — they were moved verbatim (see src/lib/recurrence.ts).
import {
  datesForWeekday, isPastDate, regularId, satisfiedRegularSlots, slotKey, statusForDate,
  windowMonths, TEACHING_CLASS_STATUSES,
} from "./recurrence";
import type { OccupancyLesson } from "./recurrence";
import { advanceLessonLifecycle } from "./lifecycle";
import type { Klass, Lesson, ScheduleSlot } from "./types";
import type {
  ExtraLessonInput, MakeupLessonInput, LessonRescheduleInput, LessonUpdateInput,
} from "./schemas";

const clean = "-_id -__v";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500; // the calendar pulls a whole month/week in one page

/* --------------------------------------------------------- ensure (generation) */

/** Top up Regular lessons for every Active class across the rolling window.
 * Idempotent: `$setOnInsert` keyed by the stable id inserts only what's missing
 * and never touches an existing lesson. Cheap enough to run on every read.
 *
 * INSERT-ONLY AND FORWARD-ONLY, deliberately (RECURRENCE_DESIGN §5.7). This is the
 * read side's only job: extend the rolling window forward as time passes. Nothing
 * dated before the app clock is ever created — see the guard in the loop below.
 * Correcting a lesson
 * whose slot MOVED, and removing one whose slot is GONE, belong to the write side
 * — `updateClass` -> `reconcileClass` (src/lib/reconciler.ts) — where the intent
 * actually changes. Keeping the two verbs off this path keeps list reads cheap
 * and keeps update/delete contention off a request that only wanted to read. */
export async function ensureRegularLessons(): Promise<void> {
  await dbConnect();
  const months = windowMonths();
  // The window as a date range, so the occupancy read stays bounded as the
  // collection grows. A lesson matters here if it SITS in the window or if it
  // vacated a slot inside it, hence the `$or` — a lesson rescheduled out of the
  // window still holds the slot it left (§5.6).
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-31`;
  const range = { $gte: from, $lte: to };

  const [classes, existing] = await Promise.all([
    // ACTIVE ONLY, as an allow-list. This used to read `{ $ne: "Archived" }`,
    // which was the same set while Archived was the only other status — and would
    // have quietly generated for an Ended class the moment a third one existed,
    // re-creating on the next list read exactly the future lessons the Ended
    // transition had just retired. The rule is "generate for classes that are
    // teaching", so it is written that way and derived from the one list that
    // says which those are.
    ClassModel.find({ status: { $in: [...TEACHING_CLASS_STATUSES] } }).select(clean).lean<Klass[]>(),
    LessonModel.find({ type: "regular", $or: [{ date: range }, { originalDate: range }] })
      .select("id classId type date start originalDate originalStart -_id")
      .lean<OccupancyLesson[]>(),
  ]);

  // Which slots already have a lesson standing in them, or were deliberately
  // vacated. Keyed on (classId, date, start) — NOT on the lesson id, which the
  // reconciler preserves across an in-place update and which therefore stops
  // matching the slot it was minted for (§5.7, ADR-001). `id` is read for one
  // reason only: `originClaim`'s defensive fallback for a legacy move that
  // carries no stored origin. Stored fields always win.
  const satisfied = satisfiedRegularSlots(existing);

  const ops: Parameters<typeof LessonModel.bulkWrite>[0] = [];
  for (const c of classes) {
    for (const month of months) {
      for (const slot of c.schedule ?? []) {
        for (const date of datesForWeekday(month, slot.day)) {
          // NEVER GENERATE INTO THE PAST.
          //
          // The window deliberately reaches back a month
          // (LESSON_WINDOW_PREVIOUS_MONTHS) so the occupancy read above can SEE the
          // lessons already stored there. That is not an instruction to CREATE
          // lessons there, and without this line it was read as one: every call
          // considered ~1.3 months of elapsed dates, so creating a class — or
          // adding a weekday to an existing one — back-filled them on the next list
          // read with lessons that `statusForDate` stamps `Completed`. Those then
          // earned revenue for sessions that were never taught, in months that were
          // already closed.
          //
          // This adds no new policy. It is the rule the write side already enforces
          // twice — `planDate` returns no actions for a past date, and `auditPlan`
          // aborts the whole run if one reaches it — so the guard makes the read
          // side agree with the reconciler instead of quietly disagreeing with it.
          // RECURRENCE_DESIGN §5.7: the read side's one job is to extend the window
          // FORWARD as time passes.
          //
          // Consequence worth naming: past this line `statusForDate(date)` below can
          // only ever return `Upcoming`. It is left as the call rather than folded
          // into the literal, so a generated lesson's status keeps one definition.
          if (isPastDate(date)) continue;
          if (satisfied.has(slotKey(c.id, date, slot.start))) continue;
          const id = regularId(c.id, date, slot.start);
          ops.push({
            updateOne: {
              filter: { id },
              update: {
                $setOnInsert: {
                  id,
                  classId: c.id,
                  type: "regular",
                  date,
                  start: slot.start,
                  duration: slot.duration,
                  classroom: c.classroom ?? "",
                  status: statusForDate(date),
                  chargeable: false,
                  fromId: null,
                  notes: "",
                } satisfies Lesson,
              },
              upsert: true,
            },
          });
        }
      }
    }
  }

  if (ops.length === 0) return;
  try {
    await LessonModel.bulkWrite(ops, { ordered: false });
  } catch (e) {
    // Concurrent ensures can race on the unique id; ignore only duplicate-key noise.
    if (!isDupKey(e)) throw e;
  }
}

/* ------------------------------------------------------------------- reads */

export interface LessonQuery {
  q?: string;
  status?: string;
  type?: string;
  classId?: string;
  from?: string; // ISO date lower bound (inclusive)
  to?: string; // ISO date upper bound (inclusive)
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
}

/** A lesson row with the lightweight Class fields the list/calendar render.
 * `classLevel` joins them so the calendar's drag-time conflict preview can name
 * the clashing lesson the way every other conflict message does ("Grammar Stars
 * · B1") without a second request. Read-time enrichment only — nothing is stored
 * on the Lesson. */
export interface LessonRow extends Lesson {
  className: string;
  classColor: string;
  classLevel: string;
}

export interface LessonListResult {
  rows: LessonRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** A lightweight, read-only view of an enrolled student for the drawer's roster.
 * Resolved server-side from the related Class — Student objects are never stored
 * on the Lesson itself. */
export interface LessonStudent {
  id: string;
  name: string;
  initials: string;
  gradeLabel: string;
  avatar: string | null;
  avatarColor: string;
}

/** The single-request payload the read-only drawer renders. */
export interface LessonDetail extends Lesson {
  className: string;
  classColor: string;
  classLevel: string;
  recurringSchedule: ScheduleSlot[];
  studentCount: number;
  students: LessonStudent[];
}

/** Which room a lesson PRESENTS.
 *
 * The Class owns where it meets, so a Regular lesson always shows the class's
 * current classroom: editing the class updates every lesson at once, and no
 * stored lesson is rewritten (generation still stamps its own copy through
 * `$setOnInsert`, untouched — this resolves at read time only). An ad-hoc lesson
 * keeps the room chosen when it was created, falling back to the class's. */
function classroomFor(l: Lesson, c: Klass | undefined): string {
  if (l.type === "regular") return c?.classroom ?? "";
  return l.classroom || c?.classroom || "";
}

function enrichRow(l: Lesson, classMap: Map<string, Klass>): LessonRow {
  const c = classMap.get(l.classId);
  return {
    ...l,
    classroom: classroomFor(l, c),
    className: c?.name ?? "—",
    classColor: c?.color ?? "var(--muted)",
    classLevel: c?.level ?? "",
  };
}

/** Date, then start time, then id — the stable ordering the list has always used
 * within a direction. The id tiebreak matters: without it two lessons sharing a
 * slot could swap places between requests and the pager would repeat or drop a
 * row. */
function byDateTime(a: LessonRow, b: LessonRow): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** How the Lesson List orders its rows.
 *
 * An Upcoming lesson is something still to be taught, so the list opens on the
 * NEAREST one and reads forward. A Completed or Cancelled lesson is history, and
 * history reads newest first — which is the order this list has always used and
 * the only order the imported design was drawn against.
 *
 * The two therefore cannot share one direction, so they are ordered as two
 * blocks: every Upcoming lesson ascending, then every historical one descending.
 * Under the status chips this is invisible — each chip shows a single block — and
 * on "All" it puts the next lesson at the top, which is what the screen is for.
 *
 * The whole filtered set is still sorted BEFORE it is paginated, which is what
 * keeps the pager correct: the blocks are a property of the ordering, not of a
 * page, so row 51 is the same lesson whether or not anyone asked for page 2.
 *
 * `status` is the signal rather than the date, so it agrees with the chip a
 * teacher just clicked. One consequence worth naming: a lesson still marked
 * Upcoming whose date has passed sorts to the very top. That is honest — nothing
 * advances a lesson's status as time passes (RECURRENCE_DESIGN §9.2), so such a
 * lesson genuinely is the most overdue thing on the list.
 *
 * An explicit `dir` keeps the old uniform date sort, so the documented
 * `GET /api/lessons?dir=` contract is unchanged for any caller that sends one. */
function orderRows(dir?: string): (a: LessonRow, b: LessonRow) => number {
  if (dir) {
    const sign = dir === "asc" ? 1 : -1;
    return (a, b) => byDateTime(a, b) * sign;
  }
  const rank = (r: LessonRow) => (r.status === "Upcoming" ? 0 : 1);
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return byDateTime(a, b) * (ra === 0 ? 1 : -1);
  };
}

/** Read the lesson list, reconciling Regular lessons first, then filtering /
 * sorting / paginating. Enriches each row with class name + colour only.
 *
 * LIFECYCLE RUNS BEFORE GENERATION. `advanceLessonLifecycle` resolves lessons
 * whose date has passed (`Upcoming` -> `Completed`, or `Cancelled` on an Archived
 * class); `ensureRegularLessons` extends the window forward. Advancing first means
 * a lesson resolved on this pass cannot also be considered by generation on the
 * same request, and the list and Calendar render the resolved status immediately
 * rather than one request late. The two are independent — the lifecycle never
 * creates a lesson and generation never changes one's status. */
export async function listLessons(query: LessonQuery = {}): Promise<LessonListResult> {
  await advanceLessonLifecycle();
  await ensureRegularLessons();

  const filter: Record<string, unknown> = {};
  if (query.classId) filter.classId = query.classId;
  if (query.status && query.status !== "All") filter.status = query.status;
  if (query.type && query.type !== "All") filter.type = query.type;
  if (query.from || query.to) {
    const range: Record<string, string> = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    filter.date = range;
  }

  const [lessons, classes] = await Promise.all([
    LessonModel.find(filter).select(clean).lean<Lesson[]>(),
    ClassModel.find().select(clean).lean<Klass[]>(),
  ]);
  const classMap = new Map(classes.map((c) => [c.id, c]));

  let rows = lessons.map((l) => enrichRow(l, classMap));

  // ---- search: class name + classroom (the fields visible on a row) ----
  const q = (query.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter((r) => [r.className, r.classroom].some((f) => String(f ?? "").toLowerCase().includes(q)));

  // ---- sort ----
  rows.sort(orderRows(query.dir));

  // ---- paginate ----
  const total = rows.length;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
  const start = (page - 1) * pageSize;

  return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
}

/** The enriched detail for one lesson (single request for the drawer). Resolves
 * the enrolled roster through the related Class (Lesson -> Class -> Student[]) as
 * read-only enrichment; no Student objects are ever stored on the Lesson. */
export async function getLessonDetail(id: string): Promise<LessonDetail | null> {
  await dbConnect();
  const l = await LessonModel.findOne({ id }).select(clean).lean<Lesson>();
  if (!l) return null;
  const c = await ClassModel.findOne({ id: l.classId }).select(clean).lean<Klass>();

  // Aggregate-root note: the Lesson owns no student data. The enrolled roster is
  // resolved read-only through the related Class (Lesson -> Class -> Student[]),
  // so Student objects are never denormalised onto the Lesson. If Lesson Detail
  // becomes performance-sensitive in a future sprint, a lightweight cached roster
  // (e.g. a per-class snapshot) could be considered — deliberately not done now.
  const ids = c?.studentIds ?? [];
  const students: LessonStudent[] = ids.length
    ? await StudentModel.find({ id: { $in: ids } })
        .select("id name initials gradeLabel avatar avatarColor -_id")
        .lean<LessonStudent[]>()
    : [];
  // Keep the class's enrolment order for a stable roster.
  const order = new Map(ids.map((sid, i) => [sid, i]));
  students.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    ...l,
    classroom: classroomFor(l, c ?? undefined),
    className: c?.name ?? "—",
    classColor: c?.color ?? "var(--muted)",
    classLevel: c?.level ?? "",
    recurringSchedule: c?.schedule ?? [],
    studentCount: students.length,
    students,
  };
}

/* -------------------------------------------------- aggregate-root operations */

/** Discriminated result so Route Handlers can map a failure to the right status. */
export type LessonOpResult =
  | { ok: true; lesson: LessonDetail }
  | { ok: false; reason: LessonOpError };

export type LessonOpError =
  | "not_found"
  | "class_not_found"
  | "not_one_on_one"
  | "origin_not_found"
  | "origin_not_regular"
  | "origin_not_cancelled"
  | "not_group"
  | "regular_not_deletable";

/** HTTP status + message for each operation error, so every Route Handler maps a
 * failure the same way (kept here as plain data — no framework coupling). */
export const LESSON_ERROR: Record<LessonOpError, { status: number; message: string }> = {
  not_found: { status: 404, message: "Lesson not found" },
  class_not_found: { status: 404, message: "Class not found" },
  origin_not_found: { status: 404, message: "Original lesson not found" },
  not_one_on_one: { status: 422, message: "Extra lessons are only for one-on-one classes" },
  not_group: { status: 422, message: "Makeup lessons are only for group classes" },
  origin_not_regular: { status: 422, message: "Only a regular lesson can have a makeup" },
  origin_not_cancelled: { status: 422, message: "A makeup replaces a cancelled lesson" },
  regular_not_deletable: { status: 409, message: "Regular lessons can't be deleted — cancel it instead" },
};

function newId(): { _id: mongoose.Types.ObjectId; id: string } {
  const _id = new mongoose.Types.ObjectId();
  return { _id, id: _id.toString() };
}

/** Create an Extra session on a one-on-one class. */
export async function createExtraLesson(input: ExtraLessonInput): Promise<LessonOpResult> {
  await dbConnect();
  const c = await ClassModel.findOne({ id: input.classId }).select(clean).lean<Klass>();
  if (!c) return { ok: false, reason: "class_not_found" };
  if (c.type !== "one-on-one") return { ok: false, reason: "not_one_on_one" };

  const { _id, id } = newId();
  const doc: Lesson = {
    id, classId: c.id, type: "extra", date: input.date, start: input.start, duration: input.duration,
    classroom: (input.classroom || c.classroom || "").trim(), status: statusForDate(input.date),
    chargeable: false, fromId: null, notes: (input.notes ?? "").trim(),
  };
  await LessonModel.create({ _id, ...doc });
  return { ok: true, lesson: (await getLessonDetail(id))! };
}

/** Create a Makeup that replaces a cancelled Regular lesson on a group class. */
export async function createMakeupLesson(fromId: string, input: MakeupLessonInput): Promise<LessonOpResult> {
  await dbConnect();
  const origin = await LessonModel.findOne({ id: fromId }).select(clean).lean<Lesson>();
  if (!origin) return { ok: false, reason: "origin_not_found" };
  if (origin.type !== "regular") return { ok: false, reason: "origin_not_regular" };
  if (origin.status !== "Cancelled") return { ok: false, reason: "origin_not_cancelled" };
  const c = await ClassModel.findOne({ id: origin.classId }).select(clean).lean<Klass>();
  if (!c) return { ok: false, reason: "class_not_found" };
  if (c.type !== "group") return { ok: false, reason: "not_group" };

  const { _id, id } = newId();
  const doc: Lesson = {
    id, classId: origin.classId, type: "makeup", date: input.date,
    start: input.start || origin.start, duration: input.duration || origin.duration,
    classroom: (input.classroom ?? origin.classroom ?? "").trim(), status: statusForDate(input.date),
    chargeable: false, fromId: origin.id, notes: (input.notes ?? "").trim(),
  };
  await LessonModel.create({ _id, ...doc });
  return { ok: true, lesson: (await getLessonDetail(id))! };
}

/** Move a lesson to a new date (and optionally a new time / duration).
 *
 * The move also records WHERE THE LESSON CAME FROM, so a rescheduled lesson can
 * be told apart from an ordinary recurring one without consulting the class:
 *
 *  - the origin is stamped ONCE, on the first move, and carried unchanged by
 *    every later move — a lesson dragged Sat → Fri → Thu still reports Saturday,
 *    which is the slot its schedule actually generates;
 *  - moving a lesson back onto its origin clears the stamp, because a lesson
 *    sitting in its generated slot is not rescheduled, whatever its history;
 *  - the fields live on the Lesson, which owns its own schedule data. Nothing is
 *    copied from the Class and no existing field changes meaning.
 *
 * `rescheduledAt` is the one value here that records an ACTION rather than a
 * slot, so unlike the origin it is rewritten by every move: it answers "when was
 * this last changed?", which only the newest move can answer. It uses the real
 * wall clock, not the app clock (TODAY_ISO) — the app clock dates the teaching
 * timetable, and dating an edit with it would claim the edit happened in the
 * demo's past. No actor is recorded (see Lesson.rescheduledAt).
 *
 * Status, attendance and billing are untouched: rescheduling moves a lesson, it
 * does not re-classify it. */
export async function rescheduleLesson(id: string, input: LessonRescheduleInput): Promise<LessonOpResult> {
  await dbConnect();
  const existing = await LessonModel.findOne({ id }).select(clean).lean<Lesson>();
  if (!existing) return { ok: false, reason: "not_found" };

  const next = {
    date: input.date,
    start: input.start || existing.start,
    duration: input.duration || existing.duration,
  };
  const origin = existing.originalDate
    ? {
        date: existing.originalDate,
        start: existing.originalStart ?? existing.start,
        duration: existing.originalDuration ?? existing.duration,
      }
    : { date: existing.date, start: existing.start, duration: existing.duration };

  const backHome =
    origin.date === next.date && origin.start === next.start && origin.duration === next.duration;

  await LessonModel.updateOne(
    { id },
    backHome
      ? {
          $set: next,
          $unset: {
            originalDate: "", originalStart: "", originalDuration: "", rescheduledAt: "",
          },
        }
      : {
          $set: {
            ...next,
            originalDate: origin.date,
            originalStart: origin.start,
            originalDuration: origin.duration,
            rescheduledAt: new Date().toISOString(),
          },
        }
  );
  return { ok: true, lesson: (await getLessonDetail(id))! };
}

/** Cancel a lesson (optionally keeping it chargeable for revenue). */
export async function cancelLesson(id: string, chargeable: boolean): Promise<LessonOpResult> {
  await dbConnect();
  const existing = await LessonModel.findOne({ id }).select("id").lean();
  if (!existing) return { ok: false, reason: "not_found" };
  await LessonModel.updateOne({ id }, { $set: { status: "Cancelled", chargeable } });
  return { ok: true, lesson: (await getLessonDetail(id))! };
}

/** Patch editable lesson fields only (notes / classroom). */
export async function updateLesson(id: string, input: LessonUpdateInput): Promise<LessonOpResult> {
  await dbConnect();
  const existing = await LessonModel.findOne({ id }).select("id").lean();
  if (!existing) return { ok: false, reason: "not_found" };
  const set: Record<string, unknown> = {};
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.classroom !== undefined) set.classroom = input.classroom;
  if (Object.keys(set).length > 0) await LessonModel.updateOne({ id }, { $set: set });
  return { ok: true, lesson: (await getLessonDetail(id))! };
}

/** Permanently delete a lesson — allowed for Extra/Makeup only. Regular lessons
 * are historical records generated from the schedule and are never deleted (they
 * may only be Cancelled), which also keeps the ensure service from resurrecting
 * a removed Regular. */
export async function deleteLesson(id: string): Promise<{ ok: true } | { ok: false; reason: LessonOpError }> {
  await dbConnect();
  const existing = await LessonModel.findOne({ id }).select("type").lean<Pick<Lesson, "type">>();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.type === "regular") return { ok: false, reason: "regular_not_deletable" };
  await LessonModel.deleteOne({ id });
  return { ok: true };
}
