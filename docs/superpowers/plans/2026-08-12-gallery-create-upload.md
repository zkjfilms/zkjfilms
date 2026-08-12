# Gallery Creation & Photo Upload Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run gallery:create` and `npm run gallery:upload` so a new password-protected client gallery can go live end-to-end from the command line, closing the only gap in the gallery feature (viewing/expiry/archive/delete already exist; creation and photo upload do not).

**Architecture:** Both commands are added to the existing `scripts/gallery.mjs` CLI (same Supabase client, same `requireEnv`/dispatch pattern as `list`/`set`/`archive`/`unarchive`/`delete`). `create` inserts a `galleries` row with a freshly generated, bcrypt-hashed password. `upload` pushes every image file in a local folder to `galleries/<slug>/` in the **private** R2 bucket (`R2_BUCKET_NAME`, distinct from the public bucket `scripts/uploadImage.mjs` uses).

**Tech Stack:** Node.js (plain script, run via `--env-file=.env.local`), `@supabase/supabase-js`, `@aws-sdk/client-s3`, `bcryptjs`.

## Global Constraints

- Slugs must match `^[a-z0-9-]+$` (they appear in the public URL `/gallery/<slug>`).
- Generated passwords use two distinct words from a fixed 24-word list plus a random two-digit number, joined by hyphens (e.g. `dune-lantern-47`) — spec: `docs/superpowers/specs/2026-08-12-gallery-create-upload-design.md`.
- Passwords are hashed with `bcrypt.hash(password, 10)` before storage (cost factor 10, matching the existing `bcrypt.compare` call in `app/api/gallery-access/route.ts`); the plaintext is printed once and never stored.
- Photo uploads use `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` (private bucket) — never `R2_PUBLIC_*` (public marketing bucket).
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest config, no existing tests for `scripts/gallery.mjs`). Verification is manual: run the command against the real Supabase project and R2 bucket (already configured in `.env.local`) and inspect the result, then clean up with `gallery:delete`. This matches how the existing `list`/`set`/`archive`/`delete` commands were verified.

---

## Task 1: `npm run gallery:create`

**Files:**
- Modify: `scripts/gallery.mjs` (add imports, word list, `generatePassword`, `create` function, dispatch case, usage text)
- Modify: `package.json` (add `gallery:create` script)

**Interfaces:**
- Produces: `generatePassword(): string` — used only within this file (Task 2 does not need it).
- Produces: CLI command `npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]`.

- [ ] **Step 1: Add new imports and the password word list to `scripts/gallery.mjs`**

At the top of `scripts/gallery.mjs`, change the imports block from:

```js
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
```

to:

```js
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
```

