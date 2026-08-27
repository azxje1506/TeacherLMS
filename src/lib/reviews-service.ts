/* Reviews — the DB-bound service.
 *
 * Every Review database access in the application lives in this file, and every
 * DECISION it acts on lives in src/lib/reviews.ts. The split is the one
 * Attendance and Homework already draw, for the same reason: "which document
 * does this write, and which keys does it touch?" is only provably correct if it
 * is computed somewhere a test can reach. So the pure core plans, and this
 * module hands the plan to Mongo, unmodified.
 *
 * WHAT THIS MODULE MAY WRITE: `ReviewModel`, and nothing else. Student, Parent,
 * Class, Lesson, Attendance, Homework and Billing are never written here —
 * Student and Parent are read, and only read, because a review's card needs a
 * name and needs to know whether a parent actually resolves.
 *
 * TWO WRITE VERBS, EACH USED ONCE: `create` on POST, and one `updateOne` with a
 * `$set` of at most six planned keys on PATCH. No `deleteOne`, no `deleteMany`,
 * no `updateMany`, no `replaceOne`, no `bulkWrite`, no upsert, and no write of
 * any kind on a read path. Sprint 8 has no Review delete: there is no designed
 * surface for one, and a review is a historical record of a month.
 *
 * NO LIFECYCLE, NO RECURRENCE, NO `repo.getAll()`. A review is about a student's
 * month, not about lessons, so nothing here advances a lesson lifecycle,
 * reconciles, generates, or pulls the whole database to answer one screen.
 *
 * THE APPLICATION MONTH IS `CURRENT_MONTH`, read here and passed DOWN into the
 * pure helpers as an argument. That is the app clock the rest of the server
 * already uses (see src/lib/attendance-service.ts); `new Date()` appears
 * nowhere, so no second source of time can disagree with it. It is a boundary
 * and a default for the CLIENT to display — a create still carries an explicit
 * `month`, and the planner reads that field and only that field.
 *
 * NO INDEX IS DECLARED, HERE OR IN models.ts. Uniqueness of (studentId, month)
 * is enforced by the service's own check below, and a duplicate-key error from
 * the database is mapped to the SAME domain outcome, so the day the compound
 * index is authorised (Gate 5) nothing in this file has to change.
 */

import "server-only";
import { dbConnect, isDupKey } from "./db";
import {
  AttendanceModel, ClassModel, HomeworkModel, LessonModel,
  ParentModel, ReviewModel, StudentModel, mongoose,
} from "./models";
import { CURRENT_MONTH, TODAY_ISO } from "./constants";
import {
  studentAttendanceRate, studentHomeworkCompletion,
  type StudentAttendanceRate, type StudentHomeworkCompletion,
} from "./finance";
import { buildReviewAnalytics, type ReviewAnalytics } from "./review-analytics";
import {
  buildReviewCards, buildReviewHistory, canReviewStudent, firstUntakenMonth, isParentLinked,
  planReviewCreate, planReviewUpdate, reviewAverage, reviewMonthOptions,
  type ReviewCard, type ReviewMonthOption, type ReviewOpError,
} from "./reviews";
import type {
  ReviewComposerData, ReviewComposerMonth, ReviewComposerParent, ReviewHistoryEntry,
} from "./review-report";
import type { ReviewCreateBody, ReviewUpdateBody } from "./schemas";
import type { AttendanceRecord, Homework, Klass, Lesson, Parent, Review, Student } from "./types";

const clean = "-_id -__v";

/* --------------------------------------------------------------------- DTOs */

/** One review as a client may read it.
 *
 * `average` is DERIVED on the way out and never stored (see `reviewAverage`).
 * There is no status, no `createdAt` and no `updatedAt`, because a Review
 * document has none — a derived "last updated" would be a guess presented to a
 * teacher as a fact. `_id` and `__v` are stripped by the projection, so no
 * internal Mongo identity reaches the wire. */
export interface ReviewDetail {
  id: string;
  studentId: string;
  month: string;
  skills: Record<string, number>;
  average: number;
  comment: string;
  strengths: string;
  improvements: string;
  goals: string;
  parentNotes: string;
}

/** The Reviews index payload: one card per reviewable student, plus the
 * application month the screen writes for by default. No review history is
 * carried — a card needs a count and a latest average, not a list. */
