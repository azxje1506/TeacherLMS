/* Mongoose models for every domain entity.
 *
 * Each entity keeps its stable string `id` ('s1', 'c1', 'hw-c1-0', …) from the
 * seed as a unique key, so relationships (parentId, studentIds, classId …) stay
 * human-readable and match the imported design's data model exactly. The Mongo
 * `_id` is incidental. Models are guarded for Next.js hot reload. */

import mongoose, { Schema, model, models, type Model } from "mongoose";
import { BILLING_STATUSES } from "./billing";
import type {
  Parent, Student, Klass, Lesson, AttendanceRecord, Billing, Homework, Review, ActivityItem,
} from "./types";

const opts = { versionKey: false, minimize: false } as const;

/* ---- Auth: the single admin user ---- */
export interface UserDoc {
  email: string;
  name: string;
  passwordHash: string;
}
const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
  },
  { ...opts, timestamps: true }
);

/* ---- Domain collections (string id is the natural key) ---- */
const ParentSchema = new Schema<Parent>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: String, relationship: String, phone: String, email: String, notes: String,
    initials: String, color: String,
  },
  opts
);

const StudentSchema = new Schema<Student>(
  {
    id: { type: String, required: true, unique: true, index: true },
    first: String, last: String, name: String, initials: String,
    birthday: String, age: Number, school: String, grade: Number, gradeLabel: String,
    parentId: String, parentName: String, phone: String, status: String, notes: String,
    joined: String, classes: Number, attendance: Number, balance: Number,
    avatar: { type: String, default: null }, avatarColor: String,
  },
  opts
);

const ScheduleSlotSchema = new Schema(
  { day: Number, start: String, duration: Number },
  { _id: false }
);
const ClassSchema = new Schema<Klass>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: String, type: String, level: String, fee: Number, classroom: String, status: String,
    studentIds: [String], notes: String, schedule: [ScheduleSlotSchema], color: String,
  },
  opts
);

const LessonSchema = new Schema<Lesson>(
  {
    id: { type: String, required: true, unique: true, index: true },
    classId: { type: String, index: true },
    type: String, date: { type: String, index: true }, start: String, duration: Number,
    classroom: String, status: String, chargeable: Boolean,
    fromId: { type: String, default: null }, notes: String,
    // Where the lesson sat before it was first moved. Absent (not null) while the
    // lesson still occupies its generated slot — see Lesson in types.ts.
    originalDate: { type: String, default: undefined },
    originalStart: { type: String, default: undefined },
    originalDuration: { type: Number, default: undefined },
    // Stored as an ISO 8601 string like every other date on this schema, rather
    // than as a Date, so the whole Lesson document stays JSON-serialisable and
    // reaches the client through `.lean()` unchanged.
    rescheduledAt: { type: String, default: undefined },
  },
  opts
);

const AttendanceSchema = new Schema<AttendanceRecord>(
  {
    lessonId: { type: String, required: true, unique: true, index: true },
    date: String,
    entries: { type: Schema.Types.Mixed, default: {} },
  },
  opts
);

/* One month's tuition for one student in one class.
 *
 * NO COMPOUND INDEX IS DECLARED, deliberately. `(studentId, classId, month)` is
 * the natural key and holds across every stored document, but declaring it here
 * would BUILD it: `dbConnect` leaves mongoose's `autoIndex` at its default,
 * which is ON, so a declared index is created implicitly the first time the
 * model is used — in every process, including a deploy. That is production DDL,
 * and it belongs to a Gate 5 with its own authorisation, production first and
 * declaration second (the order Sprint 8 established for
 * `review_student_month_unique`). The four field-level indexes below are the
 * ones production already has, unchanged.
 *
 * `paidAmount` is optional and is written only for `Partially Paid`. Adding it
 * mutates no stored document: a field absent from a document reads as
 * `undefined`, which is exactly the "amount never recorded" state the rule
 * describes. Nothing back-fills it.
 *
 * `status` gains an enum. It was a bare `String`, so the three legal values were
 * enforced nowhere at the persistence layer — only by a Zod schema that nothing
 * imported. Every one of the stored documents already satisfies it. */
