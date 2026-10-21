import { cookies } from "next/headers";
import { loadUserForClaims } from "./user-loader";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSessionToken, verifySessionToken } from "./tokens";
import type { SessionUser } from "./rbac";

export { toSessionUser, loadUserForClaims, type UserRecordLike } from "./user-loader";

/** Current user from the HttpOnly session cookie, validated against the database on every call. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  return loadUserForClaims(claims.sub, claims.sv);
}

export async function setSessionCookie(userId: string, sessionVersion: number) {
  const token = await signSessionToken(userId, sessionVersion);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
}