export interface ReviewCardsPayload {
  month: string; // the application month (CURRENT_MONTH)
  cards: ReviewCard[];
}

/** One month of a student's cross-domain context, derived read-only.
 *
 * BOTH PERCENTAGES MAY BE `null`, AND THAT IS NOT ZERO. `null` means the
 * denominator was empty — no register was taken, or no homework outcome was
 * recorded — which is a different fact from "attended nothing" or "did nothing".
 * Every consumer branches on it; nothing renders 0%.
 *
 * NOTHING HERE IS STORED. Both figures are computed per request from canonical
 * Attendance and Homework data by the helpers in src/lib/finance.ts, beside the
 * aggregates they must agree with. A Review document carries neither, and never
 * will: a percentage copied onto a review would be a second copy of a fact that
 * is free to drift from the first. */
export interface StudentMonthMetrics {
  month: string;
  attendance: StudentAttendanceRate;
  homework: StudentHomeworkCompletion;
}

/** The Reviews payload for one student's profile.
 *
 * SPRINT 8 GATE 4.4C widened this. It used to carry reviews and nothing else;
 * the approved scope amendment brought the design's analytics blocks into the
 * sprint, and those blocks need three things this payload now adds: the charts
 * derived from the reviews themselves, and the two cross-domain metrics.
 *
 * IT IS STILL READ-ONLY, AND STILL NOT A REPORT. There is no parent block, no
 * generated-on stamp and no PDF structure here — Gate 4.4D owns the report
 * model. Nothing is exported, nothing is generated, and no achievement, concern
 * or summary prose exists anywhere in it. */
export interface StudentReviewsPayload {
  student: {
    id: string;
    name: string;
    initials: string;
    color: string;
    avatar: string | null;
    gradeLabel: string;
    status: Student["status"];
  };
  /** May a NEW review be written for this student? False for Archived. */
  canCreate: boolean;
  /** True only when the linked Parent document actually resolves. */
  parentLinked: boolean;
  /** The month a new review defaults to — the application month. */
  defaultMonth: string;
  /** The twelve selectable months, newest first, each flagged if already taken. */
  months: ReviewMonthOption[];
  /** This student's reviews, newest month first. */
  reviews: ReviewDetail[];
  /** Every chart for the LATEST review, or `null` when there is none.
   *
   * `null` rather than an empty analytics object, so a screen with no reviews
   * renders its empty state instead of a shell of zeroed charts. */
  analytics: ReviewAnalytics | null;
  /** Attendance and homework for the LATEST review's month, or `null` when the
   * student has no reviews — there is no month to report on. */
  latestMetrics: StudentMonthMetrics | null;
  /** The same two metrics for every reviewed month, newest first, so the
   * learning journey can put a month's numbers beside that month's words
   * without a second round trip. Same order as `reviews`. */
  metricsByMonth: StudentMonthMetrics[];
}

/** Discriminated result so Route Handlers map a failure through REVIEW_ERROR the
 * same way every Homework handler maps one through HOMEWORK_ERROR. */
export type ReviewOpResult =
  | { ok: true; review: ReviewDetail }
  | { ok: false; reason: ReviewOpError };

export type StudentReviewsResult =
  | { ok: true; payload: StudentReviewsPayload }
  | { ok: false; reason: ReviewOpError };

/** The dedicated composer's read, in either mode. */
export type ReviewComposerResult =
  | { ok: true; payload: ReviewComposerData }
  | { ok: false; reason: ReviewOpError };

/** Shape one stored review for the wire, deriving its average. */
function present(doc: Review): ReviewDetail {
  return {
    id: doc.id,
    studentId: doc.studentId,
    month: doc.month,
    skills: doc.skills,
    average: reviewAverage(doc.skills),
    comment: doc.comment ?? "",
    strengths: doc.strengths ?? "",
    improvements: doc.improvements ?? "",
    goals: doc.goals ?? "",
    parentNotes: doc.parentNotes ?? "",
  };
}

/* -------------------------------------------------------------------- reads */

