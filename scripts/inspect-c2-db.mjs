import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";

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

await mongoose.connect(mongoUri, {
  autoIndex: false,
  autoCreate: false,
});

const db = mongoose.connection.db;

if (!db) {
  throw new Error("MongoDB database handle unavailable.");
}

console.log("");
console.log("============================================================");
console.log(" C2 DATABASE DIAGNOSTIC");
console.log(" READ ONLY");
console.log("============================================================");
console.log("");

console.log("Database:", db.databaseName);
console.log("Host:", mongoose.connection.host);
console.log("");

const collections = await db.listCollections().toArray();

console.log("Collections:");
for (const collection of collections) {
  console.log(`- ${collection.name}`);
}

console.log("");

const lessonsCollection = db.collection("lessons");

const totalLessons = await lessonsCollection.countDocuments();

console.log("Total lessons:", totalLessons);
console.log("");

console.log("============================================================");
console.log(" SAMPLE LESSONS");
console.log("============================================================");
console.log("");

const samples = await lessonsCollection
  .find({})
  .sort({ date: 1 })
  .limit(20)
  .project({
    _id: 1,
    id: 1,
    classId: 1,
    type: 1,
    date: 1,
    start: 1,
    duration: 1,
    status: 1,
  })
  .toArray();

for (const lesson of samples) {
  console.log(
    JSON.stringify(
      {
        _id: lesson._id,
        id: lesson.id,
        classId: lesson.classId,
        type: lesson.type,
        date: lesson.date,
        start: lesson.start,
        duration: lesson.duration,
        status: lesson.status,
      },
      null,
      2
    )
  );
}

console.log("");

console.log("============================================================");
console.log(" CLASS / TYPE / DATE ANALYSIS");
console.log("============================================================");
console.log("");

const classIds = await lessonsCollection.distinct("classId");
console.log("classId values:");
console.log(classIds);

console.log("");

const types = await lessonsCollection.distinct("type");
console.log("type values:");
console.log(types);

console.log("");

const dates = await lessonsCollection
  .find({})
  .sort({ date: 1 })
  .project({ _id: 0, date: 1 })
  .limit(10)
  .toArray();

console.log("Earliest dates:");
console.log(dates);

console.log("");

console.log("============================================================");
console.log(" C2 QUERY TESTS");
console.log("============================================================");

const tests = [
  {
    name: "classId = c2",
    filter: {
      classId: "c2",
    },
  },
  {
    name: "type = regular",
    filter: {
      type: "regular",
    },
  },
  {
    name: "date < 2026-07-12",
    filter: {
      date: { $lt: "2026-07-12" },
    },
  },
  {
    name: "classId + type",
    filter: {
      classId: "c2",
      type: "regular",
    },
  },
  {
    name: "classId + date",
    filter: {
      classId: "c2",
      date: { $lt: "2026-07-12" },
    },
  },
  {
    name: "type + date",
    filter: {
      type: "regular",
      date: { $lt: "2026-07-12" },
    },
  },
  {
    name: "FULL historical query",
    filter: {
      classId: "c2",
      type: "regular",
      date: { $lt: "2026-07-12" },
    },
  },
];

console.log("");

for (const test of tests) {
  const count = await lessonsCollection.countDocuments(test.filter);

  console.log(`${test.name}: ${count}`);
}

console.log("");

console.log("============================================================");
console.log(" SPECIFIC RETIREMENT IDS");
console.log("============================================================");
console.log("");

const expectedIds = [
  "L-c2-2026-06-07-2200",
  "L-c2-2026-06-14-2200",
  "L-c2-2026-06-21-2200",
  "L-c2-2026-06-28-2200",
  "L-c2-2026-07-05-2200",
];

for (const id of expectedIds) {
  const lesson = await lessonsCollection.findOne({ id });

  console.log(
    id,
    lesson
      ? JSON.stringify(
          {
            classId: lesson.classId,
            type: lesson.type,
            date: lesson.date,
            start: lesson.start,
            duration: lesson.duration,
            status: lesson.status,
          },
          null,
          2
        )
      : "NOT FOUND"
  );
}

console.log("");

console.log("============================================================");
console.log(" READ ONLY — NO DATA WAS CHANGED");
console.log("============================================================");
console.log("");

await mongoose.disconnect();