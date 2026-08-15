# Gallery Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client heart photos in their gallery (persisted server-side, replacing the current ephemeral download-selection checkboxes), give both the client and the photographer a one-click "Download favorites" action, and add a read-only admin view of any gallery reachable without the client password.

**Architecture:** A new `gallery_favorites` table (one row per hearted photo, keyed by `gallery_id` + R2 object key). `/api/gallery-access` starts issuing a short-lived HMAC token (mirroring `lib/adminAccess.ts`'s approach, expiry embedded in the token itself) alongside the signed image URLs it already returns; a new `/api/gallery-access/favorite` route verifies that token and upserts/deletes favorite rows — no bcrypt on every heart click. The client gallery's photo grid is extracted from `GalleryGate.tsx` into a new shared `GalleryPhotoGrid.tsx`, which both the client gate (interactive hearts) and a new admin page (read-only hearts) render. No payment, product ordering, or email notifications — this is delivery/visibility only.

**Tech Stack:** Next.js API routes, Supabase (schema + queries), Node's built-in `crypto` (HMAC, matching `lib/adminAccess.ts`), React (client component state), Cloudflare R2 (existing `lib/r2.ts`).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-15-gallery-favorites-design.md`.
- No payment, product catalog, print fulfillment, or email notifications — favorites are informational/delivery only (see spec's "Out of scope").
- No admin ability to add/remove favorites — the admin gallery view renders hearts read-only.
- No favoriting from inside `GalleryLightbox.tsx` — grid-only, matching the current checkbox's scope.
- The admin gallery detail page is **not** gated by `expires_at`/`archived_at` — deliberately reachable past those boundaries for the photographer's own reference. The client-facing `/gallery/[slug]` route's existing gating is unchanged.
- No rate limiting on `/api/gallery-access/favorite` — it requires a valid time-scoped token obtainable only via a successful (already rate-limited) password/PIN unlock.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, `curl` against the dev server, and manual browser checks — same pattern as every prior plan here (see `docs/superpowers/plans/2026-08-12-gallery-pin-second-factor.md`).
- Schema changes must be applied manually by the project owner via Supabase's SQL Editor (no direct Postgres connection is available in `.env.local`, only the REST-based service-role key, which can't run DDL). Do not attempt to run migrations yourself via any CLI or script. If a verification step fails because a table/column doesn't exist yet, stop and report NEEDS_CONTEXT.

---

## Task 1: Schema migration + test fixture gallery

**Files:**
- Modify: `supabase/schema.sql` (append migration)

**Interfaces:**
- Produces: `gallery_favorites` table (`id`, `gallery_id` FK → `galleries(id) on delete cascade`, `image_key`, `favorited_at`, unique on `(gallery_id, image_key)`), consumed by Tasks 3 and 4.
- Produces: a `test-gallery-favorites` gallery (created in Step 3 below) reused by Tasks 3–6's manual verification. Its password is printed once — save it somewhere you can paste from for the rest of this plan.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor (Project → SQL Editor → New query) against the live database:

```sql
create table if not exists gallery_favorites (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references galleries(id) on delete cascade,
  image_key text not null,
  favorited_at timestamptz not null default now(),
  unique (gallery_id, image_key)
);

create index if not exists gallery_favorites_gallery_id_idx
  on gallery_favorites (gallery_id);

alter table gallery_favorites enable row level security;
```

Then append the exact same statement (with the comment below) to the end of `supabase/schema.sql`, after the file's existing final `revoke execute on function increment_discount_code_redemption...` block, so the file stays the source of truth for a fresh provision:

```sql

-- Persisted per-gallery favorites (hearted photos). image_key is an R2
-- object key (see lib/r2.ts's GalleryMedia.key) — gallery photos aren't
-- rows in this database, they're listed live from R2, so a favorite is
-- just "this key was hearted in this gallery." on delete cascade means
-- gallery:delete cleans up a gallery's favorites automatically.
create table if not exists gallery_favorites (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references galleries(id) on delete cascade,
  image_key text not null,
  favorited_at timestamptz not null default now(),
  unique (gallery_id, image_key)
);

create index if not exists gallery_favorites_gallery_id_idx
  on gallery_favorites (gallery_id);

alter table gallery_favorites enable row level security;
```

Do not attempt to run this migration yourself — there is no direct Postgres connection available. If Step 2 below fails with a "relation does not exist" error, the migration hasn't been applied yet — stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Verify the table exists**

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.from('gallery_favorites').select('*').limit(1);
  console.log(JSON.stringify({ data, error }));
});
"
```

Expected: `{"data":[],"error":null}`.

- [ ] **Step 3: Create the test fixture gallery**

```bash
npm run gallery:create -- test-gallery-favorites "Favorites Test" "Test Client"
```

Expected: prints a `URL:`, `Password:`, and `Expires: never` line. **Copy the password down** — it's shown once and every later task's curl/browser verification needs it.

- [ ] **Step 4: Upload two throwaway test photos**

```bash
mkdir -p /tmp/gallery-favorites-fixtures
node -e "
const fs = require('fs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync('/tmp/gallery-favorites-fixtures/test-photo-1.png', png);
fs.writeFileSync('/tmp/gallery-favorites-fixtures/test-photo-2.png', png);
"
npm run gallery:upload -- test-gallery-favorites /tmp/gallery-favorites-fixtures
```

Expected: `Uploaded 2, skipped 0, failed 0.` (or similar — confirm 2 uploaded, 0 failed).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add gallery_favorites table"
```

---

## Task 2: Favorite token secret + `lib/galleryFavoriteToken.ts`

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (not committed — gitignored)
- Create: `lib/galleryFavoriteToken.ts`

**Interfaces:**
- Consumes: `process.env.GALLERY_FAVORITE_TOKEN_SECRET` (new env var, set in this task).
- Produces: `createFavoriteToken(slug: string, expiresAt: number): string` and `isValidFavoriteToken(slug: string, token: string): boolean`, both consumed by Task 3 (`createFavoriteToken`) and Task 4 (`isValidFavoriteToken`).

- [ ] **Step 1: Add the env var to `.env.example`**

Insert immediately after the existing `CRON_SECRET=` line (and its preceding comment block) and before the `# Cloudflare Turnstile` block:

```

# Signs the short-lived token issued by /api/gallery-access once a
# client unlocks a gallery, so /api/gallery-access/favorite can verify
# heart-toggle requests without re-checking the gallery password (which
# uses bcrypt, deliberately slow) on every click. Any random secret
# string — generate with `openssl rand -hex 32`. Distinct from
# ADMIN_PASSWORD/CRON_SECRET since it guards a different trust boundary
# (one gallery's favorites, not admin or cron access). Set the same
# value in Vercel's Production/Preview env vars before deploying.
GALLERY_FAVORITE_TOKEN_SECRET=
```

- [ ] **Step 2: Generate a real value into `.env.local`**

```bash
printf '\nGALLERY_FAVORITE_TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.local
```

- [ ] **Step 3: Create `lib/galleryFavoriteToken.ts`**

```ts
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
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (Functional verification of the token round-trip happens in Tasks 3–4 through the real API routes — there's no test runner in this repo to unit-test this file in isolation, and it's plain TypeScript that plain Node can't `import` directly.)

- [ ] **Step 5: Commit**

```bash
git add .env.example lib/galleryFavoriteToken.ts
git commit -m "Add GALLERY_FAVORITE_TOKEN_SECRET and gallery favorite token helpers"
```

---

## Task 3: `/api/gallery-access` returns a favorite token + current favorites

**Files:**
- Modify: `app/api/gallery-access/route.ts`

**Interfaces:**
- Consumes: `createFavoriteToken(slug, expiresAt)` from Task 2.
- Consumes: the `gallery_favorites` table from Task 1.
- Produces: response shape gains `favoriteToken: string` and `favoritedKeys: string[]` on every successful unlock (both the plain-success and the R2-failure `imagesError` branches). Task 5's `GalleryGate.tsx` consumes both.

- [ ] **Step 1: Import the token helper**

Replace:

```ts
import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";
import { isGalleryUnavailable } from "@/lib/gallery";
import { peekRateLimit, recordRateLimitHit, getClientIp } from "@/lib/rateLimit";
```

with:

```ts
import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";
import { isGalleryUnavailable } from "@/lib/gallery";
import { peekRateLimit, recordRateLimitHit, getClientIp } from "@/lib/rateLimit";
import { createFavoriteToken } from "@/lib/galleryFavoriteToken";
```

- [ ] **Step 2: Select the gallery's `id` too**

Replace:

```ts
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("password_hash, pin_hash, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();
```

with:

```ts
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("id, password_hash, pin_hash, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();
```

- [ ] **Step 3: Issue the favorite token and load current favorites before returning**

Replace:

```ts
  const expiresAt = Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000;

  // The password was correct — don't fail the whole unlock just because
  // R2 is unreachable. The client shows a distinct "couldn't load photos"
  // state when imagesError is set instead of an empty gallery.
  try {
    const images = await listGalleryImages(payload.slug);
    return Response.json({ ok: true, images, expiresAt });
  } catch (err) {
    console.error("Failed to list gallery images from R2:", err);
    return Response.json({ ok: true, images: [], imagesError: true, expiresAt });
  }
}
```

with:

```ts
  const expiresAt = Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000;
  const favoriteToken = createFavoriteToken(payload.slug, expiresAt);

  // A failed favorites lookup doesn't block the unlock, same tolerance
  // as the R2 failure below — it just means the gallery opens with no
  // favorites shown yet instead of a hard error.
  const { data: favoriteRows, error: favoritesError } = await supabase
    .from("gallery_favorites")
    .select("image_key")
    .eq("gallery_id", gallery.id);

  if (favoritesError) {
    console.error("Failed to load gallery favorites:", favoritesError);
  }
  const favoritedKeys = (favoriteRows ?? []).map((row) => row.image_key);

  // The password was correct — don't fail the whole unlock just because
  // R2 is unreachable. The client shows a distinct "couldn't load photos"
  // state when imagesError is set instead of an empty gallery.
  try {
    const images = await listGalleryImages(payload.slug);
    return Response.json({
      ok: true,
      images,
      expiresAt,
      favoriteToken,
      favoritedKeys,
    });
  } catch (err) {
    console.error("Failed to list gallery images from R2:", err);
    return Response.json({
      ok: true,
      images: [],
      imagesError: true,
      expiresAt,
      favoriteToken,
      favoritedKeys,
    });
  }
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manually verify against the dev server**

Start the dev server if it isn't running (`npm run dev`), then, using the password saved in Task 1 Step 3:

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","password":"<paste the password>"}' | python3 -m json.tool
```

Expected: JSON with `"ok": true`, an `images` array with 2 entries, `favoriteToken` a non-empty string of the form `<digits>.<hex>`, and `favoritedKeys: []` (nothing hearted yet).

- [ ] **Step 6: Commit**

```bash
git add app/api/gallery-access/route.ts
git commit -m "Return a favorite token and current favorites from /api/gallery-access"
```

---

## Task 4: `POST /api/gallery-access/favorite`

**Files:**
- Create: `app/api/gallery-access/favorite/route.ts`

**Interfaces:**
- Consumes: `isValidFavoriteToken(slug, token)` from Task 2.
- Consumes: `isGalleryUnavailable(gallery)` from `lib/gallery.ts` (existing).
- Consumes: the `gallery_favorites` table from Task 1, and the `favoriteToken` produced by Task 3.
- Produces: `POST { slug: string; imageKey: string; favoriteToken: string; favorited: boolean }` → `{ ok: true }` on success, consumed by Task 5's `GalleryGate.tsx`.

- [ ] **Step 1: Create the route**

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { isGalleryUnavailable } from "@/lib/gallery";
import { isValidFavoriteToken } from "@/lib/galleryFavoriteToken";

type Payload = {
  slug: string;
  imageKey: string;
  favoriteToken: string;
  favorited: boolean;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slug, imageKey, favoriteToken, favorited } = body as Record<
    string,
    unknown
  >;

  if (
    typeof slug !== "string" ||
    typeof imageKey !== "string" ||
    typeof favoriteToken !== "string" ||
    typeof favorited !== "boolean" ||
    !slug ||
    !imageKey ||
    !favoriteToken
  ) {
    return null;
  }

  return { slug, imageKey, favoriteToken, favorited };
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Cheap and stateless — checked before any database work, since an
  // invalid/expired token can't do anything here regardless of what the
  // gallery lookup below would find.
  if (!isValidFavoriteToken(payload.slug, payload.favoriteToken)) {
    return Response.json({ error: "Session expired." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.error("Failed to create Supabase client:", err);
    return Response.json(
      { error: "Gallery service is not configured yet." },
      { status: 500 },
    );
  }

  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("id, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  // Same defense-in-depth as the check in gallery-access: if a gallery
  // becomes archived or its expires_at passes mid-session, favoriting
  // stops working too, not just the initial unlock.
  if (isGalleryUnavailable(gallery)) {
    return Response.json({ error: "This gallery has expired." }, { status: 410 });
  }

  if (payload.favorited) {
    const { error: upsertError } = await supabase.from("gallery_favorites").upsert(
      { gallery_id: gallery.id, image_key: payload.imageKey },
      { onConflict: "gallery_id,image_key", ignoreDuplicates: true },
    );
    if (upsertError) {
      console.error("Failed to save favorite:", upsertError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  } else {
    const { error: deleteError } = await supabase
      .from("gallery_favorites")
      .delete()
      .eq("gallery_id", gallery.id)
      .eq("image_key", payload.imageKey);
    if (deleteError) {
      console.error("Failed to remove favorite:", deleteError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manually verify against the dev server**

First, get a fresh token and one of the two uploaded image keys (using the same password from Task 1):

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","password":"<paste the password>"}' > /tmp/gallery-favorites-fixtures/unlock.json
python3 -c "
import json
data = json.load(open('/tmp/gallery-favorites-fixtures/unlock.json'))
print('TOKEN=' + data['favoriteToken'])
print('KEY=' + data['images'][0]['key'])
"
```

Copy the printed `TOKEN=` and `KEY=` values for the next commands.

Favorite it:

```bash
curl -s -X POST http://localhost:3000/api/gallery-access/favorite \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","imageKey":"<paste KEY>","favoriteToken":"<paste TOKEN>","favorited":true}'
```

Expected: `{"ok":true}`.

Confirm it persisted by unlocking again:

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","password":"<paste the password>"}' | python3 -m json.tool
```

Expected: `favoritedKeys` now contains the key you favorited.

Un-favorite it:

```bash
curl -s -X POST http://localhost:3000/api/gallery-access/favorite \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","imageKey":"<paste KEY>","favoriteToken":"<paste TOKEN>","favorited":false}'
```

Expected: `{"ok":true}`, and re-running the unlock curl now shows `favoritedKeys: []` again.

Confirm an invalid token is rejected:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/gallery-access/favorite \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-favorites","imageKey":"<paste KEY>","favoriteToken":"garbage.garbage","favorited":true}'
```

Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add app/api/gallery-access/favorite/route.ts
git commit -m "Add POST /api/gallery-access/favorite"
```

---

## Task 5: Client UI — `GalleryPhotoGrid.tsx` + hearts in `GalleryGate.tsx`

**Files:**
- Create: `app/gallery/[slug]/GalleryPhotoGrid.tsx`
- Modify: `app/gallery/[slug]/GalleryGate.tsx` (full-file rewrite — most of the file changes)

**Interfaces:**
- Produces: `GalleryPhotoGrid` component, `{ title: string; images: GalleryMedia[]; favoritedKeys: Set<string>; onToggleFavorite?: (key: string, favorited: boolean) => void }`. When `onToggleFavorite` is omitted, hearts render as read-only indicators. Consumed by this task's `GalleryGate.tsx` and by Task 6's new admin page.
- Consumes: `POST /api/gallery-access/favorite` (Task 4) and the `favoriteToken`/`favoritedKeys` fields on the `/api/gallery-access` response (Task 3).

- [ ] **Step 1: Create `GalleryPhotoGrid.tsx`**

This carries over `triggerDownload`/`triggerDownloads`, `PlayIcon`, and `LazyVideoThumbnail` from `GalleryGate.tsx` unchanged, plus a new `HeartIcon`, and replaces the old checkbox with a heart button:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryMedia } from "@/lib/r2";
import GalleryLightbox from "./GalleryLightbox";

// Triggers a native browser download for one image via a throwaway
// anchor — downloadUrl carries a Content-Disposition: attachment header
// from the server so this reliably saves a file rather than navigating.
function triggerDownload(image: GalleryMedia) {
  const link = document.createElement("a");
  link.href = image.downloadUrl;
  link.download = image.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Browsers throttle/block bursts of programmatic downloads fired in a
// tight loop — spacing them out keeps each one going through cleanly
// (though the browser may still show a one-time "allow multiple
// downloads" prompt for the first batch).
async function triggerDownloads(images: GalleryMedia[]) {
  for (const image of images) {
    triggerDownload(image);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
    >
      <path d="M12 21s-6.7-4.35-9.3-8.28C.86 10.06 1.51 6.9 4.1 5.3c2-1.24 4.5-.7 5.9 1L12 8.6l2-2.3c1.4-1.7 3.9-2.24 5.9-1 2.6 1.6 3.24 4.76 1.4 7.42C18.7 16.65 12 21 12 21z" />
    </svg>
  );
}

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

// Off-screen video tiles don't start fetching until they scroll near the
// viewport — preload="metadata" alone has no lazy equivalent the way
// <img loading="lazy"> does, and a gallery with a few dozen clips would
// otherwise fire that many concurrent metadata fetches at once, which
// mobile Safari's limit on simultaneous <video> elements can choke on.
function LazyVideoThumbnail({
  src,
  className,
}: {
  src: string;
  className: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      // The #t=0.001 fragment nudges iOS Safari to actually paint the
      // first frame instead of a black box — harmless on browsers that
      // don't need it (Chrome/Firefox ignore it and behave the same).
      src={isVisible ? `${src}#t=0.001` : undefined}
      preload="metadata"
      muted
      playsInline
      className={className}
    />
  );
}

