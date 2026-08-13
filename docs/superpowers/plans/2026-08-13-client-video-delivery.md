# Client Video Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let video files be uploaded into an existing client gallery alongside photos, through the same `gallery:upload` command, and displayed inline in the same grid/lightbox — no new bucket, no new table, no separate access gate.

**Architecture:** One extension point in each of 4 files: `scripts/gallery.mjs`'s upload content-type map gains `.mp4`; `lib/r2.ts`'s gallery listing tags each item with `isVideo` (computed from extension) and its exported type is renamed `GalleryImage` → `GalleryMedia` to reflect that; `GalleryGate.tsx`'s grid and `GalleryLightbox.tsx` both branch on `isVideo` to render `<video>` instead of `<img>`. No API route changes — `/api/gallery-access` already returns whatever `listGalleryImages` gives it, untouched.

**Tech Stack:** TypeScript (Next.js Server/Client Components), Node.js (CLI script), Cloudflare R2 (`@aws-sdk/client-s3`).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-client-video-delivery-design.md`.
- MP4 only for v1 — no other video format is recognized by the upload CLI or treated as video by the listing logic.
- No poster/thumbnail upload step for client videos — thumbnails are the browser-rendered first frame via `preload="metadata"`, never a separately uploaded image (this is a deliberate difference from the public showcase videos feature, which does require an explicit poster).
- No autoplay anywhere — the lightbox video player starts paused with `controls`.
- This feature must not touch `app/films/page.tsx`, `scripts/video.mjs`, the `videos` table, or the public R2 bucket — entirely separate infrastructure from the public showcase videos shipped earlier.
- This feature must not touch gallery creation, expiration, archiving, or the password/PIN access flow (`app/api/gallery-access/route.ts` needs zero changes — confirmed by inspection: it only imports `listGalleryImages`/`SIGNED_URL_EXPIRY_SECONDS` from `lib/r2.ts`, never the `GalleryImage`/`GalleryMedia` type by name).
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, and manual CLI/browser checks, following the same pattern as every prior plan in this repo.

---

## Task 1: Video support across the gallery stack

**Files:**
- Modify: `lib/r2.ts`
- Modify: `scripts/gallery.mjs:106-118`
- Modify: `app/gallery/[slug]/GalleryGate.tsx`
- Modify: `app/gallery/[slug]/GalleryLightbox.tsx`

**Interfaces:**
- Produces: `export type GalleryMedia = { key: string; url: string; downloadUrl: string; filename: string; isVideo: boolean }` from `lib/r2.ts`, replacing the removed `GalleryImage` export. Every file that imported `GalleryImage` is updated in this same task — there is no intermediate state where the codebase doesn't compile, so this is one task rather than split across a "backend" and "frontend" step.

This is one task (not split further) because tagging each gallery item with `isVideo` in `lib/r2.ts` has no independently observable behavior until the two rendering files actually branch on it — splitting the type/data change from its two consumers would leave an intermediate commit that compiles but does nothing new, the same reasoning the prior password-reveal-toggle plan used to keep its shared component and its 3 call sites in one task.

- [ ] **Step 1: Extend the upload content-type map in `scripts/gallery.mjs`**

Replace this exact block (lines 111-118):

```js
const UPLOAD_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};
```

with:

```js
const UPLOAD_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};
```

This is the entire CLI-side change. `upload()`'s existing logic (scan folder, check extension against this map, upload matches, skip/warn on the rest) already handles a mixed folder of photos and videos with no other modification — confirm this by reading `upload()` in full before moving on, so you understand why no other line in this function needs to change.

- [ ] **Step 2: Rename `GalleryImage` to `GalleryMedia` and add `isVideo` in `lib/r2.ts`**

Replace this exact block:

```ts
// S3-compatible client for Cloudflare R2, used by the client gallery
// feature to store and serve images.

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "";

export function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export type GalleryImage = {
  key: string;
  url: string;
  downloadUrl: string;
  filename: string;
};

export const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

// Images for a gallery live under galleries/<slug>/ in the bucket. Signed
// URLs expire after an hour — a client browsing longer than that in one
// sitting would need to re-unlock to get fresh URLs.
//
// Two signed URLs per image: `url` for inline display, and `downloadUrl`
// with a Content-Disposition override so browsers reliably save it as a
// file with the right name instead of navigating to it — the plain HTML
// `download` attribute isn't consistently honored for cross-origin URLs.
export async function listGalleryImages(slug: string): Promise<GalleryImage[]> {
  const client = getR2Client();

  const listing = await client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `galleries/${slug}/`,
    }),
  );

  const objects = (listing.Contents ?? []).filter(
    (obj): obj is typeof obj & { Key: string } =>
      typeof obj.Key === "string" && !obj.Key.endsWith("/"),
  );

  return Promise.all(
    objects.map(async (obj) => {
      const filename = obj.Key.split("/").pop() || obj.Key;

      const [url, downloadUrl] = await Promise.all([
        getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: obj.Key }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: obj.Key,
            ResponseContentDisposition: `attachment; filename="${filename}"`,
          }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
      ]);

      return { key: obj.Key, url, downloadUrl, filename };
    }),
  );
}
```

with:

```ts
// S3-compatible client for Cloudflare R2, used by the client gallery
// feature to store and serve photos and videos.

