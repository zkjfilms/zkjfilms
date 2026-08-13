# Public Showcase Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the site owner upload self-hosted showcase videos via a CLI (mirroring `scripts/gallery.mjs`) and display them on a new `/films` page, using the existing public R2 bucket and Supabase project.

**Architecture:** A new `videos` table (Supabase) holds ordered video metadata; a new `scripts/video.mjs` CLI creates rows and uploads video/poster files to the existing public R2 bucket (`zkjfilms-public`, same credentials as `scripts/uploadImage.mjs`); a new Server Component page (`app/films/page.tsx`) fetches and renders them via plain HTML5 `<video>` elements; the site nav gets a new top-level `/films` link.

**Tech Stack:** Node.js (CLI script, `--env-file=.env.local`), `@supabase/supabase-js`, `@aws-sdk/client-s3`, Next.js Server Components, Tailwind CSS.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-showcase-videos-design.md`.
- MP4 only for v1 — `video:upload` rejects any non-`.mp4` video file with a clear error.
- No poster auto-generation — `video:upload` requires an explicit poster image path; no ffmpeg or video-processing dependency is introduced anywhere in this plan.
- The public R2 bucket and its `R2_PUBLIC_*` credentials are reused as-is (same ones `scripts/uploadImage.mjs` already uses) — no new bucket, no new environment variables.
- Poster images render via the native HTML5 `<video poster="...">` attribute, a plain URL string — **not** through `next/image` (a clarification of the design spec's wording: `<video>`'s `poster` attribute is never processed by Next's image pipeline, unlike the `<Image>` component used elsewhere on the site for actual `<img>` content). This doesn't change the spec's intent (self-hosted, R2-served posters) — this is a small implementation-level clarification, not a design contradiction.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, and manual CLI/R2/Supabase/browser checks, following the same pattern as every prior plan in this repo (see `docs/superpowers/plans/2026-08-12-gallery-create-upload.md`).
- `videos` gets RLS enabled with zero policies, matching every other admin-managed table in `supabase/schema.sql` — all reads happen server-side via the service-role client (`getSupabaseClient()`), never client-side via the anon key.

---

## Task 1: Schema + CLI (`scripts/video.mjs`)

**Files:**
- Modify: `supabase/schema.sql` (append `videos` table)
- Create: `scripts/video.mjs`
- Modify: `package.json` (add `video:*` scripts)

**Interfaces:**
- Produces: CLI commands `npm run video:list`, `npm run video:create -- <slug> "<title>" ["<description>"]`, `npm run video:upload -- <slug> <video-file-path> <poster-image-path>`, `npm run video:set-order -- <slug> <number>`, `npm run video:delete -- <slug> [--yes]`.
- Produces: the `videos` table (`slug`, `title`, `description`, `video_key`, `poster_key`, `sort_order`, `created_at`), which Task 2 selects from directly (`select("slug, title, description, video_key, poster_key")`, ordered by `sort_order`).
- Produces: R2 object keys of the shape `videos/<slug>/video.mp4` and `videos/<slug>/poster.jpg` in the public bucket, fetchable via `publicImageUrl(key)` from `lib/media.ts` (existing, unchanged) — Task 2 uses this directly.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor against the live database:

```sql
create table videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  video_key text not null,
  poster_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index videos_sort_order_idx on videos (sort_order);

alter table videos enable row level security;
```

Then append the exact same statements to the end of `supabase/schema.sql`, after the file's existing final comment block, with this explanatory comment above them:

```sql

-- Public showcase videos for /films — self-hosted via the same public R2
-- bucket used for marketing photos (zkjfilms-public), not the private
-- client-gallery bucket. RLS enabled with no policies, matching every
-- other admin-managed table in this schema — all access goes through the
-- service-role client server-side.
create table videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  video_key text not null,
  poster_key text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index videos_sort_order_idx on videos (sort_order);

alter table videos enable row level security;
```

Do not attempt to run this migration yourself via any CLI or script — there is no direct Postgres connection available in this repo's `.env.local`. If a later verification step in this task fails because the table doesn't exist yet, stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Create `scripts/video.mjs`**

```js
// Manage showcase videos — create, upload, list, reorder, delete —
// without touching SQL. Mirrors scripts/gallery.mjs's conventions but for
// the `videos` table and the public R2 bucket ("zkjfilms-public", the
// same one scripts/uploadImage.mjs uses) rather than the private
// client-gallery bucket.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run video:list
//   npm run video:create -- <slug> "<title>" ["<description>"]
//   npm run video:upload -- <slug> <video-file-path> <poster-image-path>
//   npm run video:set-order -- <slug> <number>
//   npm run video:delete -- <slug> [--yes]

