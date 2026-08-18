import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// HISTORICAL c2 RETIREMENT V2
// ============================================================
//
// Purpose:
// - Retire ONLY the five known historical duplicate lessons.
// - These are the 22:00 lessons accidentally created on Sundays.
// - The corresponding 10:00 lessons are the valid schedule lessons.
//
// IMPORTANT:
// - This script performs WRITE operations.
// - It will NEVER call reconciliation.
// - It will NEVER touch lessons outside the exact five IDs.
// - It will abort if any safety check fails.
//
// Database:
// - Uses MONGODB_DB when present.
// - Falls back to "etlms", matching src/lib/dbConnect.ts.
//
// ============================================================

const CLASS_ID = "c2";
const CUTOFF_DATE = "2026-07-12";

// The exact lessons identified by audit-historical-c2-v2.mjs.
const EXPECTED_RETIREMENTS = [
  {
    id: "L-c2-2026-06-07-2200",
    date: "2026-06-07",
    start: "22:00",
  },
  {
    id: "L-c2-2026-06-14-2200",
    date: "2026-06-14",
    start: "22:00",
  },
  {
    id: "L-c2-2026-06-21-2200",
    date: "2026-06-21",
    start: "22:00",
  },
  {
    id: "L-c2-2026-06-28-2200",
    date: "2026-06-28",
    start: "22:00",
  },
  {
    id: "L-c2-2026-07-05-2200",
    date: "2026-07-05",
    start: "22:00",
  },
];

// ============================================================
// ENV
// ============================================================

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

// IMPORTANT:
// Match the application's dbConnect() behavior.
// If MONGODB_DB is absent, use "etlms".
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
console.log(" HISTORICAL c2 RETIREMENT V2");
console.log(" WRITE OPERATION");
console.log("============================================================");
console.log("");

console.log(`Database: ${dbName}`);
console.log(`Class:    ${CLASS_ID}`);
console.log(`Cutoff:   ${CUTOFF_DATE}`);
console.log("");

