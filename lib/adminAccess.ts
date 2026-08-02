// Server-side access control for /admin. Same pattern as
// lib/gatedAccess.ts (HMAC-signed session cookie, password never stored
// in the cookie itself) — kept separate since it's a distinct trust
// level: this gates a list of all client galleries, not one client's own
// photos.

import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_ACCESS_COOKIE = "admin_access";

const TOKEN_PAYLOAD = "granted";

function getSecret(): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error("ADMIN_PASSWORD is not set.");
  }
  return secret;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function checkPassword(password: string): boolean {
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return false;
  }
  return timingSafeStringEqual(password, secret);
}

export function createAccessToken(): string {
  return createHmac("sha256", getSecret()).update(TOKEN_PAYLOAD).digest("hex");
}

export function isValidAccessToken(token: string | undefined | null): boolean {
  if (!token) return false;
  let expected: string;
  try {
    expected = createAccessToken();
  } catch {
    return false;
  }
  return timingSafeStringEqual(token, expected);
}