import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PutObjectCommand, DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm scripts (video:*), which load .env.local automatically.`,
    );
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv("SUPABASE_URL").replace(/\/rest\/v1\/?$/, ""),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

function getPublicR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_PUBLIC_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_PUBLIC_SECRET_ACCESS_KEY"),
    },
  });
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

// Kept in sync with CONTENT_TYPES/UPLOAD_CONTENT_TYPES in
// uploadImage.mjs/gallery.mjs by hand — same reasoning as those files'
// own comments (this script isn't compiled, so it can't import a shared
// TS constant).
const POSTER_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

function videoKey(slug) {
  return `videos/${slug}/video.mp4`;
}

function posterKey(slug) {
  return `videos/${slug}/poster.jpg`;
}

async function create(slug, title, description) {
  if (!slug || !title) {
    console.error(
      'Usage: npm run video:create -- <slug> "<title>" ["<description>"]',
    );
    process.exit(1);
  }

  if (!SLUG_PATTERN.test(slug)) {
    console.error(
      `"${slug}" isn't a valid slug — use only lowercase letters, numbers, and hyphens.`,
    );
    process.exit(1);
  }

  const { data: existing, error: lookupError } = await supabase
    .from("videos")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to check for existing video:", lookupError.message);
    process.exit(1);
  }

  if (existing) {
    console.error(`A video with slug "${slug}" already exists.`);
    process.exit(1);
  }

  const { data: maxRow, error: maxError } = await supabase
    .from("videos")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    console.error("Failed to determine sort order:", maxError.message);
    process.exit(1);
  }

  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("videos")
    .insert({
      slug,
      title,
      description: description || null,
      video_key: videoKey(slug),
      poster_key: posterKey(slug),
      sort_order: sortOrder,
    })
    .select("slug")
    .single();

  if (error) {
    console.error("Failed to create video:", error.message);
    process.exit(1);
  }

  console.log(`Created video "${data.slug}" (sort_order ${sortOrder}).`);
  console.log(`Next: npm run video:upload -- ${data.slug} <video-file> <poster-image>`);
}

async function upload(slug, videoPath, posterPath) {
  if (!slug || !videoPath || !posterPath) {
    console.error(
      "Usage: npm run video:upload -- <slug> <video-file-path> <poster-image-path>",
    );
    process.exit(1);
  }

  const { data: video, error } = await supabase
    .from("videos")
    .select("video_key, poster_key")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Failed to look up video:", error.message);
    process.exit(1);
  }

  if (!video) {
    console.error(
      `No video found with slug "${slug}". Create it first with video:create.`,
    );
    process.exit(1);
  }

  const videoExt = extname(videoPath).toLowerCase();
  if (videoExt !== ".mp4") {
    console.error(
      `"${videoPath}" isn't an .mp4 file — only MP4 (H.264) is supported.`,
    );
    process.exit(1);
  }

  const posterExt = extname(posterPath).toLowerCase();
  const posterContentType = POSTER_CONTENT_TYPES[posterExt];
  if (!posterContentType) {
    console.error(
      `Unrecognized poster image extension "${posterExt}". Supported: ${Object.keys(POSTER_CONTENT_TYPES).join(", ")}`,
    );
    process.exit(1);
  }

  let videoBody;
  try {
    videoBody = readFileSync(videoPath);
  } catch (err) {
    console.error(`Failed to read video file "${videoPath}":`, err.message);
    process.exit(1);
  }

  let posterBody;
  try {
    posterBody = readFileSync(posterPath);
  } catch (err) {
    console.error(`Failed to read poster file "${posterPath}":`, err.message);
    process.exit(1);
  }

  const client = getPublicR2Client();
  const bucket = requireEnv("R2_PUBLIC_BUCKET_NAME");

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: video.video_key,
      Body: videoBody,
      ContentType: "video/mp4",
    }),
  );
  console.log(`Uploaded ${videoPath} -> ${video.video_key}`);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: video.poster_key,
      Body: posterBody,
      ContentType: posterContentType,
    }),
  );
  console.log(`Uploaded ${posterPath} -> ${video.poster_key}`);
}

async function list() {
  const { data, error } = await supabase
    .from("videos")
    .select("slug, title, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to list videos:", error.message);
    process.exit(1);
  }

  if (!data.length) {
    console.log("No videos found.");
    return;
  }

  for (const video of data) {
    console.log(
      `${video.slug.padEnd(24)} ${video.title.padEnd(32)} order ${video.sort_order}`,
    );
  }
}

