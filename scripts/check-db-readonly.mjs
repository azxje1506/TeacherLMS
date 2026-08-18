import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "etlms";

const CLASS_ID = "c2";
const CUTOFF_DATE = "2026-07-12";

const EXPECTED_RETIRED_IDS = [
  "L-c2-2026-06-07-2200",
  "L-c2-2026-06-14-2200",
  "L-c2-2026-06-21-2200",
  "L-c2-2026-06-28-2200",
  "L-c2-2026-07-05-2200",
];

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set.");
}

const client = new MongoClient(MONGODB_URI);

try {
  console.log("Connecting...\n");

  await client.connect();

  const db = client.db(DB_NAME);
  const lessonsCollection = db.collection("lessons");

console.log("========== DATABASE INFO ==========");

const maskedUri = MONGODB_URI.replace(
  /^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/,
  "$1$2:****@"
);

console.log(`URI: ${maskedUri}`);
console.log(`Database: ${db.databaseName}`);
console.log("===================================\n");

  // ------------------------------------------------------------
  // 1. Basic counts
  // ------------------------------------------------------------

  const c2RegularCount = await lessonsCollection.countDocuments({
    classId: CLASS_ID,
    type: "regular",
  });

  const c2HistoricalCount = await lessonsCollection.countDocuments({
    classId: CLASS_ID,
    type: "regular",
    date: { $lt: CUTOFF_DATE },
  });

  console.log(`c2 regular lessons: ${c2RegularCount}`);
  console.log(`c2 historical regular lessons: ${c2HistoricalCount}\n`);

  // ------------------------------------------------------------
  // 2. Sample lessons
  // ------------------------------------------------------------

  console.log("========== SAMPLE LESSONS ==========");

  const samples = await lessonsCollection
    .find({
      classId: CLASS_ID,
      type: "regular",
    })
    .sort({ date: 1, start: 1 })
    .limit(10)
    .project({
      _id: 0,
      id: 1,
      date: 1,
      start: 1,
      duration: 1,
      status: 1,
      type: 1,
      originalDate: 1,
      originalStart: 1,
      originalDuration: 1,
    })
    .toArray();

  for (const lesson of samples) {
    console.log(
      `${lesson.id} | ${lesson.date} ${lesson.start} | ` +
        `${lesson.status ?? "?"} | type=${lesson.type}`
    );
  }

  // ------------------------------------------------------------
  // 3. Historical duplicate-date analysis
  // ------------------------------------------------------------

  console.log("\n========== HISTORICAL DUPLICATE CHECK ==========");

  const historicalLessons = await lessonsCollection
    .find({
      classId: CLASS_ID,
      type: "regular",
      date: { $lt: CUTOFF_DATE },
    })
    .sort({ date: 1, start: 1 })
    .toArray();

  const byDate = new Map();

  for (const lesson of historicalLessons) {
    if (!byDate.has(lesson.date)) {
      byDate.set(lesson.date, []);
    }

    byDate.get(lesson.date).push(lesson);
  }

  const duplicateDates = [...byDate.entries()].filter(
    ([, lessons]) => lessons.length > 1
  );

  if (duplicateDates.length === 0) {
    console.log("No duplicate historical dates found.");
  } else {
    console.log(`Duplicate historical dates: ${duplicateDates.length}\n`);

    for (const [date, lessons] of duplicateDates) {
      console.log(`DATE: ${date} | lessons=${lessons.length}`);

      for (const lesson of lessons) {
        console.log(
          `  ${lesson.id} | ${lesson.start}/${lesson.duration ?? "?"}`
        );
      }
    }
  }

  // ------------------------------------------------------------
  // 4. Verify the five retired IDs
  // ------------------------------------------------------------

  console.log("\n========== RETIRED ID VERIFICATION ==========");

  let remainingRetired = 0;

  for (const id of EXPECTED_RETIRED_IDS) {
    const lesson = await lessonsCollection.findOne(
      { id },
      {
        projection: {
          _id: 0,
          id: 1,
          classId: 1,
          type: 1,
          date: 1,
          start: 1,
        },
      }
    );

    if (lesson) {
      remainingRetired++;

      console.log(
        `${id} STILL EXISTS | ${lesson.date} ${lesson.start} | ` +
          `class=${lesson.classId} type=${lesson.type}`
      );
    } else {
      console.log(`${id} NOT FOUND`);
    }
  }

  // ------------------------------------------------------------
  // 5. Final status
  // ------------------------------------------------------------

  console.log("\n============================================================");
  console.log(" FINAL DATABASE VERIFICATION");
  console.log("============================================================");

  console.log(`Database:                 ${db.databaseName}`);
  console.log(`Class:                    ${CLASS_ID}`);
  console.log(`Historical Regular:       ${c2HistoricalCount}`);
  console.log(`Duplicate historical:     ${duplicateDates.length}`);
  console.log(`Retired IDs still present: ${remainingRetired}`);

  if (duplicateDates.length === 0 && remainingRetired === 0) {
    console.log("\nSTATUS: PASS");
    console.log(
      "Historical c2 lessons contain no duplicate dates, and all five"
    );
    console.log("expected retirement IDs are gone.");
  } else {
    console.log("\nSTATUS: REVIEW REQUIRED");

    if (duplicateDates.length > 0) {
      console.log(
        `- ${duplicateDates.length} duplicate historical date(s) remain.`
      );
    }

    if (remainingRetired > 0) {
      console.log(
        `- ${remainingRetired} retired lesson(s) still exist.`
      );
    }
  }

  console.log("\nREAD ONLY — NO DATA WAS CHANGED");
} finally {
  await client.close();
}