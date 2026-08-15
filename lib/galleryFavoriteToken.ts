// Short-lived, gallery-scoped session token — issued by
// /api/gallery-access once the password (and PIN, if set) check
// succeeds, verified by /api/gallery-access/favorite on every
// heart-toggle request. Modeled on lib/adminAccess.ts's HMAC approach,
// but the expiry is embedded in the token itself (like an S3 presigned
// URL's signature covers its expiry) so verification never needs a
// database or session lookup.

import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.GALLERY_FAVORITE_TOKEN_SECRET;
  if (!secret) {
    throw new Error("GALLERY_FAVORITE_TOKEN_SECRET is not set.");
  }
  return secret;
}

function sign(slug: string, expiresAt: number): string {
  return createHmac("sha256", getSecret())
    .update(`${slug}:${expiresAt}`)
    .digest("hex");
}

export function createFavoriteToken(slug: string, expiresAt: number): string {
  return `${expiresAt}.${sign(slug, expiresAt)}`;
}

export function isValidFavoriteToken(slug: string, token: string): boolean {
  const [expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!signature || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    return false;
  }

  let expected: string;
  try {
    expected = sign(slug, expiresAt);
  } catch {
    return false;
  }

  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expected);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
