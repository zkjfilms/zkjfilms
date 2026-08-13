# Public Showcase Videos

## Problem

zkjfilms.com has no video presence despite the business name and existing YouTube/Vimeo accounts (`SOCIALS.youtube`, `SOCIALS.vimeo` in `lib/seo.ts`) — those links go off-site, and nothing is embedded or hosted on the site itself. There's no way to showcase video work (highlight reels, cinematic portfolio pieces) directly on zkjfilms.com the way photo work already is via the portfolio pages and R2-backed galleries.

This is the first of two video features discussed — the second, adding video delivery to password/PIN-protected client galleries, is explicitly out of scope here and will be its own separate spec/plan later.

## Goal

Let the site owner upload video files (via CLI, matching the existing gallery/image tooling) and display them in a dedicated showcase page, self-hosted on the existing public R2 infrastructure rather than embedded from YouTube/Vimeo.

## Design

### Storage

Reuses the existing **public** R2 bucket (`zkjfilms-public`), the same one `scripts/uploadImage.mjs` already uploads marketing photos to (`R2_PUBLIC_ACCESS_KEY_ID`/`R2_PUBLIC_SECRET_ACCESS_KEY`/`R2_PUBLIC_BUCKET_NAME`, distinct from the private client-gallery bucket in `lib/r2.ts`). No new bucket, no new credentials.

Object layout mirrors the client-gallery convention (`galleries/<slug>/...`) for consistency:
- `videos/<slug>/video.mp4`
- `videos/<slug>/poster.jpg`

Both objects are permanently public via the bucket's existing "Public Development URL" feature — same trust model as every other file in this bucket (marketing photos), appropriate here since showcase videos are meant to be public by definition.

### Schema

New table, appended to `supabase/schema.sql` following its append-only convention:

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

RLS enabled with zero policies (deny-by-default), matching every other admin-managed table in this schema (`galleries`, `leads`, `contracts`, etc.) — not because this data is sensitive (it's public content), but because the established pattern in this codebase is that every read/write goes through the service-role client server-side, never the anon key client-side, and this table has no reason to be the exception.

### CLI (`scripts/video.mjs`, new file)

A new file rather than folding into `scripts/gallery.mjs` — different table, different bucket, different domain (public showcase content vs. private client delivery). Mirrors `gallery.mjs`'s established conventions (`requireEnv`, module-level Supabase client, npm-script dispatch, "no gallery/video found" error phrasing).

- `npm run video:create -- <slug> "<title>" ["<description>"]` — validates `slug` matches `^[a-z0-9-]+$` (same pattern as gallery slugs) and isn't already taken, inserts a row with `video_key`/`poster_key` derived from the slug (`videos/<slug>/video.mp4`, `videos/<slug>/poster.jpg`), and `sort_order` set to one past the current maximum (append to the end of the showcase, not requiring the caller to think about ordering at creation time).
- `npm run video:upload -- <slug> <video-file-path> <poster-image-path>` — looks up the video row first (clear error if the slug doesn't exist), uploads the video file to `video_key` (content-type `video/mp4`, rejecting non-`.mp4` extensions for v1) and the poster image to `poster_key` (reusing the same image content-type map already established in `uploadImage.mjs`/`gallery.mjs`'s `CONTENT_TYPES`/`UPLOAD_CONTENT_TYPES`).
- `npm run video:list` — prints slug/title/sort_order, same tabular style as `gallery:list`.
- `npm run video:set-order -- <slug> <number>` — updates `sort_order` directly to an explicit integer (simplest reordering primitive; the owner picks the numbers, gaps are fine, no automatic renumbering needed for a handful of videos).
- `npm run video:delete -- <slug> [--yes]` — deletes the DB row and both R2 objects (video + poster), same interactive-confirm-unless---yes pattern as `gallery:delete`.

No poster auto-generation (no ffmpeg/video-processing dependency introduced) — the owner supplies a still image directly, same effort as picking a thumbnail in any video editor.

### Public page (`app/films/page.tsx`)

Server Component, fetches `videos` ordered by `sort_order` via the service-role Supabase client (same pattern as `app/admin/galleries/page.tsx`). Renders a grid, each entry:

```tsx
<video controls poster={posterUrl} preload="none" className="...">
  <source src={videoUrl} type="video/mp4" />
</video>
```

`preload="none"` so simply visiting `/films` costs no video bandwidth — only pressing play does. Poster images render through `next/image` using the existing `publicImageUrl()` helper from `lib/media.ts` (the function name is photo-specific but the logic — base URL + key — is format-agnostic; reused as-is rather than renamed, to avoid an unrelated rename touching working code). The R2 public hostname is already allow-listed in `next.config.ts`'s `remotePatterns` for `next/image`.

Added to the site's nav/route structure the same way `/portraits`, `/headshots`, etc. already are — exact nav placement (top-level link vs. elsewhere) is a small follow-up decision at implementation time, not a design blocker.

### Out of scope

- Client video delivery through password/PIN-protected galleries — a separate, later spec.
- Individual video detail pages or deep-linkable URLs per video — v1 is one grid page.
- WebM or any format beyond MP4/H.264.
- Auto-generated poster thumbnails (no ffmpeg dependency).
- Adaptive bitrate / streaming infrastructure — plain progressive download from R2, appropriate for portfolio-reel-length content.
- A "clear"/edit-in-place command beyond `set-order` and `delete` — matches the minimal CLI surface established for galleries (`set-pin`/`set-password` are generate-only with no "clear", for comparison).

## Testing / Verification

- `tsc --noEmit` and a full production build.
- `npm run video:create -- test-video "Test Video"`: confirm the row is created with correctly derived `video_key`/`poster_key` and `sort_order` appended after any existing rows.
- `npm run video:upload -- test-video ./sample.mp4 ./sample-poster.jpg`: confirm both objects land in R2 at the expected keys and are publicly fetchable at `PUBLIC_IMAGES_BASE_URL/videos/test-video/...`.
- Browser, `/films`: confirm the video appears with its poster, `preload="none"` (check the network tab shows no video data fetched until play is pressed), and playback works.
- `npm run video:set-order -- test-video 0`: confirm it moves to the front of `/films`.
- `npm run video:delete -- test-video --yes`: confirm the row and both R2 objects are gone, and `/films` no longer shows it.
- Confirm `npm run video:upload` against a nonexistent slug fails cleanly before touching R2.
- Confirm a non-`.mp4` file passed to `video:upload` is rejected with a clear error.
