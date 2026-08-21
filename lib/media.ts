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

// `version` is a manual cache-buster for the handful of *fixed-name* keys
// referenced directly in code (e.g. "hero.jpg", "second.jpg" in
// app/page.tsx) that get their content swapped in place from time to time
// via `npm run image:upload`. Vercel's image-optimization cache and CDN
// edge network key on the exact request URL, per edge region, with up to
// a 4-hour TTL — swapping a fixed key's content without changing the URL
// means some regions can keep serving the old image for hours after the
// swap. Bump `version` to any new string (the upload script prints one)
// whenever you replace one of these in place; MasonryPhoto/GalleryImage
// entries don't need this, since each new upload already gets its own
// unique key.
export function publicImageUrl(key: string, version?: string): string {
  const base = `${PUBLIC_IMAGES_BASE_URL}/${key}`;
  return version ? `${base}?v=${version}` : base;
}
