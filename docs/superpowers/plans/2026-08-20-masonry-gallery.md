# Masonry Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-splash gallery on `/headshots` and `/creative-portraits` with a true masonry grid (mixed horizontal/vertical tiles, each at its own natural aspect ratio, no cropping) plus a click-to-enlarge lightbox, and extend the photo-upload script to compute real dimensions and suggest SEO alt text automatically.

**Architecture:** A new `MasonryPhoto` data type and placeholder photo lists (`lib/masonryPhotos.ts`), a new `MasonryGallery` component (CSS multi-column layout + a hand-built lightbox), and `ServiceLandingPage` branching to render it for `headshots`/`creative-portraits` while every other page's rendering is untouched. Separately, `scripts/uploadImage.mjs` gets two additions — real dimension reading via `sharp` and AI-suggested alt text via a direct Anthropic API call — both printing a ready-to-paste data snippet.

**Tech Stack:** Next.js (App Router, `next/image`), Tailwind CSS multi-column layout, `sharp` (already an undeclared transitive dependency), `@anthropic-ai/sdk` (new).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-20-masonry-gallery-design.md`.
- No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run build`, and manual browser checks — same pattern as every prior plan here.
- **`/portraits`, `Gallery.tsx`, `HEADSHOTS_GALLERY`, `CREATIVE_PORTRAITS_GALLERY`, and the Boudoir page must not change behavior.** `/portraits` imports `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` directly (not through `Service`) — those constants and the component that renders them are never touched by this plan. The new masonry data lives in entirely separate constants.
- No native CSS masonry (`display: grid-lanes` / `grid-template-rows: masonry`) — not reliably supported across browsers as of this plan. Use CSS multi-column (`columns-*`) instead.
- No face/subject-detection, no smart-crop, no `object-fit: cover` cropping anywhere in the new component — every photo renders at its real aspect ratio via explicit `width`/`height` on `next/image`, never `fill`.
- `quality={90}` on every `next/image` usage in this plan — matches this project's existing convention and is already an allowed value in `next.config.ts`'s `qualities` list (adding a new, undeclared quality value silently falls back to 75 instead of erroring, so don't introduce one).
- `git checkout -- AGENTS.md` after any `npm run dev`/`npm run build` if it gets regenerated — discard before staging/committing.
- Requires a real `ANTHROPIC_API_KEY` in `.env.local` before Task 2's live verification can run. If it's not present when Task 2 needs it, stop and report NEEDS_CONTEXT rather than fabricating a value or skipping verification.

---

## Task 1: Upload script — real dimensions via `sharp`

**Files:**
- Modify: `scripts/uploadImage.mjs`
- Modify: `package.json` (new explicit dependency)

**Interfaces:**
- Produces: the script's final stdout output now includes a ready-to-paste snippet with real `width`/`height`, consumed visually by whoever runs the script (no code consumes this programmatically) and, once Task 2 extends the same output, by Task 5's placeholder-photo curation.

- [ ] **Step 1: Declare `sharp` as an explicit dependency**

`sharp` (version `0.35.3`) is already present in `node_modules` as an undeclared transitive dependency of Next.js's own image optimization. Relying on it without declaring it is fragile — if Next.js ever drops or changes its use of `sharp`, this script would silently break. Add it to `package.json`'s `"dependencies"` block, alongside the existing entries (alphabetical, matches the existing ordering):

```json
    "resend": "^6.18.1",
    "sharp": "^0.35.3",
    "stripe": "^22.4.0"
```

Then run:

```bash
npm install
```

Expected: no version change for `sharp` itself (it's already installed at this version), just a new line in `package.json` and `package-lock.json` recording it as a direct dependency.

- [ ] **Step 2: Modify `scripts/uploadImage.mjs`**

Read the current file first — it reads a local file into `body`, uploads it via `S3Client`, then prints the uploaded URL. Replace the entire file with this content:

```js
// Upload a local image file to the public R2 bucket used for site
// marketing/portfolio photos (see lib/media.ts) and print its public URL
// plus a ready-to-paste MasonryPhoto snippet (real dimensions via sharp).
//
// Usage (via the npm script — loads .env.local automatically):
//   npm run image:upload -- ./path/to/photo.jpg [destination-key]
//
// destination-key defaults to the file's own name (e.g. hero.jpg). Pass one
// to nest it under a prefix, e.g. `npm run image:upload -- ./photo.jpg
// portraits/river-session-01.jpg`. Uploading to a key that already exists
// overwrites it.
//
// This bucket ("zkjfilms-public") is separate from the private client-
// gallery bucket (lib/r2.ts, "zk-client-galleries") and has R2's Public
// Development URL enabled, so anything uploaded here is immediately and
// permanently public — never point this script at client photos.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

// Keep in sync with lib/media.ts — see that file's comment for why this
// can't just be imported (this script runs as plain Node, not through
// Next/TypeScript).
const PUBLIC_IMAGES_BASE_URL = "https://pub-a78d2319f08941ff9a3249390ab8f644.r2.dev";

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via \`npm run image:upload\`, which loads .env.local automatically.`,
    );
    process.exit(1);
  }
  return value;
}

