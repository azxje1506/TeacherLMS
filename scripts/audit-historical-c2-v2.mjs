import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// HISTORICAL c2 DUPLICATE AUDIT V2
// READ-ONLY
// ============================================================
//
// This script:
// - ONLY reads MongoDB
// - NEVER updates
// - NEVER inserts
// - NEVER deletes
// - NEVER calls reconciliation
// - Audits historical c2 regular lessons before 2026-07-12
//
// Retirement candidates are based on the audited duplicate-date
// pattern:
//   10:00 = KEEP
//   22:00 = RETIRE candidate
//
// Protected lessons are never retirement candidates.
//
// ============================================================

const CLASS_ID = "c2";
const CUTOFF_DATE = "2026-07-12";

// These are the exact duplicate lessons previously identified
// by the historical audit.
const EXPECTED_RETIREMENT_IDS = [
  "L-c2-2026-06-07-2200",
  "L-c2-2026-06-14-2200",
  "L-c2-2026-06-21-2200",
  "L-c2-2026-06-28-2200",
  "L-c2-2026-07-05-2200",
];

// ============================================================
// ENV
// ============================================================

const envPath = path.resolve(".env.local");

if (!fs.existsSync(envPath)) {
  throw new Error(`Missing ${envPath}`);
}

const env = fs.readFileSync(envPath, "utf8");

const mongoMatch = env.match(
  /^(?:MONGODB_URI|MONGO_URI|DATABASE_URL)\s*=\s*(.+)$/m
);

if (!mongoMatch) {
  throw new Error(
    "Could not find MONGODB_URI, MONGO_URI, or DATABASE_URL in .env.local"
  );
}

