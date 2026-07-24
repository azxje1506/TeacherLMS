/* Edge-safe JWT sign/verify (jose). Used by both Route Handlers and middleware,
 * so it must not import Node-only modules (mongoose, bcrypt). */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "etlms_session";
const ALG = "HS256";

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set. Add it to .env.local (see .env.example).");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload extends JWTPayload {
  sub: string; // user id / email
  email: string;
  name: string;
}

/** Sign a session token. Default 7-day expiry (matches "Remember me"). */
export async function signSession(user: { sub: string; email: string; name: string }, maxAgeSec = 60 * 60 * 24 * 7): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSec)
    .sign(secretKey());
}

/** Verify a session token; returns the payload or null. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALG] });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