/** Everything the Reviews index renders, shaped on the server.
 *
 * THE STUDENTS ARE THE SOURCE, NOT THE REVIEWS. The screen offers "write a
 * review" for every student who may be given one, so the card list is built from
 * canonical Student data: an eligible student with no reviews still gets a card,
 * and a review whose student no longer exists gets nothing. `buildReviewCards`
 * decides all of that — including omitting Archived students — so the rule is
 * one function, tested without a database.
 *
 * THE PARENT READ IS A RESOLUTION CHECK, NOT A JOIN. Only the ids students
 * actually reference are looked up, and only their ids come back; a `parentId`
 * that matches no document simply produces `parentLinked: false`. Nothing is
 * repaired, reported or written back — a stale reference is data to be shown
 * honestly, not a fault for a read to fix.
 *
 * NO HISTORY IS SENT. Reviews are read in full to count them and to average the
 * latest one, and the response carries neither the list nor any review id, so an
 * index payload cannot disclose a ghost record's identity. */
export async function listReviewCards(): Promise<ReviewCardsPayload> {
  await dbConnect();

  const [students, reviews] = await Promise.all([
    StudentModel.find().select(clean).lean<Student[]>(),
    ReviewModel.find().select(clean).lean<Review[]>(),
  ]);

  const parentIds = [...new Set(students.map((s) => s.parentId).filter(Boolean))];
  const parents = parentIds.length === 0
    ? []
    : await ParentModel.find({ id: { $in: parentIds } }).select("id -_id")
        .lean<Array<Pick<Parent, "id">>>();

  return {
    month: CURRENT_MONTH,
    cards: buildReviewCards(students, reviews, new Set(parents.map((p) => p.id))),
  };
}

/** One student's Reviews tab: their identity, whether they may be reviewed, and
 * their history newest first.
 *
 * A STUDENT WHO DOES NOT RESOLVE IS `student_not_found`. Their reviews may still
 * be stored — those records are preserved, never erased — but they are not
 * readable through a student who is gone, and no card ever pointed here.
 *
 * AN ARCHIVED STUDENT MAY BE READ. Their history is a record of months that
 * happened; archiving them does not delete it. `canCreate` is what turns false,
 * so the screen can show the history and withhold the button — and the API
 * refuses a create for them regardless of what the screen decides.
 *
 * THE MONTH DATA IS THE SERVER'S ANSWER, not the client's arithmetic: the
 * default month, the twelve selectable months, and which of them this student
 * already has. A taken month stays in the list, flagged, because a teacher needs
 * to see that June is done rather than wonder where it went. */
export async function getStudentReviews(studentId: string): Promise<StudentReviewsResult> {
  await dbConnect();

  const student = await StudentModel.findOne({ id: studentId }).select(clean).lean<Student>();
  if (!student) return { ok: false, reason: "student_not_found" };

  const reviews = await ReviewModel.find({ studentId: student.id }).select(clean).lean<Review[]>();
  const history = buildReviewHistory(reviews, student.id);

  const parent = student.parentId
    ? await ParentModel.findOne({ id: student.parentId }).select("id -_id").lean<Pick<Parent, "id">>()
    : null;

  const metricsByMonth = await studentMonthMetrics(student.id, history.map((r) => r.month));
  const latest = history[0] ?? null;

  return {
    ok: true,
    payload: {
      student: {
        id: student.id,
        name: student.name,
        initials: student.initials,
        color: student.avatarColor,
        avatar: student.avatar,
        gradeLabel: student.gradeLabel,
        status: student.status,
      },
      canCreate: canReviewStudent(student),
      parentLinked: isParentLinked(student, new Set(parent ? [parent.id] : [])),
      defaultMonth: CURRENT_MONTH,
      months: reviewMonthOptions(CURRENT_MONTH, history.map((r) => r.month)),
      reviews: history.map(present),
      /* Charts are for the LATEST review, against this student's own history.
       * `history` is newest-first; the analytics module sorts its own copy, so
       * the order it is handed does not matter. */
      analytics: latest ? buildReviewAnalytics(latest, history) : null,
      latestMetrics: metricsByMonth[0] ?? null,
      metricsByMonth,
    },
  };
}

