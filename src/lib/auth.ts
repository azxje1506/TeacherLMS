/* Server-side auth helpers (Node runtime): read/write the HttpOnly session cookie
 * and resolve the current session inside Server Components and Route Handlers. */

import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, signSession, verifySession, type SessionPayload } from "./jwt";

const WEEK = 60 * 60 * 24 * 7;

/** Issue the HttpOnly session cookie. `remember` extends lifetime to a week. */
export async function createSessionCookie(user: { id: string; email: string; name: string }, remember: boolean) {
  const maxAge = remember ? WEEK : 60 * 60 * 12; // 12h vs 7d
  const token = await signSession({ sub: user.id, email: user.email, name: user.name }, maxAge);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: remember ? maxAge : undefined, // session cookie when not remembered
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The current session payload, or null if unauthenticated. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