const mongoUri = mongoMatch[1]
  .trim()
  .replace(/^["']|["']$/g, "");

// Match src/lib/dbConnect.ts:
//
// dbName: process.env.MONGODB_DB || "etlms"
//
const dbNameMatch = env.match(
  /^MONGODB_DB\s*=\s*(.+)$/m
);

const dbName = dbNameMatch
  ? dbNameMatch[1]
      .trim()
      .replace(/^["']|["']$/g, "")
  : "etlms";

// ============================================================
// HEADER
// ============================================================

console.log("");
console.log("============================================================");
console.log(" HISTORICAL c2 DUPLICATE AUDIT V2");
console.log(" READ ONLY");
console.log("============================================================");
console.log("");

console.log(`Database: ${dbName}`);
console.log(`Class:    ${CLASS_ID}`);
console.log(`Cutoff:   ${CUTOFF_DATE}`);
console.log("");

console.log("Expected historical retirement IDs:");

for (const id of EXPECTED_RETIREMENT_IDS) {
  console.log(`- ${id}`);
}

console.log("");

// ============================================================
// CONNECT
// ============================================================

await mongoose.connect(mongoUri, {
  autoIndex: false,
  autoCreate: false,
  dbName,
});

console.log("MongoDB connected.");
console.log(
  `Connected database: ${mongoose.connection.db?.databaseName}`
);
console.log("NO WRITE OPERATIONS WILL BE PERFORMED.");
console.log("");

// ============================================================
// DB
// ============================================================

const db = mongoose.connection.db;

if (!db) {
  throw new Error("MongoDB database handle unavailable.");
}

const lessonsCollection = db.collection("lessons");
const attendanceCollection = db.collection("attendance");
const homeworkCollection = db.collection("homework");

// ============================================================
// DATABASE SAFETY
// ============================================================

if (mongoose.connection.db?.databaseName !== dbName) {
  throw new Error(
    `Connected to "${mongoose.connection.db?.databaseName}" instead of "${dbName}".`
  );
}

// ============================================================
// LOAD HISTORICAL REGULAR LESSONS
// ============================================================

const lessons = await lessonsCollection
  .find({
    classId: CLASS_ID,
    type: "regular",
    date: { $lt: CUTOFF_DATE },
  })
  .sort({ date: 1, start: 1 })
  .toArray();

console.log(
  `Total historical Regular lessons: ${lessons.length}`
);

console.log("");

// ============================================================
// GROUP BY DATE
// ============================================================

const byDate = new Map();

for (const lesson of lessons) {
  if (!byDate.has(lesson.date)) {
    byDate.set(lesson.date, []);
  }

  byDate.get(lesson.date).push(lesson);
}

// ============================================================
// DUPLICATE DATE ANALYSIS
// ============================================================

const duplicateDates = [...byDate.entries()]
  .filter(([, items]) => items.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log("============================================================");
console.log(" DUPLICATE DATE ANALYSIS");
console.log("============================================================");
console.log("");

if (duplicateDates.length === 0) {
  console.log("No duplicate historical dates found.");
  console.log("");
} else {
  for (const [date, items] of duplicateDates) {
    console.log(
      `DATE: ${date}  lessons=${items.length}`
    );

    for (const lesson of items) {
      console.log(
        `  ${lesson.id} | ${lesson.start}/${lesson.duration ?? "?"}`
      );
    }

    console.log("");
  }
}

// ============================================================
// HELPERS
// ============================================================

function hasNotes(lesson) {
  if (typeof lesson.notes === "string") {
    return lesson.notes.trim().length > 0;
  }

  return Boolean(lesson.notes);
}

function hasOriginalFields(lesson) {
  return {
    originalDate: Boolean(lesson.originalDate),
    originalStart: Boolean(lesson.originalStart),
    originalDuration: lesson.originalDuration != null,
  };
}

async function getRelatedData(lessonId) {
  const [attendance, homework] = await Promise.all([
    attendanceCollection.findOne({
      lessonId,
    }),
    homeworkCollection.findOne({
      lessonId,
    }),
  ]);

  return {
    attendance,
    homework,
  };
}

// ============================================================
// DECISION
// ============================================================

async function analyseLesson(lesson) {
  const related = await getRelatedData(lesson.id);

  const original = hasOriginalFields(lesson);

  const protections = [];

  if (related.attendance) {
    protections.push("attendance");
  }

  if (related.homework) {
    protections.push("homework");
  }

  if (hasNotes(lesson)) {
    protections.push("notes");
  }

  if (lesson.status !== "Completed") {
    protections.push(`status:${lesson.status ?? "(none)"}`);
  }

  if (original.originalDate) {
    protections.push("originalDate");
  }

  if (original.originalStart) {
    protections.push("originalStart");
  }

  if (original.originalDuration) {
    protections.push("originalDuration");
  }

  // Only duplicate dates can create retirement candidates.
  const sameDateLessons =
    byDate.get(lesson.date) ?? [];

  const isDuplicateDate =
    sameDateLessons.length > 1;

  // The known historical corruption pattern is:
  //
  //   10:00 -> KEEP
  //   22:00 -> RETIRE candidate
  //
  const isKnownDuplicate22 =
    isDuplicateDate &&
    lesson.start === "22:00" &&
    sameDateLessons.some(
      (item) => item.start === "10:00"
    );

  if (isKnownDuplicate22 && protections.length === 0) {
    return {
      decision: "RETIRE",
      protections,
      attendance: Boolean(related.attendance),
      homework: Boolean(related.homework),
    };
  }

  if (protections.length > 0) {
    return {
      decision: "KEEP",
      protections,
      attendance: Boolean(related.attendance),
      homework: Boolean(related.homework),
    };
  }

  return {
    decision: "KEEP",
    protections,
    attendance: Boolean(related.attendance),
    homework: Boolean(related.homework),
  };
}

// ============================================================
// DETAILED AUDIT
// ============================================================

console.log("============================================================");
console.log(" DETAILED AUDIT");
console.log("============================================================");
console.log("");

const results = [];

for (const lesson of lessons) {
  const analysis = await analyseLesson(lesson);

  results.push({
    lesson,
    ...analysis,
  });

  console.log(`DATE: ${lesson.date}`);
  console.log(`  ID:                    ${lesson.id}`);

  const parsedDate = new Date(`${lesson.date}T00:00:00`);

  console.log(
    `  Weekday:               ${
      Number.isNaN(parsedDate.getTime())
        ? "?"
        : parsedDate.getDay()
    }`
  );

  console.log(
    `  Start:                 ${lesson.start ?? "(none)"}`
  );

  console.log(
    `  Duration:              ${lesson.duration ?? "(none)"}`
  );

  console.log(
    `  Status:                ${lesson.status ?? "(none)"}`
  );

  console.log(
    `  Type:                  ${lesson.type ?? "(none)"}`
  );

  const sameDateLessons =
    byDate.get(lesson.date) ?? [];

  const isDuplicateDate =
    sameDateLessons.length > 1;

  const isKnownDuplicate22 =
    isDuplicateDate &&
    lesson.start === "22:00" &&
    sameDateLessons.some(
      (item) => item.start === "10:00"
    );

  console.log(
    `  Duplicate date:        ${
      isDuplicateDate ? "YES" : "NO"
    }`
  );

  console.log(
    `  Known 22:00 duplicate: ${
      isKnownDuplicate22 ? "YES" : "NO"
    }`
  );

  console.log(
    `  Attendance:            ${
      analysis.attendance ? "YES" : "NO"
    }`
  );

  console.log(
    `  Homework:              ${
      analysis.homework ? "YES" : "NO"
    }`
  );

  console.log(
    `  Notes:                 ${
      hasNotes(lesson) ? "YES" : "NO"
    }`
  );

  console.log(
    `  OriginalDate:          ${
      lesson.originalDate ?? "NONE"
    }`
  );

  console.log(
    `  OriginalStart:         ${
      lesson.originalStart ?? "NONE"
    }`
  );

  console.log(
    `  OriginalDuration:      ${
      lesson.originalDuration ?? "NONE"
    }`
  );

  console.log(
    `  Decision:              ${analysis.decision}`
  );

  if (analysis.protections.length > 0) {
    console.log(
      `  Protected by:          ${analysis.protections.join(", ")}`
    );
  }

  console.log("");
}

// ============================================================
// SUMMARY
// ============================================================

const keepResults = results.filter(
  (item) => item.decision === "KEEP"
);

const retireResults = results.filter(
  (item) => item.decision === "RETIRE"
);

const protectedResults = results.filter(
  (item) => item.protections.length > 0
);

console.log("============================================================");
console.log(" SUMMARY");
console.log("============================================================");
console.log("");

console.log(
  `Historical Regular lessons: ${lessons.length}`
);

console.log(
  `Duplicate historical dates: ${duplicateDates.length}`
);

console.log(
  `KEEP:                       ${keepResults.length}`
);

console.log(
  `RETIRE candidates:          ${retireResults.length}`
);

console.log(
  `PROTECTED:                  ${protectedResults.length}`
);

console.log("");

// ============================================================
// RETIRE IDS
// ============================================================

console.log("============================================================");
console.log(" POTENTIAL RETIRE IDS");
console.log("============================================================");
console.log("");

if (retireResults.length === 0) {
  console.log("None.");
} else {
  for (const item of retireResults) {
    console.log(
      `${item.lesson.id}  ${item.lesson.date} ${item.lesson.start}`
    );
  }
}

console.log("");

// ============================================================
// KEEP IDS
// ============================================================

console.log("============================================================");
console.log(" KEEP IDS");
console.log("============================================================");
console.log("");

for (const item of keepResults) {
  console.log(
    `${item.lesson.id}  ${item.lesson.date} ${item.lesson.start}`
  );
}

console.log("");

// ============================================================
// SAFETY CHECK
// ============================================================
//
// This audit itself is READ ONLY.
//
// After retirement, the expected result is:
//
//   Historical Regular lessons: 50
//   Duplicate historical dates: 0
//   RETIRE candidates:          0
//
// Before retirement, the expected result was:
//
//   Historical Regular lessons: 55
//   Duplicate historical dates: 5
//   RETIRE candidates:          5
//
// ============================================================

console.log("============================================================");
console.log(" SAFETY");
console.log("============================================================");
console.log("");

console.log("- No lesson was deleted.");
console.log("- No lesson was updated.");
console.log("- No lesson was inserted.");
console.log("- Reconciliation was NOT called.");
console.log("- This script only performed MongoDB reads.");
console.log("- RETIRE means candidate only; nothing was removed.");
console.log("");

// ============================================================
// VERIFY EXPECTED RETIREMENT IDS
// ============================================================

const actualRetireIds = retireResults
  .map((item) => item.lesson.id)
  .sort();

const expectedRetireIds = [
  ...EXPECTED_RETIREMENT_IDS,
].sort();

const sameRetireSet =
  actualRetireIds.length === expectedRetireIds.length &&
  actualRetireIds.every(
    (id, index) => id === expectedRetireIds[index]
  );

console.log(
  `Expected retirement set matches: ${
    sameRetireSet ? "YES" : "NO"
  }`
);

if (!sameRetireSet) {
  console.log("");
  console.log("Expected:");
  for (const id of expectedRetireIds) {
    console.log(`- ${id}`);
  }

  console.log("");
  console.log("Actual:");
  for (const id of actualRetireIds) {
    console.log(`- ${id}`);
  }

  console.log("");
  console.log(
    "WARNING: Retirement candidate set does not match the audited set."
  );
}

console.log("");

// ============================================================
// DISCONNECT
// ============================================================

await mongoose.disconnect();

console.log("MongoDB disconnected.");
console.log("");
console.log("Audit complete.");