/** Attendance and homework for each of a student's reviewed months.
 *
 * WHY THE REVIEWS SERVICE READS FOUR MORE COLLECTIONS. The approved Gate 4.4A
 * amendment puts an Attendance percentage and a Homework completion percentage
 * on the Reviews surfaces, and both are facts about other domains. They are
 * DERIVED LIVE and never stored on a Review, so they have to be read somewhere;
 * this is that place, and it reads only.
 *
 * THE ATTENDANCE SCOPE IS THIS STUDENT'S CLASSES. `studentAttendanceRate` takes
 * its lesson set from its caller — exactly as `attendanceRate` already does,
 * which `buildAttendanceIndex` calls once with a month's lessons and again with
 * one class's. Passing the whole studio's lessons would make `lessonsCompleted`
 * describe the school rather than the student, so the lessons are narrowed to
 * the classes whose roster names them. That narrowing changes no percentage: the
 * numerator and denominator are stored ENTRIES, and an entry for this student
 * can only exist on a lesson of a class they were on. It changes the coverage
 * figures, which is the point of having them.
 *
 * ROSTER MEMBERSHIP IS READ AS IT IS TODAY, and that is a real limitation worth
 * stating: a student moved out of a class after a month was taught will see that
 * month's coverage shrink, though their percentage is unmoved. Attendance stores
 * no membership history, so no other answer is available from this data.
 *
 * ONE ROUND TRIP PER COLLECTION, whatever the number of months. Everything is
 * fetched once and the pure helpers are called per month over the same arrays.
 *
 * NOTHING IS WRITTEN, REPAIRED OR REPORTED. No lifecycle advance, no
 * reconciliation, no generation — a student's profile must never mutate a lesson
 * because somebody looked at their reviews. */
async function studentMonthMetrics(
  studentId: string,
  months: readonly string[]
): Promise<StudentMonthMetrics[]> {
  if (months.length === 0) return [];

  /* Only the fields the two helpers read, and only the classes this student is
   * on. `select` keeps the payload small; `lean` keeps it plain. */
  const classes = await ClassModel.find({ studentIds: studentId })
    .select("id -_id").lean<Array<Pick<Klass, "id">>>();
  const classIds = classes.map((c) => c.id);

  const lessons = classIds.length === 0
    ? []
    : await LessonModel.find({ classId: { $in: classIds }, status: "Completed" })
        .select("id date status -_id").lean<Lesson[]>();

  const lessonIds = lessons.map((l) => l.id);
  const attendance = lessonIds.length === 0
    ? []
    : await AttendanceModel.find({ lessonId: { $in: lessonIds } })
        .select("lessonId entries -_id").lean<AttendanceRecord[]>();

  /* Homework is scoped by the query to work that can concern this student: work
   * set to one of their classes, or addressed to them by name. The month filter
   * and every exclusion stay inside `studentHomeworkCompletion`, so the rule is
   * still stated once, in Sprint 7's own file. */
  const homework = classIds.length === 0
    ? await HomeworkModel.find({ scope: "student", studentId })
        .select("dueDate status scope studentId submissions -_id").lean<Homework[]>()
    : await HomeworkModel.find({
        $or: [{ classId: { $in: classIds } }, { scope: "student", studentId }],
      }).select("dueDate status scope studentId submissions -_id").lean<Homework[]>();

  return months.map((month) => ({
    month,
    attendance: studentAttendanceRate(studentId, month, { lessons, attendance }),
    homework: studentHomeworkCompletion(studentId, month, { homework }),
  }));
}

/* --------------------------------------------------- the dedicated composer */

/** The composer's read, for Create.
 *
 * ONE ROUND TRIP, AND IT WRITES NOTHING. Everything the dedicated Create page
 * needs arrives here: the student, the parent the report is addressed to, the
 * twelve selectable months with which of them are already taken, the Attendance
 * and Homework figures for EACH of those months, and this student's own review
 * history as month + ratings + comment.
 *
 * WHY ALL TWELVE MONTHS' METRICS. A create previews before it persists, so
 * changing the month has to change the derived figures the preview shows — and
 * a request per month change would put a network round trip behind a chip tap.
 * Twelve months of two small metric objects is about a kilobyte, and
 * `studentMonthMetrics` already reads each collection once and maps over the
 * months it is given, so twelve months cost the same four reads that one does.
 *
 * NO REVIEW ID IS REQUIRED, because there is no review yet. That is the whole
 * reason this is not a read of a record.
 *
 * ELIGIBILITY IS DECIDED HERE, NOT TRUSTED FROM THE CLIENT. An Archived student
 * is refused with the same reason the create endpoint gives, so a page opened
 * from a stale card cannot show a form the API would refuse to save. A student
 * who does not resolve is `student_not_found`. */