async function setOrder(slug, orderArg) {
  if (!slug || orderArg === undefined) {
    console.error("Usage: npm run video:set-order -- <slug> <number>");
    process.exit(1);
  }

  const sortOrder = Number(orderArg);
  if (!Number.isInteger(sortOrder)) {
    console.error(`"${orderArg}" isn't a valid integer.`);
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("videos")
    .update({ sort_order: sortOrder })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to update sort order:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No video found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`${data.slug} now has sort_order ${sortOrder}.`);
}

async function del(slug, opts) {
  if (!slug) {
    console.error("Usage: npm run video:delete -- <slug> [--yes]");
    process.exit(1);
  }

  const autoConfirm = opts.includes("--yes") || opts.includes("-y");

  if (!autoConfirm) {
    if (!process.stdin.isTTY) {
      console.error(
        "Refusing to delete without confirmation in a non-interactive shell. Pass --yes to skip the prompt.",
      );
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `This permanently deletes video "${slug}" and its R2 files. Type the slug to confirm: `,
    );
    rl.close();
    if (answer.trim() !== slug) {
      console.error("Confirmation didn't match. Aborted.");
      process.exit(1);
    }
  }

  const { data, error } = await supabase
    .from("videos")
    .delete()
    .eq("slug", slug)
    .select("video_key, poster_key")
    .maybeSingle();

  if (error) {
    console.error("Failed to delete video:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No video found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Deleted video "${slug}" from the database.`);

  const client = getPublicR2Client();
  const bucket = requireEnv("R2_PUBLIC_BUCKET_NAME");

  try {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: [{ Key: data.video_key }, { Key: data.poster_key }],
        },
      }),
    );
    console.log("Deleted video and poster files from R2.");
  } catch (err) {
    console.error("Warning: failed to delete R2 files:", err.message);
    console.error(`You may need to manually clean up ${data.video_key} and ${data.poster_key} in R2.`);
  }
}

const [, , command, ...args] = process.argv;

if (command === "list") {
  await list();
} else if (command === "create") {
  await create(args[0], args[1], args[2]);
} else if (command === "upload") {
  await upload(args[0], args[1], args[2]);
} else if (command === "set-order") {
  await setOrder(args[0], args[1]);
} else if (command === "delete") {
  await del(args[0], args.slice(1));
} else {
  console.error(
    [
      "Usage:",
      "  npm run video:list",
      '  npm run video:create -- <slug> "<title>" ["<description>"]',
      "  npm run video:upload -- <slug> <video-file-path> <poster-image-path>",
      "  npm run video:set-order -- <slug> <number>",
      "  npm run video:delete -- <slug> [--yes]",
    ].join("\n"),
  );
  process.exit(1);
}
```

- [ ] **Step 3: Add npm scripts**

In `package.json`, add these lines inside `"scripts"`, immediately after `"image:upload"`:

```json
    "video:list": "node --env-file=.env.local scripts/video.mjs list",
    "video:create": "node --env-file=.env.local scripts/video.mjs create",
    "video:upload": "node --env-file=.env.local scripts/video.mjs upload",
    "video:set-order": "node --env-file=.env.local scripts/video.mjs set-order",
    "video:delete": "node --env-file=.env.local scripts/video.mjs delete",
```

- [ ] **Step 4: Manually verify against the real Supabase project and R2 bucket**

If the migration from Step 1 hasn't been confirmed applied yet, confirm with the project owner before proceeding — the commands below will fail with a Postgres error mentioning `relation "videos" does not exist` otherwise, in which case stop and report NEEDS_CONTEXT.

```bash
npm run video:list
```

Expected: `No videos found.` (or existing rows, if any already exist).

```bash
npm run video:create -- test-video-plan "Test Video"
```

Expected: prints `Created video "test-video-plan" (sort_order 0).` (or whatever the next available order is) and a `Next:` hint line.

```bash
npm run video:create -- test-video-plan "Duplicate"
```

Expected: fails cleanly with `A video with slug "test-video-plan" already exists.`

```bash
npm run video:create -- "Not A Slug" "Test"
```

Expected: fails cleanly with the invalid-slug message, no row inserted.

For the upload test, you'll need a small `.mp4` file and a small image file locally — any short test clip works (even a few seconds), and any of the site's existing marketing images can serve as a placeholder poster for this test. Then:

```bash
npm run video:upload -- test-video-plan /path/to/test.mp4 /path/to/test-poster.jpg
```

Expected: two `Uploaded ... -> videos/test-video-plan/...` lines. Verify both are publicly fetchable: `curl -I https://pub-a78d2319f08941ff9a3249390ab8f644.r2.dev/videos/test-video-plan/video.mp4` and the poster equivalent should both return `200`.

```bash
npm run video:upload -- test-video-plan /path/to/test.mp4 /path/to/wrong-extension.txt
```

