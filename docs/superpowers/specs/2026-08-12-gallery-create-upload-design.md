# Gallery Creation & Photo Upload Tooling

## Problem

The client gallery feature (`app/gallery/[slug]`, `app/api/gallery-access`, `lib/r2.ts`) is fully built on the viewing side — password gate, signed R2 URLs, expiration, archive/delete. `scripts/gallery.mjs` covers the lifecycle of an *existing* gallery (`list`, `set`, `archive`, `unarchive`, `delete`), but nothing creates a new gallery row or gets a client's photos into R2. `scripts/uploadImage.mjs` looks adjacent but is explicitly for the separate public marketing bucket (`zkjfilms-public`) — using it for client photos would make them permanently public, which is the opposite of what this feature needs. There is currently no supported way to put a new password-protected gallery online.

## Goal

Two new CLI commands, following the existing `gallery.mjs` conventions (npm script wrapper, `--env-file=.env.local`, `requireEnv` helper), that let the admin create a gallery and upload its photos without touching SQL or the R2 dashboard directly.

## Design

### `npm run gallery:create -- <slug> <title> <client-name> [expires-at]`

Added as a new command inside `scripts/gallery.mjs` (same file as the other lifecycle commands — they share the Supabase client already set up there).

- Validates `slug` matches `^[a-z0-9-]+$`; rejects with a clear error otherwise (it becomes part of the public URL `/gallery/<slug>`).
- Checks the slug isn't already taken (`select` before `insert`) and fails with a clear error if it is, rather than a raw Postgres unique-constraint error.
- `expires-at` is optional and reuses the exact date-parsing behavior already in `setExpiry` (anything `Date` accepts, `none`/`clear` or omitted means never expires).
- Generates a random password: two words drawn from a small embedded word list (photography-themed, e.g. `dune`, `lantern`, `willow`, `harbor` — no special chars or ambiguous words like "l"/"1" confusion) joined with a random 2-digit number, e.g. `dune-lantern-47`. ~26 words gives 26×25×90 ≈ 58,500 combinations — plenty for a client-facing password meant to be read over email/text, not brute-force-resistant on its own (the real protection is that the R2 photo URLs are signed and short-lived, and this password just gates who gets them).
- Hashes the password with `bcryptjs` (`bcrypt.hash(password, 10)` — same cost factor implied by the existing `bcrypt.compare` usage in `gallery-access/route.ts`) and inserts the row (`slug`, `title`, `client_name`, `password_hash`, `expires_at`).
- Prints the slug, full gallery URL, and the **plaintext** password once. This is the only time it's ever visible — only the hash is persisted, matching how verification already works.

### `npm run gallery:upload -- <slug> <local-folder>`

Also added to `scripts/gallery.mjs`.

- Looks up the gallery by slug first; errors clearly if it doesn't exist (prevents silently uploading photos under a slug nobody can reach).
- Reads the folder non-recursively (`readdirSync`). Filters entries by extension against the same `CONTENT_TYPES` map used in `uploadImage.mjs` (jpg/jpeg/png/webp/avif/gif) — non-image files are skipped with a printed warning, not a fatal error, since a folder handed off by a client often has stray `.DS_Store` or sidecar files.
- Uploads each match to `galleries/<slug>/<filename>` in the **private** bucket, using `R2_BUCKET_NAME` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (the same credentials `lib/r2.ts` and the existing `gallery.mjs` delete path already use) — never the `R2_PUBLIC_*` credentials. Uploading to a key that already exists overwrites it, same behavior as `uploadImage.mjs`.
- Prints a running line per file and a final summary count (`Uploaded N photo(s), skipped M non-image file(s)`).

### Out of scope

- No image resizing/optimization — uploads files as-is, matching `uploadImage.mjs`'s behavior.
- No recursive folder walk — flat folder of images only.
- No editing an existing gallery's title/client-name/password after creation (not requested; `gallery:set-expiry`/`archive`/`delete` already cover the lifecycle operations that exist today).
- No change to `app/admin/galleries` (the read-only admin list page) — it already links out to `npm run gallery:*` in its help text, which will now be accurate.

## Testing / Verification

- `npm run gallery:create -- test-gallery "Test Gallery" "Test Client"` against a scratch Supabase row: confirm the row appears with a valid bcrypt hash, the printed password actually unlocks `/gallery/test-gallery` in the browser, and re-running with the same slug fails cleanly instead of erroring on the DB constraint.
- `npm run gallery:create -- test-gallery "..." "..." 2026-01-01` (a past date): confirm it prints the same "immediately locked" note the existing `set` command prints.
- `npm run gallery:upload -- test-gallery ./scratch-folder` with a mix of `.jpg`/`.png` and a stray `.DS_Store`/`.txt`: confirm only the images upload, the summary count matches, and the uploaded photos appear in the unlocked gallery.
- `npm run gallery:upload -- nonexistent-slug ./scratch-folder`: confirm it errors before touching R2.
- Clean up the scratch gallery afterward with `npm run gallery:delete -- test-gallery --yes`.