export async function getReviewComposerForStudent(studentId: string): Promise<ReviewComposerResult> {
  await dbConnect();

  const student = await StudentModel.findOne({ id: studentId }).select(clean).lean<Student>();
  if (!student) return { ok: false, reason: "student_not_found" };
  if (!canReviewStudent(student)) return { ok: false, reason: "student_not_eligible" };

  return { ok: true, payload: await composerFor(student, null) };
}

/** The composer's read, for Edit — addressed by REVIEW id.
 *
 * GUARDED BY `loadInteractable`, the same gate PATCH passes through, so this
 * read can disclose no more than the write can: a review that does not exist and
 * a review left behind by a deleted student are one answer, `not_found`. No
 * deleted student's id reaches the wire, and no distinct reason advertises that
 * a ghost record is there.
 *
 * DELIBERATELY NOT A GENERIC `GET /api/reviews/:id`. What comes back is the
 * composer's model — the student, the parent, the months, the metrics, the
 * history — not the stored document, and the route that serves it is
 * `/api/reviews/:id/report`.
 *
 * AN ARCHIVED STUDENT'S REVIEW IS READABLE AND EDITABLE. `canReviewStudent`
 * gates writing a NEW review and is not consulted here: this record describes a
 * month that happened, and archiving the student afterwards does not make it
 * uncorrectable. */
export async function getReviewComposerForReview(reviewId: string): Promise<ReviewComposerResult> {
  await dbConnect();

  const loaded = await loadInteractable(reviewId);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const student = await StudentModel.findOne({ id: loaded.doc.studentId }).select(clean).lean<Student>();
  /* `loadInteractable` already established that the student resolves; this is
   * the same fact read again for its fields, and it fails closed — with the same
   * undifferentiated `not_found` — if it has changed underneath us. */
  if (!student) return { ok: false, reason: "not_found" };

  return { ok: true, payload: await composerFor(student, loaded.doc) };
}

/** Both modes, assembled once.
 *
 * ONE FUNCTION SO THE TWO SURFACES CANNOT DRIFT. Create and Edit are the same
 * product surface; if they were shaped by two builders they would eventually
 * disagree about what a month option is or which history a comparison searches.
 * The mode changes three things and nothing else — which months are offered,
 * which month is current, and whether that month may move.
 *
 * THE MONTH LISTS DIFFER BY MODE, ON PURPOSE:
 *
 *  - CREATE offers exactly the twelve-month window. A thirteenth month is not
 *    invented, and a month older than the window is not offered, because a
 *    create for one would be refused (`isSelectableMonth`).
 *  - EDIT offers that window PLUS any month this student already has a review
 *    for, so the chips cover the whole history and — critically — so a
 *    historical review being corrected always finds its own month in the list.
 *    Nothing there is selectable; the chips navigate between existing reviews.
 *
 * NO WRITE OF ANY KIND, and no other domain's write path is touched: this reads
 * Students, Parents, Reviews, and — through `studentMonthMetrics` — Classes,
 * Lessons, Attendance and Homework. It advances no lifecycle, reconciles
 * nothing, generates nothing and calls no Dashboard. */