import { extname } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "";

export function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export type GalleryMedia = {
  key: string;
  url: string;
  downloadUrl: string;
  filename: string;
  isVideo: boolean;
};

export const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

// Kept in sync with UPLOAD_CONTENT_TYPES's video entries in
// scripts/gallery.mjs by hand — that script can't import this file since
// it runs as plain Node, not through Next/TypeScript.
const VIDEO_EXTENSIONS = new Set([".mp4"]);

function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filename).toLowerCase());
}

// A gallery can hold a mix of photos and short client-delivery videos —
// this list treats them uniformly (same signed-URL mechanism, same
// listing) and just tags each item so the UI knows how to render it.
//
// Media for a gallery lives under galleries/<slug>/ in the bucket. Signed
// URLs expire after an hour — a client browsing longer than that in one
// sitting would need to re-unlock to get fresh URLs.
//
// Two signed URLs per item: `url` for inline display/playback, and
// `downloadUrl` with a Content-Disposition override so browsers reliably
// save it as a file with the right name instead of navigating to it — the
// plain HTML `download` attribute isn't consistently honored for
// cross-origin URLs. Both work identically for photos and videos — R2
// presigned GET URLs support HTTP Range requests regardless of content
// type, so video seeking/scrubbing works the same way it does for the
// public showcase videos (app/films).
export async function listGalleryImages(slug: string): Promise<GalleryMedia[]> {
  const client = getR2Client();

  const listing = await client.send(
    new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `galleries/${slug}/`,
    }),
  );

  const objects = (listing.Contents ?? []).filter(
    (obj): obj is typeof obj & { Key: string } =>
      typeof obj.Key === "string" && !obj.Key.endsWith("/"),
  );

  return Promise.all(
    objects.map(async (obj) => {
      const filename = obj.Key.split("/").pop() || obj.Key;

      const [url, downloadUrl] = await Promise.all([
        getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: obj.Key }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: obj.Key,
            ResponseContentDisposition: `attachment; filename="${filename}"`,
          }),
          { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
        ),
      ]);

      return { key: obj.Key, url, downloadUrl, filename, isVideo: isVideoFile(filename) };
    }),
  );
}
```

Note the function name `listGalleryImages` is deliberately **not** renamed — `app/api/gallery-access/route.ts` imports it by that name and this task doesn't touch that file; renaming the function would be a gratuitous ripple with no benefit (the type it returns, not the function's own name, is what needed to stop being misleading).

- [ ] **Step 3: Rename `GalleryImage` to `GalleryMedia` in `app/gallery/[slug]/GalleryGate.tsx`**

Replace every occurrence of the identifier `GalleryImage` with `GalleryMedia` in this file — a plain type rename, no logic changes. There are 7 occurrences, all in type positions:

- Line 4: `import type { GalleryImage } from "@/lib/r2";`
- Line 10: `  images: GalleryImage[];` (inside the `Session` type)
- Line 18: `function triggerDownload(image: GalleryImage) {`
- Line 32: `async function triggerDownloads(images: GalleryImage[]) {`
- Line 121: `    images?: GalleryImage[];` (inside `commitSession`'s parameter type)
- Line 162: `        images?: GalleryImage[];` (inside `handleSubmit`'s response type)
- Line 203: `        images?: GalleryImage[];` (inside `handlePinSubmit`'s response type)

- [ ] **Step 4: Add video rendering to the gallery grid in `app/gallery/[slug]/GalleryGate.tsx`**

Replace this exact block (the `.map()` that renders each grid tile):

```tsx
              {images.map((image, i) => (
                <div
                  key={image.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLightboxIndex(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLightboxIndex(i);
                    }
                  }}
                  className="group relative aspect-square cursor-pointer overflow-hidden bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a static/optimizable asset */}
                  <img
                    src={image.url}
                    alt={`${title} photo`}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  />

                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded bg-black/40 backdrop-blur-sm"
                  >
                    <span className="sr-only">Select this photo</span>
                    <input
                      type="checkbox"
                      checked={selected.has(image.key)}
                      onChange={() => toggleSelect(image.key)}
                      className="h-4 w-4 accent-accent"
                    />
                  </label>

                  <a
                    href={image.downloadUrl}
                    download={image.filename}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-2 right-2 z-10 rounded bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                  >
                    Download
                  </a>
                </div>
              ))}
```

with:

```tsx
              {images.map((media, i) => (
                <div
                  key={media.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLightboxIndex(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLightboxIndex(i);
                    }
                  }}
                  className="group relative aspect-square cursor-pointer overflow-hidden bg-surface"
                >
                  {media.isVideo ? (
                    <video
                      src={media.url}
                      preload="metadata"
                      muted
                      playsInline
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a static/optimizable asset
                    <img
                      src={media.url}
                      alt={`${title} photo`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    />
                  )}

                  {media.isVideo && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                        <PlayIcon />
                      </div>
                    </div>
                  )}

                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded bg-black/40 backdrop-blur-sm"
                  >
                    <span className="sr-only">
                      Select this {media.isVideo ? "video" : "photo"}
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.has(media.key)}
                      onChange={() => toggleSelect(media.key)}
                      className="h-4 w-4 accent-accent"
                    />
                  </label>

                  <a
                    href={media.downloadUrl}
                    download={media.filename}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-2 right-2 z-10 rounded bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                  >
                    Download
                  </a>
                </div>
              ))}