console.log("EXPECTED RETIREMENTS:");
for (const item of EXPECTED_RETIREMENTS) {
  console.log(`- ${item.id} | ${item.date} ${item.start}`);
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
console.log(`Connected database: ${mongoose.connection.db?.databaseName}`);
console.log("");

// ============================================================
// DB HANDLE
// ============================================================

const db = mongoose.connection.db;

if (!db) {
  throw new Error("MongoDB database handle unavailable.");
}

const lessonsCollection = db.collection("lessons");
const attendanceCollection = db.collection("attendance");
const homeworkCollection = db.collection("homework");

// ============================================================
// VERIFY DATABASE
// ============================================================

if (mongoose.connection.db?.databaseName !== dbName) {
  throw new Error(
    `Safety check failed: connected to "${mongoose.connection.db?.databaseName}" instead of "${dbName}".`
  );
}

// ============================================================
// LOAD HISTORICAL LESSONS
// ============================================================

const historicalLessons = await lessonsCollection
  .find({
    classId: CLASS_ID,
    type: "regular",
    date: { $lt: CUTOFF_DATE },
  })
  .sort({ date: 1, start: 1 })
  .toArray();

console.log(
  `Historical Regular lessons: ${historicalLessons.length}`
);

console.log("");

// ============================================================
// DUPLICATE DATE ANALYSIS
// ============================================================

console.log("============================================================");
console.log(" DUPLICATE DATE ANALYSIS");
console.log("============================================================");
console.log("");

const byDate = new Map();

for (const lesson of historicalLessons) {
  if (!byDate.has(lesson.date)) {
    byDate.set(lesson.date, []);
  }

  byDate.get(lesson.date).push(lesson);
}

const duplicateDates = [...byDate.entries()]
  .filter(([, items]) => items.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

for (const [date, items] of duplicateDates) {
  console.log(
    `DATE: ${date}  weekday=${items[0]?.weekday ?? "?"}  lessons=${items.length}`
  );

  for (const lesson of items) {
    console.log(
      `  ${lesson.id} | ${lesson.start}/${lesson.duration ?? "?"}`
    );
  }

  console.log("");
}

// ============================================================
// LOAD EXACT RETIREMENT IDS
// ============================================================

console.log("============================================================");
console.log(" FINAL RETIREMENT CANDIDATES");
console.log("============================================================");
console.log("");

const expectedIds = EXPECTED_RETIREMENTS.map((item) => item.id);

const candidateLessons = await lessonsCollection
  .find({
    id: { $in: expectedIds },
  })
  .toArray();

console.log(
  `Found expected lessons: ${candidateLessons.length}/${EXPECTED_RETIREMENTS.length}`
);

for (const lesson of candidateLessons) {
  console.log(
    `- ${lesson.id} | ${lesson.date} ${lesson.start}`
  );
}

console.log("");

// ============================================================
// SAFETY CHECK #1
// ALL FIVE IDS MUST EXIST
// ============================================================

const candidateById = new Map(
  candidateLessons.map((lesson) => [lesson.id, lesson])
);

const missingIds = expectedIds.filter(
  (id) => !candidateById.has(id)
);

if (missingIds.length > 0) {
  throw new Error(
    [
      "Safety check failed.",
      "",
      "The following expected retirement lessons were not found:",
      ...missingIds.map((id) => `- ${id}`),
      "",
      "NO WRITE OPERATION WAS PERFORMED.",
    ].join("\n")
  );
}

// ============================================================
// SAFETY CHECK #2
// EXACT LESSON PROPERTIES
// ============================================================

const invalidLessons = [];

for (const expected of EXPECTED_RETIREMENTS) {
  const lesson = candidateById.get(expected.id);

  if (!lesson) continue;

  const reasons = [];

  if (lesson.classId !== CLASS_ID) {
    reasons.push(`classId=${lesson.classId}`);
  }

  if (lesson.type !== "regular") {
    reasons.push(`type=${lesson.type}`);
  }

  if (lesson.date !== expected.date) {
    reasons.push(`date=${lesson.date}`);
  }

  if (lesson.start !== expected.start) {
    reasons.push(`start=${lesson.start}`);
  }

  if (lesson.date >= CUTOFF_DATE) {
    reasons.push(`date is not historical`);
  }

  if (lesson.status !== "Completed") {
    reasons.push(`status=${lesson.status}`);
  }

  if (lesson.originalDate) {
    reasons.push(`originalDate=${lesson.originalDate}`);
  }

  if (lesson.originalStart) {
    reasons.push(`originalStart=${lesson.originalStart}`);
  }

  if (lesson.originalDuration != null) {
    reasons.push(
      `originalDuration=${lesson.originalDuration}`
    );
  }

  if (typeof lesson.notes === "string") {
    if (lesson.notes.trim().length > 0) {
      reasons.push("has notes");
    }
  } else if (lesson.notes) {
    reasons.push("has notes");
  }

  if (reasons.length > 0) {
    invalidLessons.push({
      id: expected.id,
      reasons,
    });
  }
}

if (invalidLessons.length > 0) {
  console.log("INVALID RETIREMENT CANDIDATES:");

  for (const item of invalidLessons) {
    console.log(`- ${item.id}`);

    for (const reason of item.reasons) {
      console.log(`    ${reason}`);
    }
  }

  console.log("");

  throw new Error(
    [
      "Safety check failed.",
      "One or more retirement candidates are no longer safe.",
      "",
      "NO WRITE OPERATION WAS PERFORMED.",
    ].join("\n")
  );
}

// ============================================================
// SAFETY CHECK #3
// ATTENDANCE / HOMEWORK MUST NOT EXIST
// ============================================================

const protectedByRelatedData = [];

for (const expected of EXPECTED_RETIREMENTS) {
  const lesson = candidateById.get(expected.id);

  const attendance = await attendanceCollection.findOne({
    lessonId: lesson.id,
  });

  const homework = await homeworkCollection.findOne({
    lessonId: lesson.id,
  });

  const reasons = [];

  if (attendance) {
    reasons.push("attendance exists");
  }

  if (homework) {
    reasons.push("homework exists");
  }

  if (reasons.length > 0) {
    protectedByRelatedData.push({
      id: lesson.id,
      reasons,
    });
  }
}

if (protectedByRelatedData.length > 0) {
  console.log("PROTECTED LESSONS:");

  for (const item of protectedByRelatedData) {
    console.log(`- ${item.id}`);

    for (const reason of item.reasons) {
      console.log(`    ${reason}`);
    }
  }

  console.log("");

  throw new Error(
    [
      "Safety check failed.",
      "One or more retirement candidates contain related data.",
      "",
      "NO WRITE OPERATION WAS PERFORMED.",
    ].join("\n")
  );
}

// ============================================================
// SAFETY CHECK #4
// CONFIRM THESE ARE THE DUPLICATE 22:00 LESSONS
// ============================================================

for (const expected of EXPECTED_RETIREMENTS) {
  const sameDateLessons = historicalLessons.filter(
    (lesson) =>
      lesson.date === expected.date &&
      lesson.type === "regular"
  );

  if (sameDateLessons.length !== 2) {
    throw new Error(
      [
        "Safety check failed.",
        `Expected exactly 2 regular lessons on ${expected.date}.`,
        `Found ${sameDateLessons.length}.`,
        "",
        "NO WRITE OPERATION WAS PERFORMED.",
      ].join("\n")
    );
  }

  const starts = sameDateLessons
    .map((lesson) => lesson.start)
    .sort();

  const expectedStarts = ["10:00", "22:00"];

  if (
    starts.length !== 2 ||
    starts[0] !== expectedStarts[0] ||
    starts[1] !== expectedStarts[1]
  ) {
    throw new Error(
      [
        "Safety check failed.",
        `Unexpected schedule on duplicate date ${expected.date}.`,
        `Found starts: ${starts.join(", ")}`,
        "",
        "NO WRITE OPERATION WAS PERFORMED.",
      ].join("\n")
    );
  }
}

// ============================================================
// SAFETY CHECK #5
// EXACTLY FIVE RETIREMENTS
// ============================================================

if (candidateLessons.length !== 5) {
  throw new Error(
    [
      "Safety check failed.",
      `Expected exactly 5 retirement candidates.`,
      `Found ${candidateLessons.length}.`,
      "",
      "NO WRITE OPERATION WAS PERFORMED.",
    ].join("\n")
  );
}

// ============================================================
// FINAL REVIEW
// ============================================================

console.log("============================================================");
console.log(" SAFETY CHECK PASSED");
console.log("============================================================");
console.log("");

console.log("The following 5 lessons are approved for retirement:");

for (const expected of EXPECTED_RETIREMENTS) {
  const lesson = candidateById.get(expected.id);

  console.log(
    `- ${lesson.id} | ${lesson.date} ${lesson.start}`
  );
}

console.log("");

console.log("All safety conditions passed:");
console.log("- Correct database");
console.log("- classId = c2");
console.log("- type = regular");
console.log("- Historical date");
console.log("- status = Completed");
console.log("- No attendance");
console.log("- No homework");
console.log("- No notes");
console.log("- No originalDate");
console.log("- No originalStart");
console.log("- No originalDuration");
console.log("- Exact duplicate-date pattern");
console.log("- Exact 22:00 duplicate lessons");
console.log("- Exactly 5 candidates");
console.log("");

// ============================================================
// WRITE
// ============================================================
//
// RETIREMENT = DELETE
//
// We intentionally delete only the exact five validated IDs.
// No reconciliation is called.
//
// ============================================================

console.log("============================================================");
console.log(" EXECUTING RETIREMENT");
console.log("============================================================");
console.log("");

const result = await lessonsCollection.deleteMany({
  id: {
    $in: expectedIds,
  },

  // Repeat critical guards inside the write query.
  // This protects against a document changing between
  // validation and deletion.
  classId: CLASS_ID,
  type: "regular",
  date: {
    $lt: CUTOFF_DATE,
  },
  start: "22:00",
  status: "Completed",

  originalDate: {
    $exists: false,
  },

  originalStart: {
    $exists: false,
  },

  originalDuration: {
    $exists: false,
  },

  $or: [
    {
      notes: {
        $exists: false,
      },
    },
    {
      notes: null,
    },
    {
      notes: "",
    },
  ],
});

console.log(
  `Deleted lessons: ${result.deletedCount}`
);

console.log("");

// ============================================================
// POST-WRITE VERIFICATION
// ============================================================

console.log("============================================================");
console.log(" POST-WRITE VERIFICATION");
console.log("============================================================");
console.log("");

const remaining = await lessonsCollection
  .find({
    id: {
      $in: expectedIds,
    },
  })
  .toArray();

if (remaining.length !== 0) {
  console.log("WARNING: Some retirement IDs still exist:");

  for (const lesson of remaining) {
    console.log(
      `- ${lesson.id} | ${lesson.date} ${lesson.start}`
    );
  }

  throw new Error(
    "Post-write verification failed."
  );
}

console.log("All five retirement IDs are gone.");
console.log("");

// ============================================================
// FINAL SUMMARY
// ============================================================

console.log("============================================================");
console.log(" RETIREMENT COMPLETE");
console.log("============================================================");
console.log("");

console.log(`Database: ${dbName}`);
console.log(`Class:    ${CLASS_ID}`);
console.log(`Deleted:  ${result.deletedCount}`);

console.log("");

console.log("Retired lessons:");

for (const expected of EXPECTED_RETIREMENTS) {
  console.log(
    `- ${expected.id} | ${expected.date} ${expected.start}`
  );
}

console.log("");

console.log("IMPORTANT:");
console.log("- Only the five audited duplicate lessons were targeted.");
console.log("- The valid 10:00 lessons were NOT touched.");
console.log("- Rescheduled lessons were NOT touched.");
console.log("- Cancelled lessons with notes were NOT touched.");
console.log("- Lessons with attendance/homework were NOT touched.");
console.log("- Reconciliation was NOT called.");
console.log("");

await mongoose.disconnect();

console.log("MongoDB disconnected.");
console.log("");
console.log("Retirement complete.");