async function composerFor(student: Student, review: Review | null): Promise<ReviewComposerData> {
  const reviews = await ReviewModel.find({ studentId: student.id }).select(clean).lean<Review[]>();
  const history = buildReviewHistory(reviews, student.id); // newest first

  /* The parent is read for its NAME, not merely for its existence — the report
   * is addressed to a family. A `parentId` that matches no document yields null
   * and `parentLinked: false`, which is the honest answer and the one
   * PROJECT_RULES requires reviews to state clearly. Nothing is repaired. */
  const parentDoc = student.parentId
    ? await ParentModel.findOne({ id: student.parentId })
        .select("id name relationship -_id")
        .lean<Pick<Parent, "id" | "name" | "relationship">>()
    : null;
  const parentLinked = isParentLinked(student, new Set(parentDoc ? [parentDoc.id] : []));
  const parent: ReviewComposerParent | null = parentDoc && parentLinked
    ? { name: parentDoc.name, relationship: parentDoc.relationship ?? "" }
    : null;

  /* Which review, if any, holds each month — built once, so the option list does
   * not search the history per month. */
  const reviewByMonth = new Map(history.map((r) => [r.month, r]));

  const windowMonths = reviewMonthOptions(CURRENT_MONTH, history.map((r) => r.month));
  const inWindow = new Set(windowMonths.map((m) => m.month));
  /* Edit only: the months this student has a review for that fall OUTSIDE the
   * twelve-month create window. Newest first, like everything else here. */
  const olderMonths = review === null
    ? []
    : [...new Set(history.map((r) => r.month))].filter((m) => !inWindow.has(m)).sort().reverse();

  const monthKeys = [...windowMonths.map((m) => m.month), ...olderMonths];
  const metrics = await studentMonthMetrics(student.id, monthKeys);
  const metricsByMonth = new Map(metrics.map((m) => [m.month, m]));

  const options: ReviewComposerMonth[] = monthKeys.map((month) => {
    const own = reviewByMonth.get(month) ?? null;
    const m = metricsByMonth.get(month);
    return {
      month,
      taken: own !== null,
      reviewId: own ? own.id : null,
      /* `studentMonthMetrics` returns one entry per month it was given, in the
       * order it was given, so a lookup here always hits. The fallbacks are the
       * empty-denominator shape — pct `null`, which every consumer renders as
       * "No data" — so an impossible miss still cannot invent a 0%. */
      attendance: m?.attendance ?? { attended: 0, total: 0, pct: null, registersTaken: 0, lessonsCompleted: 0 },
      homework: m?.homework ?? { done: 0, total: 0, pct: null },
    };
  });

  const entries: ReviewHistoryEntry[] = history.map((r) => ({
    month: r.month, skills: r.skills, comment: r.comment ?? "",
  }));

  return {
    mode: review === null ? "create" : "edit",
    student: {
      id: student.id,
      name: student.name,
      initials: student.initials,
      color: student.avatarColor,
      avatar: student.avatar,
      gradeLabel: student.gradeLabel,
      status: student.status,
    },
    parent,
    parentLinked,
    month: {
      /* CREATE defaults to the newest month with no review yet, and to `null`
       * when all twelve are taken — which is how the page knows there is no
       * create left to make. The rule is `firstUntakenMonth` in the pure domain,
       * so this server-side default and the drawer's client-side one cannot
       * disagree. EDIT is simply the record's own month. */
      current: review === null ? firstUntakenMonth(options) : review.month,
      options,
      immutable: review !== null,
    },
    review: {
      id: review ? review.id : null,
      skills: review ? review.skills : {},
      comment: review ? review.comment ?? "" : "",
      strengths: review ? review.strengths ?? "" : "",
      improvements: review ? review.improvements ?? "" : "",
      goals: review ? review.goals ?? "" : "",
      parentNotes: review ? review.parentNotes ?? "" : "",
      average: review ? reviewAverage(review.skills) : 0,
    },
    history: entries,
    appMonth: CURRENT_MONTH,
    /* The application date, for the generated document's own "generated on"
     * line. It is a property of THE DOCUMENT: no Review stores it, and nothing
     * in this module writes it anywhere. */
    appDate: TODAY_ISO,
  };
}

/* ------------------------------------------------------------------- create */

/** Write one monthly review.
 *
 * THE SEQUENCE IS THE CONTRACT:
 *
 *   student exists -> student may be reviewed -> month is inside the window
 *   -> no review exists for that student and month -> mint id -> plan
 *   -> one insert
 *
 * and nothing is written until every step has passed. Eligibility and the month
 * window are decided here rather than trusted from the client, because the card
 * that opened the form may have been drawn before the student was archived, and
 * because a month picker is a convenience, not a rule.
 *
 * THE DUPLICATE CHECK READS THE ONE MONTH IT IS ABOUT — not the student's whole
 * history — and the answer is handed to the pure planner as data, which is what
 * lets the "already reviewed" decision be tested without a database.
 *
 * AND THE DATABASE GETS THE SAME ANSWER. A duplicate-key error is mapped to
 * `review_already_exists`, the identical outcome the pre-check produces. Today
 * that path can only fire on the unique `id`; the day the compound
 * (studentId, month) index is authorised — Gate 5, never here — the race that
 * the read-then-write window leaves open starts returning the right answer with
 * no change to this file. `isDupKey` is the helper Lessons already uses.
 *
 * IDENTITY IS A MongoDB ObjectId with the string `id` mirroring it, exactly as
 * Classes, Parents, Lessons and Homework do. Never sequential, never derived
 * from a count.
 *
 * NOTHING ELSE IS WRITTEN. No Student update — reviewing a student does not
 * change them. No Parent, Class, Lesson, Attendance, Homework or Billing write
 * of any kind, and no reconciliation. */
