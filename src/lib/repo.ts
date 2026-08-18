/* Server-side data access. Reads the domain collections from MongoDB as plain
 * objects (lean, _id stripped) so Route Handlers can return them directly. */

import "server-only";
import { dbConnect } from "./db";
import {
  ParentModel, StudentModel, ClassModel, LessonModel, AttendanceModel,
  BillingModel, HomeworkModel, ReviewModel, ActivityModel,
} from "./models";
import type {
  Parent, Student, Klass, Lesson, AttendanceRecord, Billing, Homework, Review, ActivityItem,
} from "./types";

const clean = "-_id -__v";

export interface AllData {
  parents: Parent[];
  students: Student[];
  classes: Klass[];
  lessons: Lesson[];
  attendance: AttendanceRecord[];
  billing: Billing[];
  homework: Homework[];
  reviews: Review[];
  activity: ActivityItem[];
}

export async function getAll(): Promise<AllData> {
  await dbConnect();
  const [parents, students, classes, lessons, attendance, billing, homework, reviews, activity] = await Promise.all([
    ParentModel.find().select(clean).lean<Parent[]>(),
    StudentModel.find().select(clean).lean<Student[]>(),
    ClassModel.find().select(clean).lean<Klass[]>(),
    LessonModel.find().select(clean).lean<Lesson[]>(),
    AttendanceModel.find().select(clean).lean<AttendanceRecord[]>(),
    BillingModel.find().select(clean).lean<Billing[]>(),
    HomeworkModel.find().select(clean).lean<Homework[]>(),
    ReviewModel.find().select(clean).lean<Review[]>(),
    ActivityModel.find().select(clean).lean<ActivityItem[]>(),
  ]);
  return { parents, students, classes, lessons, attendance, billing, homework, reviews, activity };
}

export async function getCounts(): Promise<{ students: number; classes: number }> {
  await dbConnect();
  // The sidebar badge counts what the teacher is currently working in, so the
  // class side is ACTIVE ONLY — an Ended class is finished and an Archived one is
  // filed away, and neither belongs in a "how much is on" number. Already an
  // equality test, so a third status needed no change here.
  const [students, classes] = await Promise.all([
    StudentModel.countDocuments({ status: { $ne: "Archived" } }),
    ClassModel.countDocuments({ status: "Active" }),
  ]);
  return { students, classes };
}
