/* Route protection (Next.js 16 proxy convention, formerly middleware): everything
 * under the app shell requires a valid session. Runs on the edge; uses only the
 * jose-based verifier (no Node modules). */

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

const PUBLIC_PATHS = ["/login"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // Authenticated users landing on /login go to the dashboard.
  if (session && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  // Unauthenticated users are sent to /login (preserving intended destination).
  if (!session && !isPublic) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except Next internals, API routes (guarded per-handler) and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
