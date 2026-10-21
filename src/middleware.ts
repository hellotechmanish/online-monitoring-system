import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/tokens";

/**
 * Edge middleware:
 *  - CSRF defence: state-changing /api requests must come from the same origin
 *    (Origin header checked; SameSite=Lax cookies add a second layer).
 *  - Redirects unauthenticated page requests to /login.
 * Full authorization (active user, session version, role, Site access) is
 * enforced again in every route handler and server component.
 */
const PUBLIC_PAGES = ["/login"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins(req: NextRequest): Set<string> {
  const s = new Set<string>([req.nextUrl.origin]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (host) s.add(`${proto}://${host}`);
  if (process.env.APP_URL) {
    try {
      s.add(new URL(process.env.APP_URL).origin);
    } catch {
      /* ignore malformed APP_URL */
    }
  }
  return s;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (MUTATING.has(req.method)) {
      const allowed = allowedOrigins(req);
      const origin = req.headers.get("origin");
      let sameOrigin = origin ? allowed.has(origin) : false;
      if (!origin) {
        // Fallbacks for clients that omit Origin: Fetch Metadata, then Referer.
        const site = req.headers.get("sec-fetch-site");
        const referer = req.headers.get("referer");
        if (site) sameOrigin = site === "same-origin";
        else if (referer) {
          try {
            sameOrigin = allowed.has(new URL(referer).origin);
          } catch {
            sameOrigin = false;
          }
        }
      }
      if (!sameOrigin) {
        return NextResponse.json({ error: { message: "Cross-origin request rejected", code: "CSRF" } }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifySessionToken(token) : null;

  if (PUBLIC_PAGES.includes(pathname)) {
    // `expired=1` is set by the app layout when a signed cookie no longer maps to an
    // active account (deactivated / password changed): clear it to avoid a redirect loop.
    if (req.nextUrl.searchParams.has("expired")) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    if (valid) return NextResponse.redirect(new URL("/monitoring", req.url));
    return NextResponse.next();
  }

  if (!valid) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + req.nextUrl.search);
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