const BillingSchema = new Schema<Billing>(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, index: true }, classId: { type: String, index: true },
    month: { type: String, index: true }, fee: Number,
    status: { type: String, enum: BILLING_STATUSES },
    paidDate: { type: String, default: null }, notes: String,
    paidAmount: { type: Number, default: undefined },
  },
  opts
);

const HomeworkSchema = new Schema<Homework>(
  {
    id: { type: String, required: true, unique: true, index: true },
    title: String, description: String, classId: { type: String, index: true },
    lessonId: { type: String, default: null }, scope: String, studentId: { type: String, default: null },
    dueDate: String, status: String, submissions: { type: Schema.Types.Mixed, default: {} },
    teacherNotes: String, createdAt: String,
  },
  opts
);

const ReviewSchema = new Schema<Review>(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, index: true }, month: { type: String, index: true },
    skills: { type: Schema.Types.Mixed, default: {} },
    comment: String, strengths: String, improvements: String, goals: String, parentNotes: String,
  },
  opts
);

/* One Review per (studentId, month) — the ownership rule, enforced by the
 * database rather than only by the service.
 *
 * THE INDEX ALREADY EXISTS IN PRODUCTION. It was created explicitly, by name, in
 * Sprint 8 Gate 5.1; this declaration is the source half of that pair and must
 * describe it EXACTLY — same key, same order, same uniqueness, same name. It is
 * not the thing that creates it.
 *
 * WHY THAT ORDER MATTERS. `dbConnect` leaves mongoose's `autoIndex` at its
 * default, which is ON, so a declared index is built implicitly the first time
 * the model is used — in every process, including a deploy. Declaring first
 * would therefore have been an unauthorised deploy-time DDL that failed
 * asynchronously if any duplicate pair existed. Against an index that already
 * exists with an identical spec, the implicit build is a no-op.
 *
 * THE NAME IS EXPLICIT, not mongoose's derived `studentId_1_month_1`, so source
 * and production can be compared by a string rather than by a convention.
 *
 * NO `sparse`, NO `partialFilterExpression`. Every Review has both fields (the
 * schemas refuse a create without them), including the ghost reviews whose
 * student no longer resolves — those are preserved records, and they occupy
 * their pair like any other.
 *
 * The field-level `studentId` and `month` indexes above stay. `studentId_1` is
 * now a redundant prefix of this one, but dropping it is a separate production
 * mutation needing its own authorisation; `month_1` is a suffix and this index
 * cannot serve it at all. */
ReviewSchema.index(
  { studentId: 1, month: 1 },
  { unique: true, name: "review_student_month_unique" }
);

const ActivitySchema = new Schema<ActivityItem>(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: String, pre: String, strong: String, post: String, ago: String,
  },
  opts
);

/* Model registry (hot-reload guarded) */
export const User = (models.User as Model<UserDoc>) || model<UserDoc>("User", UserSchema);
export const ParentModel = (models.Parent as Model<Parent>) || model<Parent>("Parent", ParentSchema);
export const StudentModel = (models.Student as Model<Student>) || model<Student>("Student", StudentSchema);
export const ClassModel = (models.Class as Model<Klass>) || model<Klass>("Class", ClassSchema);
export const LessonModel = (models.Lesson as Model<Lesson>) || model<Lesson>("Lesson", LessonSchema);
export const AttendanceModel =
  (models.Attendance as Model<AttendanceRecord>) || model<AttendanceRecord>("Attendance", AttendanceSchema);
export const BillingModel = (models.Billing as Model<Billing>) || model<Billing>("Billing", BillingSchema);
export const HomeworkModel = (models.Homework as Model<Homework>) || model<Homework>("Homework", HomeworkSchema);
export const ReviewModel = (models.Review as Model<Review>) || model<Review>("Review", ReviewSchema);
export const ActivityModel = (models.Activity as Model<ActivityItem>) || model<ActivityItem>("Activity", ActivitySchema);

export { mongoose };