Expected: fails cleanly with the unrecognized-poster-extension message, before any upload happens.

```bash
npm run video:upload -- nonexistent-slug-plan /path/to/test.mp4 /path/to/test-poster.jpg
```

Expected: fails cleanly with `No video found with slug "nonexistent-slug-plan". Create it first with video:create.`

```bash
npm run video:set-order -- test-video-plan 5
npm run video:list
```

Expected: the list shows `test-video-plan` with `order 5`.

Leave `test-video-plan` in place — Task 2 reuses it to verify the public page. Do not delete it yet.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql scripts/video.mjs package.json
git commit -m "Add videos table and video:* CLI for showcase video management"
```

---

## Task 2: Public page (`/films`) + nav link

**Files:**
- Create: `app/films/page.tsx`
- Modify: `components/Navbar.tsx:7-13` (add `/films` to the `links` array)

**Interfaces:**
- Consumes: the `videos` table from Task 1 (`slug, title, description, video_key, poster_key`, ordered by `sort_order`), `getSupabaseClient()` from `@/lib/supabase` (existing, unchanged), `publicImageUrl(key)` from `@/lib/media` (existing, unchanged), `buildPageMetadata()` from `@/lib/seo` (existing, unchanged).

- [ ] **Step 1: Create `app/films/page.tsx`**

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { getSupabaseClient } from "@/lib/supabase";

const TITLE = "Films";
const DESCRIPTION =
  "Cinematic video work from Zach K. Johnson — highlight reels and film pieces from Columbia, Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/films" });
}

type VideoRow = {
  slug: string;
  title: string;
  description: string | null;
  video_key: string;
  poster_key: string;
};

export default async function FilmsPage() {
  const supabase = getSupabaseClient();
  const { data: videos, error } = await supabase
    .from("videos")
    .select("slug, title, description, video_key, poster_key")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Supabase videos fetch failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-10">
      <header className="mb-16 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Motion
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Films
        </h1>
      </header>

      {!videos || videos.length === 0 ? (
        <p className="text-center text-muted">
          {error
            ? "Couldn't load videos right now."
            : "New film work is on the way — check back soon."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
          {(videos as VideoRow[]).map((video) => (
            <div key={video.slug}>
              <div className="relative aspect-video w-full overflow-hidden bg-surface">
                <video
                  controls
                  preload="none"
                  poster={publicImageUrl(video.poster_key)}
                  className="h-full w-full object-cover"
                >
                  <source src={publicImageUrl(video.video_key)} type="video/mp4" />
                </video>
              </div>
              <h2 className="mt-4 font-serif text-xl italic text-foreground">
                {video.title}
              </h2>
              {video.description && (
                <p className="mt-1 text-sm text-muted">{video.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `/films` to the nav**

In `components/Navbar.tsx`, replace:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];
```

with:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/films", label: "Films" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];
```

No other change is needed — both the desktop (`components/Navbar.tsx:190`) and mobile nav rendering map over `links` and only special-case entries where `link.href === "/portraits"`; a plain `/films` entry automatically renders as a normal link in both, identically to `/about`/`/book`/`/contact` today. `/films` is deliberately not added to `HERO_ROUTES` (`components/Navbar.tsx:24-30`) — the films page has no full-bleed hero image, so it should get the same solid navbar as `/about`, `/book`, `/contact`, `/faq`.

- [ ] **Step 3: `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 4: Manually verify in the browser**

Start `npm run dev` (or reuse a running instance). Using `test-video-plan` from Task 1:

- Visit `/films`. Confirm the video card renders with its poster image, title, and (if provided) description.
- Confirm no video data is fetched until you press play (check the network tab — only the poster image should load on page visit, matching `preload="none"`).
- Press play and confirm the video plays back correctly with native browser controls.
- Confirm the site nav shows a "Films" link (desktop and mobile) that navigates to `/films`, and that `/films` renders with the same solid (non-transparent) navbar treatment as `/about`.
- If no other videos exist yet, temporarily create a second scratch video (`npm run video:create -- test-video-plan-2 "Second Test"`, upload the same test files) to confirm the grid lays out 2 columns correctly on desktop and 1 column on mobile, then delete it (see cleanup below).

- [ ] **Step 5: Clean up the scratch video(s) from Task 1 (and Step 4, if created)**

```bash
npm run video:delete -- test-video-plan --yes
npm run video:delete -- test-video-plan-2 --yes
```

(Second command only if you created the extra scratch video in Step 4.)

- [ ] **Step 6: Commit**

```bash
git add "app/films/page.tsx" components/Navbar.tsx
git commit -m "Add /films showcase page and nav link"
```