export async function createReview(input: ReviewCreateBody): Promise<ReviewOpResult> {
  await dbConnect();

  const student = await StudentModel.findOne({ id: input.studentId })
    .select("id status -_id").lean<Pick<Student, "id" | "status">>();

  // Only the month being written is read: "does this student already have this
  // month?" is the whole question, and the planner consumes the answer as data.
  const taken = student
    ? await ReviewModel.find({ studentId: input.studentId, month: input.month })
        .select("month -_id").lean<Array<Pick<Review, "month">>>()
    : [];

  const _id = new mongoose.Types.ObjectId();
  const planned = planReviewCreate(
    input,
    student,
    new Set(taken.map((r) => r.month)),
    _id.toString(),
    CURRENT_MONTH
  );
  if (!planned.ok) return { ok: false, reason: planned.reason };

  try {
    await ReviewModel.create({ _id, ...planned.doc });
  } catch (e) {
    if (isDupKey(e)) return { ok: false, reason: "review_already_exists" };
    throw e;
  }

  return { ok: true, review: present(planned.doc) };
}

/* --------------------------------------------------------------------- edit */

/** Load one review, and refuse the ones nobody may interact with.
 *
 * INTERACTABLE MEANS THE REVIEW EXISTS AND ITS STUDENT STILL RESOLVES. A review
 * left behind by a deleted student is preserved — it is never erased — but it is
 * listed nowhere and addressed to nobody, so it must not be reachable either:
 * what the index omits, the API refuses. This is the rule Homework already
 * applies to an assignment whose student is gone.
 *
 * `not_found` RATHER THAN A DISTINCT REASON, deliberately. A separate code would
 * advertise the existence of a record the client may not see and would hint at
 * the identity of the deleted student behind it. A ghost and a missing review
 * are one answer.
 *
 * THE STUDENT'S STATUS IS NOT CONSULTED. An Archived student's existing review
 * describes a month that happened, and archiving them afterwards does not make
 * that record uncorrectable. Eligibility gates create, and only create. */
async function loadInteractable(
  id: string
): Promise<{ ok: true; doc: Review } | { ok: false; reason: ReviewOpError }> {
  const doc = await ReviewModel.findOne({ id }).select(clean).lean<Review>();
  if (!doc) return { ok: false, reason: "not_found" };

  const student = doc.studentId ? await StudentModel.countDocuments({ id: doc.studentId }) : 0;
  if (student === 0) return { ok: false, reason: "not_found" };

  return { ok: true, doc };
}

/** Correct an existing review.
 *
 * WRITES AT MOST SIX KEYS, and the set is computed by `planReviewUpdate` from an
 * allow-list rather than filtered out of the request here. `id`, `studentId` and
 * `month` cannot appear in it — which is what makes an edit incapable of moving
 * a review to a different student or a different month. A review that names the
 * wrong student is a different review, not an edit of this one.
 *
 * ONE `updateOne`, BY ID, WITH A `$set`. No upsert, so a patch can never create a
 * document; no `replaceOne`, so no unlisted field can be dropped; no
 * `updateMany`, so exactly one record can move.
 *
 * HISTORICAL CORRECTION IS ALLOWED, with no month lock and no warning — the
 * month being outside the twelve-month create window is irrelevant to an edit,
 * because the record already exists and correcting it invents nothing.
 *
 * No timestamp is written. The schema carries none. */
export async function updateReview(id: string, patch: ReviewUpdateBody): Promise<ReviewOpResult> {
  await dbConnect();

  const loaded = await loadInteractable(id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };

  const set = planReviewUpdate(patch);
  if (Object.keys(set).length > 0) {
    await ReviewModel.updateOne({ id }, { $set: set });
  }

  const after = await ReviewModel.findOne({ id }).select(clean).lean<Review>();
  if (!after) return { ok: false, reason: "not_found" };

  return { ok: true, review: present(after) };
}