(`PutObjectCommand` is added in Task 2, not here — Task 1 doesn't upload anything.)

Immediately below the imports (before `function requireEnv`), add:

```js
// zkjfilms.com — kept in sync manually since this script runs as plain
// Node, not through Next/TypeScript (same reasoning as
// PUBLIC_IMAGES_BASE_URL in uploadImage.mjs; see lib/seo.ts SITE_URL for
// the source of truth used by the rest of the app).
const SITE_URL = "https://zkjfilms.com";

// Used by generatePassword() below. Deliberately plain, unambiguous
// words (no near-duplicates like "there"/"their") since these are read
// aloud or copy-pasted by clients, not typed from memory repeatedly.
const PASSWORD_WORDS = [
  "dune", "lantern", "willow", "harbor", "ember", "meadow", "cedar",
  "canyon", "ridge", "marble", "violet", "amber", "thistle", "granite",
  "coral", "birch", "quartz", "tundra", "orchid", "copper", "alpine",
  "cinder", "sable", "laurel",
];

// Two distinct words + a two-digit number, e.g. "dune-lantern-47". Not
// meant to resist brute force on its own — the R2 photo URLs behind the
// gate are short-lived signed URLs; this just keeps casual guessing out.
function generatePassword() {
  const first = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  let second = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  while (second === first) {
    second = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  }
  const number = randomInt(10, 100);
  return `${first}-${second}-${number}`;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;
```

- [ ] **Step 2: Add the `create` function**

Add this function after `getR2Client()` and before `deleteGalleryPhotos` (grouping it with the other gallery-lifecycle functions rather than the R2 helpers, since `create` never touches R2):

```js
async function create(slug, title, clientName, expiresAtArg) {
  if (!slug || !title || !clientName) {
    console.error(
      'Usage: npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
    );
    process.exit(1);
  }

  if (!SLUG_PATTERN.test(slug)) {
    console.error(
      `"${slug}" isn't a valid slug — use only lowercase letters, numbers, and hyphens.`,
    );
    process.exit(1);
  }

  let expiresAt = null;
  if (expiresAtArg && expiresAtArg !== "none" && expiresAtArg !== "clear") {
    const parsed = new Date(expiresAtArg);
    if (Number.isNaN(parsed.getTime())) {
      console.error(
        `"${expiresAtArg}" isn't a valid date. Try YYYY-MM-DD or a full ISO timestamp.`,
      );
      process.exit(1);
    }
    expiresAt = parsed.toISOString();
  }

  const { data: existing, error: lookupError } = await supabase
    .from("galleries")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to check for existing gallery:", lookupError.message);
    process.exit(1);
  }

  if (existing) {
    console.error(`A gallery with slug "${slug}" already exists.`);
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("galleries")
    .insert({
      slug,
      title,
      client_name: clientName,
      password_hash: passwordHash,
      expires_at: expiresAt,
    })
    .select("slug")
    .single();

  if (error) {
    console.error("Failed to create gallery:", error.message);
    process.exit(1);
  }

  console.log(`Created gallery "${data.slug}".`);
  console.log(`URL: ${SITE_URL}/gallery/${data.slug}`);
  console.log(`Password: ${password}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
  console.log(expiresAt ? `Expires: ${expiresAt}` : "Expires: never");

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    console.log(
      "Note: that date is in the past, so this gallery is immediately locked.",
    );
  }
}
```

- [ ] **Step 3: Wire up the dispatch case and usage text**

In the dispatch block at the bottom of the file, add a case above the `else`:

```js
} else if (command === "create") {
  await create(args[0], args[1], args[2], args[3]);
} else if (command === "set") {
```

(insert immediately before the existing `else if (command === "set")` line).

Update the usage list printed in the final `else` branch to include the new command, so it reads:

```js
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      '  npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    ].join("\n"),
  );
```

Also update the usage comment block at the very top of the file (the `// Usage (via npm scripts...` comment) to add the `gallery:create` line, matching the format of the other entries there.

- [ ] **Step 4: Add the npm script**

In `package.json`, add a new line inside `"scripts"` immediately above `"gallery:set-expiry"`:

```json
    "gallery:create": "node --env-file=.env.local scripts/gallery.mjs create",
```

- [ ] **Step 5: Manually verify against the real Supabase project**

Run:

```bash
npm run gallery:create -- test-gallery-plan "Test Gallery" "Test Client"
```

Expected: prints `Created gallery "test-gallery-plan".`, a `URL:` line ending in `/gallery/test-gallery-plan`, a `Password:` line in the `word-word-NN` shape, and `Expires: never`. Then verify in Supabase (SQL editor or `npm run gallery:list`) that the row exists with a `password_hash` starting with `$2` (bcrypt's prefix) — never the plaintext.

Then verify validation paths:

```bash
npm run gallery:create -- test-gallery-plan "Test Gallery" "Test Client"
```

Expected: fails with `A gallery with slug "test-gallery-plan" already exists.` (not a raw Postgres error).

```bash
npm run gallery:create -- "Not A Slug" "Test" "Test"
```

Expected: fails with the invalid-slug message, no row inserted.

```bash
npm run gallery:create -- test-gallery-plan-2 "Test" "Test" 2026-01-01
```

Expected: succeeds, prints `Expires: 2026-01-01T00:00:00.000Z` (or equivalent ISO) and the "immediately locked" note, since that date is in the past relative to today (2026-08-12).

Clean up both rows: `npm run gallery:delete -- test-gallery-plan --yes` and `npm run gallery:delete -- test-gallery-plan-2 --yes`.

- [ ] **Step 6: Commit**

```bash
git add scripts/gallery.mjs package.json
git commit -m "Add gallery:create command to generate and store a new client gallery"
```

---

## Task 2: `npm run gallery:upload`

**Files:**
- Modify: `scripts/gallery.mjs` (add `PutObjectCommand` import, `fs`/`path` imports, content-type map, `upload` function, dispatch case, usage text)
- Modify: `package.json` (add `gallery:upload` script)

**Interfaces:**
- Consumes: `getR2Client()` (existing, defined earlier in the file), `requireEnv(name: string)` (existing), `supabase` (existing module-level client).
- Produces: CLI command `npm run gallery:upload -- <slug> <local-folder>`.

- [ ] **Step 1: Add imports and the content-type map**

Change the imports block (as left after Task 1) from:

```js
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
```

to:

```js
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
```

Below the `SLUG_PATTERN` constant added in Task 1, add:

```js
// Kept in sync with CONTENT_TYPES in uploadImage.mjs by hand — same
// reasoning as SITE_URL above (this file isn't compiled, so it can't
// import a shared TS constant).
const UPLOAD_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};
```

- [ ] **Step 2: Add the `upload` function**

Add after the `create` function from Task 1:

```js
async function upload(slug, folderPath) {
  if (!slug || !folderPath) {
    console.error("Usage: npm run gallery:upload -- <slug> <local-folder>");
    process.exit(1);
  }

  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Failed to look up gallery:", error.message);
    process.exit(1);
  }

  if (!gallery) {
    console.error(
      `No gallery found with slug "${slug}". Create it first with gallery:create.`,
    );
    process.exit(1);
  }

  let entries;
  try {
    entries = readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read folder "${folderPath}":`, err.message);
    process.exit(1);
  }

  const client = getR2Client();
  const bucket = requireEnv("R2_BUCKET_NAME");

  let uploaded = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const ext = extname(entry.name).toLowerCase();
    const contentType = UPLOAD_CONTENT_TYPES[ext];

    if (!contentType) {
      console.log(`Skipping "${entry.name}" (not a recognized image type).`);
      skipped += 1;
      continue;
    }

    const body = readFileSync(join(folderPath, entry.name));
    const key = `galleries/${slug}/${entry.name}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    console.log(`Uploaded ${entry.name} -> ${key}`);
    uploaded += 1;
  }

  console.log(`\nUploaded ${uploaded} photo(s), skipped ${skipped} non-image file(s).`);
}
```

- [ ] **Step 3: Wire up the dispatch case and usage text**

Add a case above the `create` case added in Task 1:

```js
} else if (command === "upload") {
  await upload(args[0], args[1]);
} else if (command === "create") {
```

Update the usage list in the final `else` branch (extending what Task 1 added) to read:

```js
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      '  npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
      "  npm run gallery:upload -- <slug> <local-folder>",
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    ].join("\n"),
  );
```

Also add the corresponding line to the top-of-file usage comment block, same as Task 1 did for `create`.

- [ ] **Step 4: Add the npm script**

In `package.json`, add immediately below the `gallery:create` line added in Task 1:

```json
    "gallery:upload": "node --env-file=.env.local scripts/gallery.mjs upload",
```

- [ ] **Step 5: Manually verify against the real Supabase project and R2 bucket**

Create a scratch gallery and a scratch folder with a couple of test images plus a non-image file:

```bash
npm run gallery:create -- test-gallery-plan "Test Gallery" "Test Client"
mkdir -p /tmp/gallery-upload-test
cp public/favicon.ico /tmp/gallery-upload-test/not-a-photo.ico 2>/dev/null || true
# Use any two small local image files you have handy, e.g.:
# cp ~/Desktop/sample1.jpg /tmp/gallery-upload-test/
# cp ~/Desktop/sample2.png /tmp/gallery-upload-test/
touch /tmp/gallery-upload-test/notes.txt
```

Run:

```bash
npm run gallery:upload -- test-gallery-plan /tmp/gallery-upload-test
```

Expected: an `Uploaded <file> -> galleries/test-gallery-plan/<file>` line per image file, a `Skipping "notes.txt"` line, and a final `Uploaded 2 photo(s), skipped 1 non-image file(s).` line (counts matching whatever was placed in the folder).

Verify end-to-end: visit `/gallery/test-gallery-plan` in the browser, enter the password printed by `gallery:create`, and confirm the uploaded photos display and download correctly.

Then verify the not-found path:

```bash
npm run gallery:upload -- nonexistent-slug-plan /tmp/gallery-upload-test
```

Expected: fails with `No gallery found with slug "nonexistent-slug-plan". Create it first with gallery:create.` before any R2 calls.

Clean up:

```bash
npm run gallery:delete -- test-gallery-plan --yes
rm -rf /tmp/gallery-upload-test
```

(`gallery:delete` without `--keep-photos` also removes the uploaded R2 objects, so no separate R2 cleanup is needed.)

- [ ] **Step 6: Commit**

```bash
git add scripts/gallery.mjs package.json
git commit -m "Add gallery:upload command to push client photos into a gallery's R2 folder"
```
