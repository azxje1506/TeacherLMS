/* MongoDB Atlas connection — cached across hot reloads and serverless invocations
 * (Vercel) so we never open more than one pool per process. */

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// eslint-disable-next-line no-var
declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function dbConnect(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Add it to .env.local (see .env.example).");
  }
  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      dbName: process.env.MONGODB_DB || "etlms",
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

/** Is this error nothing but duplicate-key noise (code 11000)?
 *
 * Concurrent writers racing on a unique id is expected, not exceptional: the
 * loser's insert is a no-op because the winner wrote the identical document.
 * Lives here rather than in one service because both writers of Regular lessons
 * need it — the read-side `ensureRegularLessons` and the write-side reconciler —
 * and only one of the two may import `server-only`. */
export function isDupKey(e: unknown): boolean {
  const err = e as { code?: number; writeErrors?: Array<{ code?: number }> };
  if (err?.code === 11000) return true;
  return Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 &&
    err.writeErrors.every((w) => w?.code === 11000);
}