const [, , filePath, destinationKeyArg] = process.argv;
if (!filePath) {
  console.error("Usage: npm run image:upload -- <local-file-path> [destination-key]");
  process.exit(1);
}

const ext = extname(filePath).toLowerCase();
const contentType = CONTENT_TYPES[ext];
if (!contentType) {
  console.error(`Unrecognized image extension "${ext}". Supported: ${Object.keys(CONTENT_TYPES).join(", ")}`);
  process.exit(1);
}

const key = destinationKeyArg || basename(filePath);
const body = readFileSync(filePath);

const { width, height } = await sharp(body).metadata();
if (!width || !height) {
  console.error("Could not read image dimensions — the file may be corrupt or an unsupported format for sharp.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: requireEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: requireEnv("R2_PUBLIC_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_PUBLIC_SECRET_ACCESS_KEY"),
  },
});

await client.send(
  new PutObjectCommand({
    Bucket: requireEnv("R2_PUBLIC_BUCKET_NAME"),
    Key: key,
    Body: body,
    ContentType: contentType,
  }),
);

console.log(`Uploaded ${filePath} -> ${key}`);
console.log(`${PUBLIC_IMAGES_BASE_URL}/${key}`);
console.log("");
console.log("Paste into a MasonryPhoto list (lib/masonryPhotos.ts):");
console.log(
  `{ key: "${key}", width: ${width}, height: ${height}, alt: "", src: publicImageUrl("${key}") },`,
);
```

(This is a full-file replacement — Task 2 will modify only the alt-text portion of the final output block, not restructure anything else.)

- [ ] **Step 3: Type-check and test with a real local image**

```bash
npx tsc --noEmit
```

Expected: no errors (this is a `.mjs` script, not type-checked directly, but this confirms nothing else in the repo broke).

Find or create a small test image locally (any `.jpg`/`.png` on the machine works — e.g. a screenshot), then run:

```bash
npm run image:upload -- /path/to/some/test-image.jpg test-masonry-dimensions.jpg
```

Expected output ends with a `Paste into a MasonryPhoto list` line showing the real width/height of the test image you used (cross-check against the file's actual dimensions via `sqlite3`-style tools or just Preview/any image viewer's info panel) and an empty `alt: ""`.

Clean up the test upload — there's no delete script for this public bucket in this repo; note in your report that `test-masonry-dimensions.jpg` was left in the `zkjfilms-public` R2 bucket (harmless — it's a generic public asset bucket with no listing/discovery page, and re-uploading to the same key later overwrites it) rather than attempting to delete it via an ad-hoc script.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/uploadImage.mjs
git commit -m "Print real image dimensions from upload script via sharp"
```

---

## Task 2: Upload script — AI-suggested alt text via Anthropic

**Files:**
- Modify: `scripts/uploadImage.mjs`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: Task 1's modified `scripts/uploadImage.mjs` (this task extends its final output block).
- Produces: the script's printed snippet now includes a real suggested `alt` string instead of an empty one.

- [ ] **Step 1: Install `@anthropic-ai/sdk`**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Add alt-text generation to `scripts/uploadImage.mjs`**

Add the import alongside the existing ones:

```js
import Anthropic from "@anthropic-ai/sdk";
```

Add this function after `requireEnv`:

```js
async function generateAltText(imageBuffer, mediaType) {
  const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBuffer.toString("base64") },
          },
          {
            type: "text",
            text: "Write concise, specific SEO alt text for this photo from a Columbia, Missouri portrait/headshot photography portfolio. One sentence, no marketing fluff, describe what's actually visible — pose, setting, mood. Do not include phrases like \"image of\" or \"photo of\".",
          },
        ],
      },
    ],
  });
  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected response content type from Anthropic API.");
  }
  return block.text.trim();
}
```

