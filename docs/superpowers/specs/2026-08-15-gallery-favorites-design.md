# Gallery Favorites

## Problem

Client galleries (`app/gallery/[slug]`) already let a client bulk-download everything or a checkbox-selected subset (`GalleryGate.tsx`), but that selection is purely local `useState`, gone the moment the tab closes. There's no way for a client to tell the photographer which photos they actually love, and no way for the photographer to act on that without manually re-deriving it (currently: not at all — there's no channel for it today).

## Goal

Let a client mark favorite photos in their gallery, persisted server-side so it survives across sessions/devices. Give both the client and the photographer a one-click "Download favorites" action driven by that persisted state, instead of the photographer having to cross-reference a list against the gallery by hand. No payment or product ordering — that's a distinct, much larger feature, deliberately out of scope here.

## Design

### Schema

Append to `supabase/schema.sql`:

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

RLS enabled, no policies — service-role only, matching every other table in this file. `image_key` is the R2 object key (`GalleryMedia.key` from `lib/r2.ts`), not a foreign key to anything — gallery photos aren't rows in the database, they're listed live from R2 by `listGalleryImages`, so a favorite is just "this key was hearted in this gallery." `on delete cascade` means deleting a gallery (`gallery:delete`) cleans up its favorites automatically.

### Auth for the toggle endpoint

