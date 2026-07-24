/* Small helpers for Route Handlers: JSON responses and an auth guard. */

import { NextResponse } from "next/server";
import { getSession } from "./auth";
import type { SessionPayload } from "./jwt";

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Resolve the session or throw a 401 response. Use in Route Handlers via try/catch. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw error("Unauthorized", 401);
  return session;
}

/** Wrap a Route Handler body so thrown NextResponse errors surface cleanly. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NextResponse || e instanceof Response) return e;
    console.error("[api] unhandled:", e);
    return error("Internal server error", 500);
  }
}