Replace the `console.log` block at the end of the file — currently ending with the empty `alt: ""` — with a version that calls this function first and inserts the result, escaping any double quotes it might contain:

```js
const altText = await generateAltText(body, contentType);
const escapedAlt = altText.replace(/"/g, '\\"');

console.log(`Uploaded ${filePath} -> ${key}`);
console.log(`${PUBLIC_IMAGES_BASE_URL}/${key}`);
console.log(`Suggested alt text: ${altText}`);
console.log("");
console.log("Paste into a MasonryPhoto list (lib/masonryPhotos.ts):");
console.log(
  `{ key: "${key}", width: ${width}, height: ${height}, alt: "${escapedAlt}", src: publicImageUrl("${key}") },`,
);
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Live test against the real Anthropic API**

Confirm `ANTHROPIC_API_KEY` is present in `.env.local` before running this — if it isn't, stop and report NEEDS_CONTEXT rather than guessing at a value or skipping this step.

```bash
npm run image:upload -- /path/to/some/test-image.jpg test-masonry-alt-text.jpg
```

Expected: the script prints `Suggested alt text: <something plausible describing the actual test image>`, followed by the full paste-ready snippet with that same text (properly escaped) in the `alt` field. Confirm the description is genuinely about the test image's actual visible content (not a generic placeholder or an error message) — if you used a photo of a person, the text should say something about a person; if it's an arbitrary test image (e.g. a screenshot), the description should still plausibly describe what's in it, even though the prompt is tuned for portrait photography.

As in Task 1, leave the test upload in the R2 bucket rather than attempting to delete it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/uploadImage.mjs
git commit -m "Add AI-suggested alt text to upload script via Anthropic API"
```

---

## Task 3: `lib/masonryPhotos.ts` — type and placeholder data

**Files:**
- Create: `lib/masonryPhotos.ts`

**Interfaces:**
- Produces: `MasonryPhoto` type (`{ key: string; width: number; height: number; alt: string; src: string }`), `HEADSHOTS_MASONRY_PHOTOS: MasonryPhoto[]`, `CREATIVE_PORTRAITS_MASONRY_PHOTOS: MasonryPhoto[]` — consumed by Task 4's `MasonryGallery` (the type) and Task 5's `lib/services.ts` (the type and both constants).

- [ ] **Step 1: Create the file**

```ts
// Flat photo lists for the masonry-style /headshots and /creative-portraits
// pages — deliberately separate from components/Gallery.tsx's GalleryGroup/
// GalleryBlock shape (single/pair blocks), which /portraits still uses
// directly via HEADSHOTS_GALLERY/CREATIVE_PORTRAITS_GALLERY in
// lib/services.ts. A masonry tile's shape comes entirely from the photo's
// own width/height — no block/crop concept needed.
export type MasonryPhoto = {
  key: string;
  width: number;
  height: number;
  alt: string;
  src: string;
};

// Placeholder photos with deliberately varied real dimensions (landscape,
// portrait, and near-square) so the masonry grid shows a genuine mixed
// layout before any real photos are uploaded. Replace with real entries —
// each one printed ready-to-paste by `npm run image:upload` — as photos
// come in.
export const HEADSHOTS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "headshots-placeholder-01",
    width: 1600,
    height: 1067,
    alt: "Professional headshot photography session in Columbia, Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-01/1600/1067",
  },
  {
    key: "headshots-placeholder-02",
    width: 1067,
    height: 1600,
    alt: "Business branding portrait photographed in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-02/1067/1600",
  },
  {
    key: "headshots-placeholder-03",
    width: 1400,
    height: 1400,
    alt: "Corporate headshot session, Columbia MO photography studio",
    src: "https://picsum.photos/seed/headshots-placeholder-03/1400/1400",
  },
  {
    key: "headshots-placeholder-04",
    width: 1200,
    height: 1800,
    alt: "LinkedIn profile headshot photographed in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-04/1200/1800",
  },
  {
    key: "headshots-placeholder-05",
    width: 1800,
    height: 1200,
    alt: "Professional branding portrait, Columbia Missouri photographer",
    src: "https://picsum.photos/seed/headshots-placeholder-05/1800/1200",
  },
  {
    key: "headshots-placeholder-06",
    width: 1000,
    height: 1500,
    alt: "Personal website headshot session in Mid-Missouri",
    src: "https://picsum.photos/seed/headshots-placeholder-06/1000/1500",
  },
];

export const CREATIVE_PORTRAITS_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "creative-portraits-placeholder-01",
    width: 1067,
    height: 1600,
    alt: "Art-directed creative portrait session in Columbia, MO",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-01/1067/1600",
  },
  {
    key: "creative-portraits-placeholder-02",
    width: 1600,
    height: 1067,
    alt: "Styled creative portrait photography in Mid-Missouri",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-02/1600/1067",
  },
  {
    key: "creative-portraits-placeholder-03",
    width: 1200,
    height: 1800,
    alt: "Concept-driven portrait session, Columbia Missouri photographer",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-03/1200/1800",
  },
  {
    key: "creative-portraits-placeholder-04",
    width: 1500,
    height: 1000,
    alt: "Art-directed lighting and styling, Mid-Missouri portrait session",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-04/1500/1000",
  },
  {
    key: "creative-portraits-placeholder-05",
    width: 1400,
    height: 1400,
    alt: "Creative portrait photography session in Columbia, MO",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-05/1400/1400",
  },
  {
    key: "creative-portraits-placeholder-06",
    width: 1800,
    height: 1200,
    alt: "Narrative-driven portrait session, Mid-Missouri photographer",
    src: "https://picsum.photos/seed/creative-portraits-placeholder-06/1800/1200",
  },
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/masonryPhotos.ts
git commit -m "Add MasonryPhoto type and placeholder photo lists"
```