`/api/gallery-access` currently re-verifies the password (and PIN, if set) via `bcrypt.compare` and is stateless — no session token, no cookie. Re-running that same check on every heart click would be both slow (bcrypt is deliberately expensive) and awkward (the client would have to keep the plaintext password around in memory to resend it, which it doesn't today — `sessionStorage` only holds `images`/`imagesError`/`expiresAt`).

Instead, once password (and PIN) verification succeeds, the route also issues a short-lived signed token scoped to that gallery, valid for the same window as the signed image URLs it returns (`SIGNED_URL_EXPIRY_SECONDS`, 1 hour). New file `lib/galleryFavoriteToken.ts`, modeled directly on the HMAC approach in `lib/adminAccess.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.GALLERY_FAVORITE_TOKEN_SECRET;
  if (!secret) throw new Error("GALLERY_FAVORITE_TOKEN_SECRET is not set.");
  return secret;
}

export function createFavoriteToken(slug: string, expiresAt: number): string {
  const signature = createHmac("sha256", getSecret())
    .update(`${slug}:${expiresAt}`)
    .digest("hex");
  return `${expiresAt}.${signature}`;
}

export function isValidFavoriteToken(slug: string, token: string): boolean {
  const [expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!signature || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    return false;
  }
  const expected = createHmac("sha256", getSecret())
    .update(`${slug}:${expiresAt}`)
    .digest("hex");
  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expected);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
```

The expiry is embedded in the token itself (like an S3 presigned URL's signature covers its expiry) so verification never needs a database or session lookup — just recompute the HMAC. `GALLERY_FAVORITE_TOKEN_SECRET` is a new env var, added to `.env.example` alongside `ADMIN_PASSWORD`/`CRON_SECRET`; a distinct secret from both, since this guards a different trust boundary (a single gallery's favorites, not admin or cron access).

### `app/api/gallery-access/route.ts` (extended)

After the existing password/PIN checks pass (unchanged), before returning:

- Look up the gallery's `id` (already implicitly available — the existing `select` gains `id`) and fetch its current favorites: `select image_key from gallery_favorites where gallery_id = :id`.
- Generate `favoriteToken = createFavoriteToken(slug, expiresAt)` using the same `expiresAt` already computed for the signed image URLs.
- Response becomes `{ ok: true, images, expiresAt, favoriteToken, favoritedKeys }`, where `favoritedKeys` is a plain string array of hearted `image_key`s.

### New route: `app/api/gallery-access/favorite/route.ts`

`POST { slug, imageKey, favoriteToken, favorited: boolean }`:

1. Reject if `imageKey` or `slug` is missing/wrong type — same `parsePayload`-style validation as `gallery-access`.
2. Look up the gallery by `slug` (need its `id` and availability fields). 404 if not found.
3. Re-check `isGalleryUnavailable(gallery)` — if a gallery is archived or its `expires_at` passes mid-session, favoriting stops working too, same as everything else gated by that check.
4. `isValidFavoriteToken(slug, favoriteToken)` — `401` if invalid/expired. No rate limiting needed here (unlike `gallery-access`, which guards against password/PIN guessing): this endpoint can't be reached without already holding a valid token from a successful unlock, so there's no brute-forceable secret at this layer.
5. `favorited === true` → upsert `(gallery_id, image_key)` into `gallery_favorites` (`on conflict (gallery_id, image_key) do nothing`). `favorited === false` → delete the matching row. Either way, respond `{ ok: true }`.

### Client UI (`GalleryGate.tsx`)

- `Session` type gains `favoriteToken: string` and `favoritedKeys: string[]`; `commitSession`/`parseSession` extended to carry both through `sessionStorage` the same way `images`/`expiresAt` already are.
- Local state: replace `selected` (`Set<string>`) with `favorited` (`Set<string>`), seeded from `session.favoritedKeys` on unlock.
- The existing checkbox (lines ~324–337 today) becomes a heart icon/button. Click handler: optimistically flip membership in the local `favorited` set, then `POST /api/gallery-access/favorite` with the new state; on failure, revert the optimistic flip and show a small inline error (mirrors how the gate already re-locks on `expiresAt` — an expired token here is an expected, not exceptional, failure mode).
- "Select all" / "Clear selection" toggle button is dropped — there's no bulk-favorite action; favoriting is a considered, per-photo choice, not a bulk one.
- "Download all (n)" is unchanged.
- "Download selected (n)" becomes "Download favorites (n)", `disabled={favorited.size === 0}`, filtering `images` by `favorited.has(i.key)` exactly as the old `selected` filter did.
- Per-image "Download" link (bottom-right of each thumbnail) is unchanged.
- Lightbox (`GalleryLightbox.tsx`) is untouched — it has no selection/favorite controls today and doesn't gain any; favoriting stays a grid-level action, matching the current checkbox's scope.

### Shared component: `GalleryPhotoGrid`

The grid markup (buttons row + photo grid + lightbox wiring, roughly lines 246–360 of today's `GalleryGate.tsx`) is extracted into a new `app/gallery/[slug]/GalleryPhotoGrid.tsx`, so the admin page (below) can render the identical grid without duplicating it:

```ts
type GalleryPhotoGridProps = {
  title: string;
  images: GalleryMedia[];
  favoritedKeys: Set<string>;
  onToggleFavorite?: (key: string, favorited: boolean) => void;
};
```

`GalleryGate` keeps all password/PIN/session/token logic and renders `<GalleryPhotoGrid>` once unlocked, passing its toggle handler. When `onToggleFavorite` is omitted (the admin page's case), hearts render as plain read-only indicators — filled/unfilled `<span>`, not a `<button>` — rather than being hidden, so the photographer can see what's hearted without it looking clickable.

### Admin view: `app/admin/galleries/[slug]/page.tsx`

New server component. No new auth logic needed — every route under `app/admin` already inherits the cookie check from `app/admin/layout.tsx`, so this page loads straight to content for anyone already admin-authenticated, no password/PIN prompt.

- Looks up the gallery by `slug` directly via Supabase service role (needs `id`, `title`, plus availability/`client_name` for a header) — deliberately does **not** call `isGalleryUnavailable`/block on it: the point of the admin entry point is that the photographer can still pull favorites/downloads from an archived or expired gallery for their own reference, even though a client hitting the public link at that point would be turned away.
- Calls `listGalleryImages(slug)` directly (same R2 helper the client route uses — service-role R2 access, no signed request needed since this call already happens server-side with real credentials either way).
- Fetches `gallery_favorites` for that `gallery_id`.
- Renders `<GalleryPhotoGrid images={...} favoritedKeys={...} />` with no `onToggleFavorite` — read-only hearts, both download buttons fully functional.

`app/admin/galleries/page.tsx` (today a plain read-only table) gets one addition: each row's `slug`/title becomes a `<Link href={`/admin/galleries/${slug}`}>` into the new detail page.

### Out of scope

- No payment, product catalog, or print fulfillment — favorites are informational/delivery only.
- No email notification when a client favorites something — the photographer checks the new admin page whenever they want.
- No admin ability to add/remove favorites — hearts reflect the client's choice only; the admin page is read-only.
- No bulk "favorite all" action.
- No favoriting from inside the lightbox — grid-only, matching the current checkbox's scope.
- Admin page is not gated by `expires_at`/`archived_at` — deliberately available past those boundaries for the photographer's own reference (see above); the client-facing route's existing gating is unchanged.
- No rate limiting on the new favorite-toggle route — it requires a valid time-scoped token that can only come from a successful password/PIN unlock, which is already rate-limited.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- Add `GALLERY_FAVORITE_TOKEN_SECRET` locally before testing (missing-env behavior should fail closed, same as `ADMIN_PASSWORD`/`CRON_SECRET` do today).
- Browser, client side: unlock a test gallery, heart a couple of photos, confirm the UI updates optimistically and "Download favorites" enables; reload the page (same session) and confirm hearts persist; clear `sessionStorage` and re-unlock (simulating a different device) and confirm hearts still show, proving persistence is server-side, not just cached.
- Confirm un-hearting removes a photo from "Download favorites" immediately.
- Confirm "Download favorites" only downloads the hearted subset, and "Download all" is unaffected.
- Let a token expire (or manually test against a `favoriteToken` built with a past `expiresAt`) and confirm the toggle request fails cleanly with the optimistic UI reverting, not a crash.
- Confirm favoriting on an archived/expired gallery is rejected (`isGalleryUnavailable` check in the new route).
- Admin side: visit `/admin/galleries/<slug>` for the same test gallery, confirm the hearted photos match what the client set, confirm both download buttons work, confirm hearts are not clickable there.
- Confirm the admin detail page is reachable for an archived/expired gallery (distinct from the client-facing `/gallery/<slug>`, which should still show its existing "expired" state).
- `npm run gallery:delete -- <test-slug> --yes` and confirm the gallery's `gallery_favorites` rows are gone too (cascade).
