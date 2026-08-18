import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

// ------------------------------------------------------------
// READ-ONLY HISTORICAL AUDIT
// ------------------------------------------------------------
// This script:
// - ONLY reads MongoDB
// - NEVER calls reconciliation
// - NEVER updates/inserts/deletes
// - Only audits historical c2 lessons before 2026-07-12
// ------------------------------------------------------------

const envPath = path.resolve(".env.local");

if (!fs.existsSync(envPath)) {
  throw new Error(`Missing ${envPath}`);
}

const env = fs.readFileSync(envPath, "utf8");

const match = env.match(
  /^(?:MONGODB_URI|MONGO_URI|DATABASE_URL)\s*=\s*(.+)$/m
);

if (!match) {
  throw new Error(
    "Could not find MONGODB_URI, MONGO_URI, or DATABASE_URL in .env.local"
  );
}

const mongoUri = match[1]
  .trim()
  .replace(/^["']|["']$/g, "");

console.log("");
console.log("==============================================");
console.log(" HISTORICAL c2 DUPLICATE AUDIT");
console.log(" READ-ONLY");
console.log("==============================================");
console.log("");

await mongoose.connect(mongoUri, {
  dbName: "etlms",
  autoIndex: false,
  autoCreate: false,
});

console.log("MongoDB connected.");
console.log("NO WRITE OPERATIONS WILL BE PERFORMED.");
console.log("");

const db = mongoose.connection.db;

if (!db) {
  throw new Error("MongoDB database handle unavailable.");
}

const lessonsCollection = db.collection("lessons");
const attendanceCollection = db.collection("attendance");
const homeworkCollection = db.collection("homework");

// ------------------------------------------------------------
// READ ONLY
// ------------------------------------------------------------

const lessons = await lessonsCollection
  .find({
    classId: "c2",
    type: "regular",
    date: { $lt: "2026-07-12" },
  })
  .sort({ date: 1, start: 1 })
  .toArray();

console.log(`Historical Regular lessons: ${lessons.length}`);
console.log("");

// ------------------------------------------------------------
// GROUP BY DATE
// ------------------------------------------------------------

const byDate = new Map();

for (const lesson of lessons) {
  if (!byDate.has(lesson.date)) {
    byDate.set(lesson.date, []);
  }

  byDate.get(lesson.date).push(lesson);
}

// ------------------------------------------------------------
// FIND DUPLICATE DATES
// ------------------------------------------------------------

const duplicateDates = [...byDate.entries()]
  .filter(([, items]) => items.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log("==============================================");
console.log(" DUPLICATE DATES");
console.log("==============================================");
console.log("");

let candidateCount = 0;

for (const [date, items] of duplicateDates) {
  console.log(`DATE: ${date}`);

  for (const lesson of items) {
    // READ-ONLY related-data checks
    const attendance = await attendanceCollection.findOne({
      lessonId: lesson.id,
    });

    const homework = await homeworkCollection.findOne({
      lessonId: lesson.id,
    });

    const hasNotes =
      typeof lesson.notes === "string"
        ? lesson.notes.trim().length > 0
        : Boolean(lesson.notes);

    const isHistorical =
      typeof lesson.date === "string" &&
      lesson.date < "2026-07-12";

    const isCompleted =
      lesson.status === "Completed";

    const isRegular =
      lesson.type === "regular";

    const hasOriginalDate = Boolean(lesson.originalDate);
    const hasOriginalStart = Boolean(lesson.originalStart);

    console.log(`  ID:           ${lesson.id}`);
    console.log(`  Start:        ${lesson.start}`);
    console.log(`  Status:       ${lesson.status ?? "(none)"}`);
    console.log(`  Type:         ${lesson.type ?? "(none)"}`);
    console.log(`  Notes:        ${hasNotes ? "YES" : "NO"}`);
    console.log(
      `  Attendance:   ${attendance ? "YES" : "NO"}`
    );
    console.log(
      `  Homework:     ${homework ? "YES" : "NO"}`
    );
    console.log(
      `  OriginalDate: ${hasOriginalDate ? lesson.originalDate : "NONE"}`
    );
    console.log(
      `  OriginalStart:${hasOriginalStart ? lesson.originalStart : "NONE"}`
    );

    const safeHistoricalCandidate =
      isHistorical &&
      isCompleted &&
      isRegular &&
      !attendance &&
      !homework &&
      !hasNotes &&
      !hasOriginalDate &&
      !hasOriginalStart;

    console.log(
      `  Candidate:    ${safeHistoricalCandidate ? "YES" : "NO"}`
    );

    if (safeHistoricalCandidate) {
      candidateCount++;
    }

    console.log("");
  }
}

console.log("==============================================");
console.log(" SUMMARY");
console.log("==============================================");
console.log("");

console.log(
  `Historical duplicate dates: ${duplicateDates.length}`
);

console.log(
  `Potential safe candidates:  ${candidateCount}`
);

console.log("");

console.log("IMPORTANT:");
console.log("- No lesson was deleted.");
console.log("- No lesson was updated.");
console.log("- No lesson was inserted.");
console.log("- Reconciliation was NOT called.");
console.log("- This was a READ-ONLY audit.");
console.log("");

await mongoose.disconnect();

console.log("MongoDB disconnected.");
console.log("");
console.log("Audit complete.");