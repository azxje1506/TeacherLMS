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
import { ParentModel, ReviewModel, StudentModel, mongoose } from "./models";
import { CURRENT_MONTH } from "./constants";
import {
  buildReviewCards, buildReviewHistory, canReviewStudent, isParentLinked, planReviewCreate,
  planReviewUpdate, reviewAverage, reviewMonthOptions,
  type ReviewCard, type ReviewMonthOption, type ReviewOpError,
} from "./reviews";
import type { ReviewCreateBody, ReviewUpdateBody } from "./schemas";
import type { Parent, Review, Student } from "./types";

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

/** The Reviews payload for one student's profile. Reviews only: no attendance,
 * no homework, no classes, no lessons, no export data, and nothing generated. */
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
}

/** Discriminated result so Route Handlers map a failure through REVIEW_ERROR the
 * same way every Homework handler maps one through HOMEWORK_ERROR. */
export type ReviewOpResult =
  | { ok: true; review: ReviewDetail }
  | { ok: false; reason: ReviewOpError };

export type StudentReviewsResult =
  | { ok: true; payload: StudentReviewsPayload }
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
    },
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
