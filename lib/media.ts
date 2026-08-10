// Public Cloudflare R2 bucket ("zkjfilms-public") for site marketing/portfolio
// images — distinct from the private client-gallery bucket (lib/r2.ts, "zk-
// client-galleries"), which serves photos via short-lived signed URLs and
// must never be made public. This bucket has R2's "Public Development URL"
// feature enabled, so anything uploaded here (see scripts/uploadImage.mjs) is
// permanently and publicly readable at `${PUBLIC_IMAGES_BASE_URL}/<key>` —
// no signing, no expiry, cacheable like any other public asset.
//
// Not a secret — safe to hardcode and commit. Keep this in sync with the
// literal of the same name in scripts/uploadImage.mjs (that script can't
// import this file directly since it runs as plain Node, not through
// Next/TypeScript) and with the hostname in next.config.ts's remotePatterns
// (which imports this file).
export const PUBLIC_IMAGES_BASE_URL =
  "https://pub-a78d2319f08941ff9a3249390ab8f644.r2.dev";

export function publicImageUrl(key: string): string {
  return `${PUBLIC_IMAGES_BASE_URL}/${key}`;
}