export default function GalleryPhotoGrid({
  title,
  images,
  favoritedKeys,
  onToggleFavorite,
}: {
  title: string;
  images: GalleryMedia[];
  favoritedKeys: Set<string>;
  onToggleFavorite?: (key: string, favorited: boolean) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs uppercase tracking-[0.15em]">
        <button
          type="button"
          onClick={() => triggerDownloads(images)}
          className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Download all ({images.length})
        </button>
        <button
          type="button"
          disabled={favoritedKeys.size === 0}
          onClick={() =>
            triggerDownloads(images.filter((i) => favoritedKeys.has(i.key)))
          }
          className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          Download favorites ({favoritedKeys.size})
        </button>
      </div>
      <p className="mb-8 text-center text-xs text-muted">
        Downloading several photos at once may prompt your browser to allow
        multiple downloads.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {images.map((media, i) => {
          const isFavorited = favoritedKeys.has(media.key);
          return (
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
                <LazyVideoThumbnail
                  src={media.url}
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

              {onToggleFavorite ? (
                <button
                  type="button"
                  aria-pressed={isFavorited}
                  aria-label={
                    isFavorited
                      ? `Remove this ${media.isVideo ? "video" : "photo"} from favorites`
                      : `Add this ${media.isVideo ? "video" : "photo"} to favorites`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(media.key, !isFavorited);
                  }}
                  className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-accent"
                >
                  <HeartIcon filled={isFavorited} />
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur-sm"
                >
                  <HeartIcon filled={isFavorited} />
                </span>
              )}

              <a
                href={media.downloadUrl}
                download={media.filename}
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-2 right-2 z-10 rounded bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
              >
                Download
              </a>
            </div>
          );
        })}
      </div>

      {lightboxIndex !== null && (
        <GalleryLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Replace `GalleryGate.tsx` in full**

```tsx
"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { GalleryMedia } from "@/lib/r2";
import GalleryPhotoGrid from "./GalleryPhotoGrid";
import PasswordField from "@/components/PasswordField";

type SubmitStatus = "idle" | "loading" | "error";
type Session = {
  images: GalleryMedia[];
  imagesError: boolean;
  expiresAt: number;
  favoriteToken: string;
  favoritedKeys: string[];
};

function sessionKey(slug: string) {
  return `gallery-session:${slug}`;
}

// No real external events to subscribe to — sessionStorage only changes
// here, from handleSubmit/handlePinSubmit/toggleFavorite below — so this
// just satisfies the hook's contract with a no-op.
function subscribe() {
  return () => {};
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.expiresAt !== "number") return null;
    return {
      images: parsed.images ?? [],
      imagesError: parsed.imagesError ?? false,
      expiresAt: parsed.expiresAt,
      favoriteToken: typeof parsed.favoriteToken === "string" ? parsed.favoriteToken : "",
      favoritedKeys: Array.isArray(parsed.favoritedKeys) ? parsed.favoritedKeys : [],
    };
  } catch {
    return null;
  }
}

// Date.now() is impure, so the expiry check has to happen inside the
// snapshot function (where useSyncExternalStore expects reads of live
// external state), not in the render body.
function isUnlocked(slug: string): boolean {
  const session = parseSession(sessionStorage.getItem(sessionKey(slug)));
  return session !== null && Date.now() < session.expiresAt;
}

export default function GalleryGate({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  // The unlocked session (including signed image URLs) lives in
  // sessionStorage only — there's no server session behind it. The
  // password is verified server-side once (in handleSubmit, via
  // /api/gallery-access), which also signs the image URLs at that point
  // and tells us when those URLs expire; nothing here trusts client state
  // for the actual authorization, only for whether to show the cached
  // result instead of re-prompting. Once expiresAt passes (the signed
  // URLs would be dead anyway), this falls back to the locked gate
  // rather than showing broken images.
  //
  // Kept as a raw string (a primitive, comparable with ===) rather than
  // parsing inside the snapshot function — useSyncExternalStore requires
  // getSnapshot to return a stable reference when nothing changed, and
  // JSON.parse would allocate a new object on every call.
  const unlocked = useSyncExternalStore(
    subscribe,
    () => isUnlocked(slug),
    () => false, // server/initial-hydration snapshot — sessionStorage doesn't exist yet
  );

  // Parsing (pure, no Date.now()) happens separately in the render body —
  // only the unlocked boolean above needed the impure expiry check.
  const sessionRaw = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(sessionKey(slug)),
    () => null,
  );
  const session = parseSession(sessionRaw);

  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"password" | "pin">("password");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");

  // Seeded once from whatever's cached in sessionStorage at mount (the
  // "returning within the same unlocked session" case). Fresh unlocks
  // re-seed this explicitly in handleSubmit/handlePinSubmit below, since
  // this lazy initializer only ever runs once per mount.
  const [favorited, setFavorited] = useState<Set<string>>(
    () => new Set(parseSession(sessionStorage.getItem(sessionKey(slug)))?.favoritedKeys ?? []),
  );

  // Shared by both handleSubmit and handlePinSubmit below — both end the
  // same way once the server confirms access (with or without a PIN
  // step in between), and this keeps that one behavior in one place.
  function commitSession(data: {
    images?: GalleryMedia[];
    imagesError?: boolean;
    expiresAt?: number;
    favoriteToken?: string;
    favoritedKeys?: string[];
  }) {
    const newSession: Session = {
      images: data.images ?? [],
      imagesError: data.imagesError ?? false,
      expiresAt: data.expiresAt ?? Date.now(),
      favoriteToken: data.favoriteToken ?? "",
      favoritedKeys: data.favoritedKeys ?? [],
    };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
  }

  // Keeps sessionStorage's cached favoritedKeys in sync with local state
  // after every optimistic toggle (and its revert, if the request
  // fails), so a same-tab reload within the session window starts from
  // the right favorited set via the lazy initializer above.
  function patchFavoritedKeys(keys: Set<string>) {
    const current = parseSession(sessionStorage.getItem(sessionKey(slug)));
    if (!current) return;
    const next: Session = { ...current, favoritedKeys: Array.from(keys) };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(next));
  }

  async function toggleFavorite(key: string, next: boolean, favoriteToken: string) {
    setFavoriteError("");
    setFavorited((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(key);
      else updated.delete(key);
      patchFavoritedKeys(updated);
      return updated;
    });

    try {
      const response = await fetch("/api/gallery-access/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, imageKey: key, favoriteToken, favorited: next }),
      });
      if (!response.ok) throw new Error("Favorite request failed.");
    } catch {
      setFavorited((prev) => {
        const reverted = new Set(prev);
        if (next) reverted.delete(key);
        else reverted.add(key);
        patchFavoritedKeys(reverted);
        return reverted;
      });
      setFavoriteError(
        "Couldn't save that — your session may have expired. Refresh and sign back in.",
      );
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password }),
      });

      const data: {
        error?: string;
        pinRequired?: boolean;
        images?: GalleryMedia[];
        imagesError?: boolean;
        expiresAt?: number;
        favoriteToken?: string;
        favoritedKeys?: string[];
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      if (data.pinRequired) {
        setSubmitStatus("idle");
        setStage("pin");
        return;
      }

      commitSession(data);
      setFavorited(new Set(data.favoritedKeys ?? []));
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  async function handlePinSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password, pin }),
      });

      const data: {
        error?: string;
        images?: GalleryMedia[];
        imagesError?: boolean;
        expiresAt?: number;
        favoriteToken?: string;
        favoritedKeys?: string[];
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      commitSession(data);
      setFavorited(new Set(data.favoritedKeys ?? []));
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  if (unlocked && session) {
    const { images, imagesError, favoriteToken } = session;

    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
            {title}
          </p>
          <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
            Your gallery
          </h1>
        </div>

        {imagesError ? (
          <p className="text-center text-muted">
            Your photos couldn&rsquo;t be loaded right now. Please refresh
            the page, or get in touch if this keeps happening.
          </p>
        ) : images.length === 0 ? (
          <p className="text-center text-muted">
            Your photos are being prepared and will appear here soon.
          </p>
        ) : (
          <>
            {favoriteError && (
              <p className="mb-4 text-center text-sm text-red-600">{favoriteError}</p>
            )}
            <GalleryPhotoGrid
              title={title}
              images={images}
              favoritedKeys={favorited}
              onToggleFavorite={(key, next) => toggleFavorite(key, next, favoriteToken)}
            />
          </>
        )}
      </div>
    );
  }

  if (stage === "pin") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
            Private Gallery
          </p>
          <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
            {title}
          </h1>
          <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
            Enter the 4-digit PIN shared with you to continue.
          </p>

          <form onSubmit={handlePinSubmit} className="mt-10 space-y-6">
            <PasswordField
              id="pin"
              label="PIN"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(value) => {
                setPin(value);
                setError("");
              }}
              variant="dark"
            />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitStatus === "loading"}
              className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitStatus === "loading" ? "Checking…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
          Private Gallery
        </p>
        <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
          {title}
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
          Enter the password shared with you to view your gallery.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-6">
          <PasswordField
            id="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            variant="dark"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitStatus === "loading"}
            className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitStatus === "loading" ? "Checking…" : "View Gallery"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Manual browser verification**

If the `claude-in-chrome` or `chrome-devtools` browser tools are available (load via `ToolSearch` with query `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp"` if deferred), use them; otherwise do this manually in a real browser.

With `npm run dev` running:

1. Navigate to `http://localhost:3000/gallery/test-gallery-favorites`, enter the password from Task 1 Step 3.
2. Confirm the grid shows 2 photos, each with an outline heart top-left, and buttons read "Download all (2)" and "Download favorites (0)" (disabled).
3. Click one photo's heart. Confirm it fills in immediately and "Download favorites (1)" becomes enabled.
4. Reload the page (same tab/session). Confirm the same photo is still shown as favorited (proves the seed-from-`sessionStorage` lazy initializer works) — no re-entering the password needed since the session is still valid.
5. Open a private/incognito window (a fresh `sessionStorage`, simulating a different device) and unlock the same gallery with the same password. Confirm the same photo shows as favorited — proves persistence is server-side, not just cached in the first tab.
6. Click "Download favorites (1)" — confirm only that one photo downloads (check your Downloads folder / the browser's download shelf), not both.
7. Un-heart the photo. Confirm "Download favorites (0)" and the button disables again.
8. Confirm hearting does nothing inside the lightbox (click a photo to open it, confirm there's no heart control there — only the existing prev/next/close/download-per-item controls apply at the grid level).

- [ ] **Step 5: Commit**

```bash
git add app/gallery/\[slug\]/GalleryPhotoGrid.tsx app/gallery/\[slug\]/GalleryGate.tsx
git commit -m "Replace gallery download-selection checkboxes with persisted hearts"
```

---

## Task 6: Admin gallery detail page + list link

**Files:**
- Create: `app/admin/galleries/[slug]/page.tsx`
- Modify: `app/admin/galleries/page.tsx`

**Interfaces:**
- Consumes: `GalleryPhotoGrid` from Task 5 (rendered with `onToggleFavorite` omitted → read-only hearts).
- Consumes: `listGalleryImages(slug)` from `lib/r2.ts` (existing) and the `gallery_favorites` table from Task 1.
- No new interfaces produced — this is the plan's final consumer.

- [ ] **Step 1: Create the admin detail page**

```tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages } from "@/lib/r2";
import GalleryPhotoGrid from "@/app/gallery/[slug]/GalleryPhotoGrid";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Gallery" };
}

export default async function AdminGalleryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseClient();

  // Deliberately not gated by isGalleryUnavailable — unlike the
  // client-facing /gallery/[slug] route, the photographer should still
  // be able to pull favorites/downloads from an archived or expired
  // gallery for their own reference.
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("id, title, client_name")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
  }

  if (!gallery) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
        <p className="text-muted">Gallery not found.</p>
      </div>
    );
  }

  const { data: favoriteRows, error: favoritesError } = await supabase
    .from("gallery_favorites")
    .select("image_key")
    .eq("gallery_id", gallery.id);

  if (favoritesError) {
    console.error("Failed to load gallery favorites:", favoritesError);
  }
  const favoritedKeys = new Set((favoriteRows ?? []).map((row) => row.image_key));

  let images;
  let imagesError = false;
  try {
    images = await listGalleryImages(slug);
  } catch (err) {
    console.error("Failed to list gallery images from R2:", err);
    images = [];
    imagesError = true;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          {gallery.client_name}
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          {gallery.title}
        </h1>
      </div>

      {imagesError ? (
        <p className="text-center text-muted">
          Photos couldn&rsquo;t be loaded from R2 right now.
        </p>
      ) : images.length === 0 ? (
        <p className="text-center text-muted">No photos uploaded yet.</p>
      ) : (
        <GalleryPhotoGrid title={gallery.title} images={images} favoritedKeys={favoritedKeys} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Link to it from the galleries list**

Replace:

```tsx
                    <td className="py-3 pr-4 text-foreground">{gallery.slug}</td>
```

with:

```tsx
                    <td className="py-3 pr-4 text-foreground">
                      <Link
                        href={`/admin/galleries/${gallery.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {gallery.slug}
                      </Link>
                    </td>
```

(`Link` is already imported at the top of `app/admin/galleries/page.tsx` — no new import needed.)

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Manual browser verification**

With `npm run dev` running and logged into `/admin` (the existing admin password gate):

1. From your Task 5 browser verification, leave one photo hearted on `test-gallery-favorites` (heart it again via the client gallery link if you un-hearted everything).
2. Navigate to `/admin/galleries`. Confirm the `test-gallery-favorites` row's slug is now a link.
3. Click it. Confirm you land on `/admin/galleries/test-gallery-favorites` with no password/PIN prompt (already admin-authenticated), and the same photo shows as hearted (filled heart) that you set from the client side.
4. Confirm the heart icons are **not** clickable here (no hover/cursor change, no `aria-pressed` button — inspect via `read_page` or just attempt a click and confirm nothing happens/no network request fires).
5. Click "Download all (2)" and "Download favorites (1)" and confirm both work, downloading the right files.
6. Archive the test gallery (`npm run gallery:archive -- test-gallery-favorites`), then reload `/admin/galleries/test-gallery-favorites` — confirm it still loads normally (proving the admin route isn't gated by `archived_at`), while `/gallery/test-gallery-favorites` (in a normal or incognito tab) now shows the client-facing "Gallery has expired" screen.
7. Unarchive it again: `npm run gallery:unarchive -- test-gallery-favorites`.

- [ ] **Step 5: Clean up the test fixture**

```bash
npm run gallery:delete -- test-gallery-favorites --yes
rm -rf /tmp/gallery-favorites-fixtures
```

Expected: deletion succeeds and removes both the `galleries` row and its R2 photos; the `gallery_favorites` row(s) for it are gone too via the `on delete cascade` from Task 1 (optional spot-check: re-run Task 1 Step 2's verification script — `data` should still be `[]` afterward, or contain only rows from unrelated galleries if any exist).

- [ ] **Step 6: Add the production env var reminder**

Add `GALLERY_FAVORITE_TOKEN_SECRET` to Vercel: **Project Settings → Environment Variables**, add it for **Production** and **Preview**, using a freshly generated value (`openssl rand -hex 32`) — same as `ADMIN_PASSWORD`/`CRON_SECRET` are already set up. (This step is a reminder for the project owner to do manually in the Vercel dashboard — do not attempt to do this yourself via CLI without the owner's explicit go-ahead.)

- [ ] **Step 7: Commit**

```bash
git add app/admin/galleries/\[slug\]/page.tsx app/admin/galleries/page.tsx
git commit -m "Add read-only admin gallery detail page with favorites"
```
