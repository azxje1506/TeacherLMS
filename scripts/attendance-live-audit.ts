/* Attendance — READ-ONLY audit of the live database.
 *
 * Run with:  npm run attendance:live-audit
 *
 * Reports the state Gate 2 measured, so implementation can be checked against a
 * fresh reading rather than against a remembered number. It answers, for the real
 * data: how many registers exist, whether any lesson has two, how many carry
 * entries for students who no longer exist, how many distinct such students there
 * are, how many carry a `date` that disagrees with their lesson, how many carry
 * timestamps, and whether any belongs to a future or Cancelled lesson.
 *
 * IT WRITES NOTHING. There is no update, insert, delete or index operation in
 * this file — only `find` and `countDocuments`. Nothing it reports is repaired:
 * cleaning this data is a separate, deliberate decision, and an audit that
 * quietly fixed what it found would destroy the evidence it exists to gather.
 */

import { LessonModel, StudentModel, mongoose } from "../src/lib/models";
import { TODAY_ISO } from "../src/lib/constants";
import type { AttendanceRecord, Lesson, Student } from "../src/lib/types";

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "etlms";

if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local (see .env.example).");

const line = (label: string, value: string | number) => console.log(`${label.padEnd(38)} ${value}`);

async function main() {
  await mongoose.connect(uri!, { dbName: DB_NAME, bufferCommands: false });
  const db = mongoose.connection.db!;

  console.log("========== LIVE DATA (read-only) ==========");
  console.log(`database  : ${db.databaseName}`);
  console.log(`app clock : ${TODAY_ISO}`);
  console.log("===========================================\n");

  const [records, lessons, students] = await Promise.all([
    // The RAW documents, not `.lean()` through the schema — the audit has to see
    // fields the type no longer advertises (`date`) and fields the schema never
    // declared (`createdAt`), which a typed projection would hide.
    db.collection("attendances").find({}).toArray(),
    LessonModel.find().select("id date status -_id").lean<Array<Pick<Lesson, "id" | "date" | "status">>>(),
    StudentModel.find().select("id -_id").lean<Array<Pick<Student, "id">>>(),
  ]);

  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const studentIds = new Set(students.map((s) => s.id));

  const seen = new Map<string, number>();
  let orphanBearing = 0;
  let drifted = 0;
  let timestamped = 0;
  let future = 0;
  let cancelled = 0;
  let danglingLesson = 0;
  const missingStudents = new Set<string>();
  const driftedDetail: string[] = [];

  for (const raw of records) {
    const rec = raw as unknown as AttendanceRecord & { createdAt?: unknown; updatedAt?: unknown };
    seen.set(rec.lessonId, (seen.get(rec.lessonId) ?? 0) + 1);

    const entryIds = Object.keys(rec.entries ?? {});
    const orphans = entryIds.filter((id) => !studentIds.has(id));
    if (orphans.length > 0) orphanBearing++;
    for (const id of orphans) missingStudents.add(id);

    const lesson = lessonById.get(rec.lessonId);
    if (!lesson) {
      danglingLesson++;
    } else {
      if (rec.date !== undefined && rec.date !== lesson.date) {
        drifted++;
        driftedDetail.push(`${rec.lessonId}: record ${rec.date} vs lesson ${lesson.date}`);
      }
      if (lesson.date > TODAY_ISO) future++;
      if (lesson.status === "Cancelled") cancelled++;
    }

    if (rec.createdAt !== undefined || rec.updatedAt !== undefined) timestamped++;
  }

  const duplicates = [...seen.entries()].filter(([, n]) => n > 1);

  line("Attendance records", records.length);
  line("duplicate lessonId", duplicates.length);
  line("orphan-bearing records", orphanBearing);
  line("missing student ids", missingStudents.size);
  line("drifted AttendanceRecord.date", drifted);
  line("records with timestamps", timestamped);
  line("future Attendance records", future);
  line("Cancelled Attendance records", cancelled);
  line("records whose lesson is gone", danglingLesson);

  if (duplicates.length > 0) console.log(`\nduplicate lessonIds: ${duplicates.map(([id, n]) => `${id} x${n}`).join(", ")}`);
  if (missingStudents.size > 0) console.log(`\nmissing student ids: ${[...missingStudents].sort().join(", ")}`);
  if (driftedDetail.length > 0) console.log(`\ndrifted dates:\n  ${driftedDetail.join("\n  ")}`);

  console.log("\nNothing was modified. This script performs reads only.");
}

main()
  .catch((e) => {
    console.error("\nLIVE AUDIT FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
