/**
 * JWT helpers (edge-runtime safe: depends only on `jose`).
 * Session cookie payload: { sub: userId, sv: sessionVersion, typ: "session" }.
 * WebSocket token payload: { sub, sv, typ: "ws" }, valid for 60 seconds.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "derms_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours
export const WS_TOKEN_TTL_SECONDS = 60;
const ISSUER = "derms";

export interface TokenClaims {
  sub: string;
  sv: number;
  typ: "session" | "ws";
  jti?: string;
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? "";
  if (s.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(s);
}

async function sign(claims: TokenClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ sv: claims.sv, typ: claims.typ })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setJti(crypto.randomUUID()) // unique per token (iat has 1 s resolution)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

async function verify(token: string, typ: TokenClaims["typ"]): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (payload.typ !== typ || typeof payload.sub !== "string" || typeof payload.sv !== "number") return null;
    return { sub: payload.sub, sv: payload.sv, typ, jti: typeof payload.jti === "string" ? payload.jti : undefined };
  } catch {
    return null;
  }
}

export const signSessionToken = (sub: string, sv: number) => sign({ sub, sv, typ: "session" }, SESSION_MAX_AGE_SECONDS);
export const verifySessionToken = (t: string) => verify(t, "session");
export const signWsToken = (sub: string, sv: number) => sign({ sub, sv, typ: "ws" }, WS_TOKEN_TTL_SECONDS);
export const verifyWsToken = (t: string) => verify(t, "ws");