---

## Task 4: `MasonryGallery` component with lightbox

**Files:**
- Create: `components/MasonryGallery.tsx`

**Interfaces:**
- Consumes: `MasonryPhoto` from `lib/masonryPhotos.ts` (Task 3).
- Produces: `MasonryGallery({ photos: MasonryPhoto[] })` React component, consumed by Task 5's `ServiceLandingPage.tsx`.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { MasonryPhoto } from "@/lib/masonryPhotos";

export default function MasonryGallery({ photos }: { photos: MasonryPhoto[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedIndex(null);
      } else if (e.key === "ArrowRight") {
        setSelectedIndex((i) => (i === null ? null : (i + 1) % photos.length));
      } else if (e.key === "ArrowLeft") {
        setSelectedIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, photos.length]);

  if (photos.length === 0) return null;

  const selected = selectedIndex === null ? null : photos[selectedIndex];

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-10 sm:px-6">
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
        {photos.map((photo, index) => (
          <button
            key={photo.key}
            type="button"
            onClick={() => setSelectedIndex(index)}
            className="mb-3 block w-full break-inside-avoid overflow-hidden bg-surface"
          >
            <Image
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              quality={90}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full transition-transform duration-500 ease-out hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-10"
          onClick={() => setSelectedIndex(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedIndex(null)}
            aria-label="Close"
            className="absolute right-4 top-4 text-3xl text-white/80 transition-colors hover:text-white sm:right-8 sm:top-8"
          >
            &times;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
            }}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 transition-colors hover:text-white sm:left-6"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((i) => (i === null ? null : (i + 1) % photos.length));
            }}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 transition-colors hover:text-white sm:right-6"
          >
            &rsaquo;
          </button>
          <div
            className="relative max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={selected.src}
              alt={selected.alt}
              width={selected.width}
              height={selected.height}
              quality={90}
              sizes="100vw"
              className="max-h-[90vh] w-auto max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual visual verification with placeholder data**

Since `ServiceLandingPage.tsx` isn't wired up to this component yet (that's Task 5), verify this component directly by temporarily rendering it somewhere reachable — the simplest option is to temporarily add it to the bottom of `app/page.tsx` (the homepage) or create a scratch route, render it with `HEADSHOTS_MASONRY_PHOTOS` from Task 3, view it in the browser, then **revert that temporary change completely** before committing — this task's Files list is only `components/MasonryGallery.tsx`, nothing else should be in your diff.

Start the dev server. Using a browser (load `claude-in-chrome` tools via `ToolSearch` with query `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp"` if available), confirm:

- The grid shows a genuine mixed masonry layout — landscape and portrait tiles interleaved, no fixed uniform tile shape, no visible cropping (compare a tile's proportions against its known width/height from the placeholder data).
- Resize the viewport (or check at a few widths) and confirm the column count changes: 1 column below `sm` (640px), 2 columns between `sm` and `lg` (1024px), 3 columns at `lg` and above.
- Click a tile — confirm the lightbox opens showing that same photo enlarged.
- Confirm the lightbox's next/prev buttons cycle through photos (including wrapping from the last photo back to the first, and from the first back to the last).
- Confirm `Escape`, the close button, and clicking the dark overlay background (but NOT clicking the enlarged image itself) all close the lightbox.
- Confirm `ArrowLeft`/`ArrowRight` keys also navigate while the lightbox is open.

Revert the temporary scratch-rendering change, then stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add components/MasonryGallery.tsx
git commit -m "Add MasonryGallery component with lightbox"
```

---

## Task 5: Wire up `/headshots` and `/creative-portraits`

**Files:**
- Modify: `lib/services.ts`
- Modify: `components/ServiceLandingPage.tsx`

**Interfaces:**
- Consumes: `MasonryPhoto`, `HEADSHOTS_MASONRY_PHOTOS`, `CREATIVE_PORTRAITS_MASONRY_PHOTOS` from `lib/masonryPhotos.ts` (Task 3); `MasonryGallery` from `components/MasonryGallery.tsx` (Task 4).
- No new interfaces produced — this is the plan's final consumer, making `/headshots` and `/creative-portraits` actually render the new grid.

- [ ] **Step 1: Add `masonryPhotos` to the `Service` type and populate it**

Read `lib/services.ts` first. Add the import at the top:

```ts
import type { MasonryPhoto } from "@/lib/masonryPhotos";
import { HEADSHOTS_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS } from "@/lib/masonryPhotos";
```

Update the `Service` type to add one new optional field, keeping every existing field exactly as-is:

```ts
export type Service = {
  slug: string;
  name: string;
  appointmentTypeName: string;
  tagline: string;
  description: string;
  heroImageSeed: string;
  heroImageAlt: string;
  gallery: GalleryGroup | null;
  masonryPhotos?: MasonryPhoto[];
  faqIds: string[];
};
```

In `HEADSHOTS_SERVICE`, change `gallery: HEADSHOTS_GALLERY,` to `gallery: null,` and add `masonryPhotos: HEADSHOTS_MASONRY_PHOTOS,` on the line after it. Do the same for `CREATIVE_PORTRAITS_SERVICE`: change `gallery: CREATIVE_PORTRAITS_GALLERY,` to `gallery: null,` and add `masonryPhotos: CREATIVE_PORTRAITS_MASONRY_PHOTOS,`.

**Do not remove or modify the `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` constants themselves** — `/portraits` (`app/portraits/page.tsx`) imports and renders them directly, independent of `Service`. They simply stop being referenced by `HEADSHOTS_SERVICE`/`CREATIVE_PORTRAITS_SERVICE`'s `gallery` field; the constants stay exported and unchanged for `/portraits`'s continued use.

- [ ] **Step 2: Branch in `ServiceLandingPage.tsx`**

Read `components/ServiceLandingPage.tsx` first. It currently has:

```tsx
      {service.gallery && (
        <Gallery groups={[{ ...service.gallery, description: "" }]} />
      )}
```

Add the import:

```ts
import MasonryGallery from "@/components/MasonryGallery";
```

Replace that block with a branch — masonry takes precedence when present, falling back to the existing `Gallery` otherwise, so Boudoir (`gallery: null`, no `masonryPhotos`) renders neither and every other page keeps working exactly as before:

```tsx
      {service.masonryPhotos ? (
        <MasonryGallery photos={service.masonryPhotos} />
      ) : (
        service.gallery && (
          <Gallery groups={[{ ...service.gallery, description: "" }]} />
        )
      )}
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Manual browser verification**

Start the dev server. Using browser tools if available (same `ToolSearch` query as Task 4):

1. Visit `/headshots` — confirm it now renders the masonry grid (mixed landscape/portrait placeholder tiles), not the old full-splash single/pair layout. Confirm the hero section, description, FAQ section, and "Book This Session"/"Other Sessions" footer links are all still present and unchanged (only the gallery section itself should differ from before).
2. Visit `/creative-portraits` — same checks.
3. Click a tile on each page, confirm the lightbox opens and closes correctly (same checks as Task 4's Step 3, now through the real page rather than a scratch route).
4. Visit `/portraits` — confirm it renders exactly as it did before this plan: the same full-splash single/pair blocks, same photos, same "Editorial & Fine Art" / renumbered headshots+creative-portraits sections, no masonry anywhere on this page.
5. Visit `/boudoir` — confirm it still renders with no gallery section (unchanged — `gallery: null` and no `masonryPhotos`).

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add lib/services.ts components/ServiceLandingPage.tsx
git commit -m "Wire MasonryGallery into /headshots and /creative-portraits"
```
