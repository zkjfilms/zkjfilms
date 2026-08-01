// Server-side access control for /gated. The password check and the
// cookie that proves access both live here so app/gated/page.tsx (a
// Server Component) can decide what to render before anything reaches
// the client — the gallery markup is never sent to a browser that
// hasn't passed the gate.

import { createHmac, timingSafeEqual } from "node:crypto";

export const GATED_ACCESS_COOKIE = "gated_access";

// Cookie carries an HMAC of a fixed payload rather than the password
// itself, so it can't be read back out into a password and can't be
// forged without knowing GATED_ACCESS_PASSWORD.
const TOKEN_PAYLOAD = "granted";

function getSecret(): string {
  const secret = process.env.GATED_ACCESS_PASSWORD;
  if (!secret) {
    throw new Error("GATED_ACCESS_PASSWORD is not set.");
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
