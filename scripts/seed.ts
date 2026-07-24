/* Seed MongoDB Atlas with the admin account and the full demo dataset.
 * Run with:  npm run seed   (reads .env.local for MONGODB_URI / JWT_SECRET / admin creds)
 *
 * Idempotent: clears the domain collections and upserts the admin user. */

import bcrypt from "bcryptjs";
import { dbConnect } from "../src/lib/db";
import {
  User, ParentModel, StudentModel, ClassModel, LessonModel,
  AttendanceModel, BillingModel, HomeworkModel, ReviewModel, ActivityModel, mongoose,
} from "../src/lib/models";
import { SEED } from "../src/lib/seed-data";
import { deriveData } from "../src/lib/generate";

async function main() {
  await dbConnect();
  console.log("Connected to MongoDB.");

  const { lessons, attendance, billing } = deriveData(SEED.classes, SEED.students);

  await Promise.all([
    ParentModel.deleteMany({}), StudentModel.deleteMany({}), ClassModel.deleteMany({}),
    LessonModel.deleteMany({}), AttendanceModel.deleteMany({}), BillingModel.deleteMany({}),
    HomeworkModel.deleteMany({}), ReviewModel.deleteMany({}), ActivityModel.deleteMany({}),
  ]);

  await ParentModel.insertMany(SEED.parents);
  await StudentModel.insertMany(SEED.students);
  await ClassModel.insertMany(SEED.classes);
  await LessonModel.insertMany(lessons);
  await AttendanceModel.insertMany(attendance);
  await BillingModel.insertMany(billing);
  await HomeworkModel.insertMany(SEED.homework);
  await ReviewModel.insertMany(SEED.reviews);
  await ActivityModel.insertMany(SEED.activity);

  const email = (process.env.ADMIN_EMAIL || "teacher@tutor.app").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "demo1234";
  const name = process.env.ADMIN_NAME || "Sarah Mitchell";
  const passwordHash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { email },
    { email, name, passwordHash },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log("Seeded:");
  console.log(`  parents ${SEED.parents.length} · students ${SEED.students.length} · classes ${SEED.classes.length}`);
  console.log(`  lessons ${lessons.length} · attendance ${attendance.length} · billing ${billing.length}`);
  console.log(`  homework ${SEED.homework.length} · reviews ${SEED.reviews.length} · activity ${SEED.activity.length}`);
  console.log(`  admin: ${email} / ${password}`);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