```

Then add a `PlayIcon` helper function at the very end of the file (after the default-exported `GalleryGate` function's closing brace), matching the icon-helper-function placement convention already used in `components/PasswordField.tsx` (`EyeIcon`/`EyeOffIcon` defined below the component that uses them):

```tsx

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6 text-white"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
```

- [ ] **Step 5: Rename `GalleryImage` to `GalleryMedia` and add video rendering in `app/gallery/[slug]/GalleryLightbox.tsx`**

Replace:

```tsx
"use client";

import { useEffect } from "react";
import type { GalleryImage } from "@/lib/r2";

export default function GalleryLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
```

with:

```tsx
"use client";

import { useEffect } from "react";
import type { GalleryMedia } from "@/lib/r2";

export default function GalleryLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: GalleryMedia[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
```

Then replace:

```tsx
      {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URL */}
      <img
        src={image.url}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain"
      />
```

with:

```tsx
      {image.isVideo ? (
        <video
          src={image.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
        <img
          src={image.url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      )}
```

No `autoPlay` attribute — the video starts paused with visible controls, same as a photo does nothing automatic on open.

- [ ] **Step 6: `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors. This confirms the `GalleryImage` → `GalleryMedia` rename is complete and consistent everywhere (a leftover reference to the old name anywhere would fail `tsc`).

- [ ] **Step 7: Manually verify against the real Supabase project, R2 bucket, and browser**

You'll need a small `.mp4` file and at least one small image file locally for this (any short test clip and any test image work — check `/Users/zachjohnson/Downloads` for existing small sample files if you don't have your own).

Create a scratch gallery and upload a mixed folder:

```bash
npm run gallery:create -- test-gallery-video "Test Gallery" "Test Client"
```

(Note the printed password.) Put both a test image and the test `.mp4` in one local folder, then:

```bash
npm run gallery:upload -- test-gallery-video /path/to/mixed-folder
```

Expected: both files upload — the summary line should show `Uploaded 2 photo(s)` (the CLI's counter doesn't distinguish video from image in its own output, since `UPLOAD_CONTENT_TYPES` treats them uniformly — this is expected, not a bug to fix).

In the browser (`npm run dev` if not already running): visit `/gallery/test-gallery-video`, enter the password, confirm:
- The grid shows both the photo tile and the video tile.
- The video tile shows a real first-frame thumbnail (not a blank/broken box) and a visible play-icon overlay centered on it.
- Clicking the video tile opens the lightbox with a working `<video controls>` player — press play, confirm it plays and can be paused/sought; confirm it does **not** start playing automatically when the lightbox opens.
- Arrow-key/button navigation in the lightbox moves correctly between the photo and video items in both directions.
- "Select this video" (not "Select this photo") appears as the checkbox's accessible name when hovering/inspecting the video tile's checkbox.
- Select both items and click "Download selected" — confirm both files download successfully with correct filenames (the video should download as a playable `.mp4`, not corrupted).
- Reload the page (still within the session's unlock window) — confirm both items still render correctly (proves the signed URLs work identically for both on a fresh render, not just the initial unlock).

Finally, confirm no regression on a real existing gallery with no videos: visit `/gallery/andi` (photo-only), confirm it renders and behaves exactly as before — normal grid, normal lightbox, no video-related UI appearing anywhere.

Clean up: `npm run gallery:delete -- test-gallery-video --yes`.

- [ ] **Step 8: Commit**

```bash
git add lib/r2.ts scripts/gallery.mjs "app/gallery/[slug]/GalleryGate.tsx" "app/gallery/[slug]/GalleryLightbox.tsx"
git commit -m "Support video files in client galleries, alongside photos"
```
