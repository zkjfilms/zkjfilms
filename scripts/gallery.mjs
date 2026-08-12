// Manage client galleries — expiration, archiving, deletion — without
// touching SQL.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run gallery:list
//   npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]
//   npm run gallery:upload -- <slug> <local-folder>
//   npm run gallery:set-expiry -- <slug> <date|none>
//   npm run gallery:archive -- <slug>
//   npm run gallery:unarchive -- <slug>
//   npm run gallery:set-pin -- <slug>
//   npm run gallery:set-password -- <slug>
//   npm run gallery:delete -- <slug> [--yes] [--keep-photos]
//
// <date> accepts anything JS's Date constructor understands, e.g.
// 2026-12-31 or 2026-12-31T23:59:59Z. Use "none" (or "clear") to remove
// an expiration so the gallery never expires.
//
// Archiving is independent of expiration — a gallery can be archived
// immediately regardless of its expires_at, and expires_at is preserved
// (not cleared) when archiving, in case you unarchive it later.
//
// Deleting is permanent: it removes the database row and, unless
// --keep-photos is passed, every photo under galleries/<slug>/ in R2.
// Interactive by default (type the slug to confirm); pass --yes to skip
// the prompt for non-interactive/scripted use.

import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm scripts (gallery:*), which load .env.local automatically.`,
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

function getR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

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

// Three distinct words + a two-digit number, e.g. "dune-lantern-willow-47".
// Three words keep this readable over a phone call while raising the guess
// space meaningfully above the endpoint's lack of rate limiting — not a
// substitute for rate limiting, which this password format alone cannot
// provide.
function generatePassword() {
  const words = [];
  while (words.length < 3) {
    const candidate = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
    if (!words.includes(candidate)) words.push(candidate);
  }
  const number = randomInt(10, 100);
  return `${words.join("-")}-${number}`;
}

// Used by create() and setPin() below. Zero-padded so e.g. 0472 stays
// four characters — compared as a string, never parsed as a number.
function generatePin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

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
  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data, error } = await supabase
    .from("galleries")
    .insert({
      slug,
      title,
      client_name: clientName,
      password_hash: passwordHash,
      pin_hash: pinHash,
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
  console.log(`PIN: ${pin}`);
  console.log("(Shown once — only their hashes are stored. Save both before closing this terminal.)");
  console.log(expiresAt ? `Expires: ${expiresAt}` : "Expires: never");

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    console.log(
      "Note: that date is in the past, so this gallery is immediately locked.",
    );
  }
}

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
  let failed = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    if (entry.name.startsWith(".")) {
      console.log(`Skipping "${entry.name}" (dotfile — likely a sidecar/system file, not a photo).`);
      skipped += 1;
      continue;
    }

    const ext = extname(entry.name).toLowerCase();
    const contentType = UPLOAD_CONTENT_TYPES[ext];

    if (!contentType) {
      console.log(`Skipping "${entry.name}" (not a recognized image type).`);
      skipped += 1;
      continue;
    }

    const key = `galleries/${slug}/${entry.name}`;

    try {
      const body = readFileSync(join(folderPath, entry.name));
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
    } catch (err) {
      console.error(`Failed to upload "${entry.name}":`, err.message);
      failed += 1;
      continue;
    }
  }

  console.log(
    `\nUploaded ${uploaded} photo(s), skipped ${skipped} non-image file(s)${
      failed > 0 ? `, failed ${failed} upload(s)` : ""
    }.`,
  );

  if (uploaded > 0) {
    const prefix = `galleries/${slug}/`;
    const listing = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
    );
    const count = listing.KeyCount ?? (listing.Contents ?? []).length;
    if (count >= 1000) {
      console.warn(
        `WARNING: this gallery now has ${count} photos in R2. Only the first 1000 will be visible to the client (R2's list API caps at 1000 objects per prefix) — contact the developer about pagination before this gallery ships.`,
      );
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
}

async function deleteGalleryPhotos(slug) {
  const client = getR2Client();
  const bucket = requireEnv("R2_BUCKET_NAME");
  const prefix = `galleries/${slug}/`;

  const listing = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const keys = (listing.Contents ?? [])
    .map((obj) => obj.Key)
    .filter((key) => typeof key === "string");

  if (keys.length === 0) return 0;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );

  return keys.length;
}

function statusFor(gallery) {
  if (gallery.archived_at) return `ARCHIVED (${gallery.archived_at})`;
  if (!gallery.expires_at) return "never expires";
  return new Date(gallery.expires_at).getTime() < Date.now()
    ? `EXPIRED (${gallery.expires_at})`
    : `expires ${gallery.expires_at}`;
}

async function list() {
  const { data, error } = await supabase
    .from("galleries")
    .select("slug, title, expires_at, archived_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list galleries:", error.message);
    process.exit(1);
  }

  if (!data.length) {
    console.log("No galleries found.");
    return;
  }

  for (const gallery of data) {
    console.log(
      `${gallery.slug.padEnd(24)} ${gallery.title.padEnd(32)} ${statusFor(gallery)}`,
    );
  }
}

async function setExpiry(slug, dateArg) {
  if (!slug || !dateArg) {
    console.error("Usage: npm run gallery:set-expiry -- <slug> <date|none>");
    process.exit(1);
  }

  let expiresAt = null;
  if (dateArg !== "none" && dateArg !== "clear") {
    const parsed = new Date(dateArg);
    if (Number.isNaN(parsed.getTime())) {
      console.error(
        `"${dateArg}" isn't a valid date. Try YYYY-MM-DD or a full ISO timestamp.`,
      );
      process.exit(1);
    }
    expiresAt = parsed.toISOString();
  }

  const { data, error } = await supabase
    .from("galleries")
    .update({ expires_at: expiresAt })
    .eq("slug", slug)
    .select("slug, title, expires_at")
    .maybeSingle();

  if (error) {
    console.error("Failed to update gallery:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(
    expiresAt
      ? `${data.slug} now expires at ${data.expires_at}`
      : `${data.slug} no longer expires.`,
  );

  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    console.log(
      "Note: that date is in the past, so this gallery is now immediately locked.",
    );
  }
}

async function setArchived(slug, archived) {
  if (!slug) {
    console.error(
      `Usage: npm run gallery:${archived ? "archive" : "unarchive"} -- <slug>`,
    );
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("galleries")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error(
      `Failed to ${archived ? "archive" : "unarchive"} gallery:`,
      error.message,
    );
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(
    archived
      ? `${slug} archived — no longer accessible, but not deleted.`
      : `${slug} unarchived — accessible again (subject to its expiration, if any).`,
  );
}

async function setPin(slug) {
  if (!slug) {
    console.error("Usage: npm run gallery:set-pin -- <slug>");
    process.exit(1);
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data, error } = await supabase
    .from("galleries")
    .update({ pin_hash: pinHash })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to set PIN:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Set new PIN for gallery "${data.slug}".`);
  console.log(`PIN: ${pin}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
}

async function setPassword(slug) {
  if (!slug) {
    console.error("Usage: npm run gallery:set-password -- <slug>");
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("galleries")
    .update({ password_hash: passwordHash })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to set password:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Set new password for gallery "${data.slug}".`);
  console.log(`Password: ${password}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
}

async function del(slug, opts) {
  if (!slug) {
    console.error(
      "Usage: npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    );
    process.exit(1);
  }

  const keepPhotos = opts.includes("--keep-photos");
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
      `This permanently deletes gallery "${slug}"${keepPhotos ? "" : " and all its R2 photos"}. Type the slug to confirm: `,
    );
    rl.close();
    if (answer.trim() !== slug) {
      console.error("Confirmation didn't match. Aborted.");
      process.exit(1);
    }
  }

  const { data, error } = await supabase
    .from("galleries")
    .delete()
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to delete gallery:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Deleted gallery "${slug}" from the database.`);

  if (keepPhotos) {
    console.log("Kept photos in R2 (--keep-photos was passed).");
    return;
  }

  try {
    const count = await deleteGalleryPhotos(slug);
    console.log(
      count > 0
        ? `Deleted ${count} photo(s) from R2.`
        : "No photos found in R2 for this gallery.",
    );
  } catch (err) {
    console.error("Warning: failed to delete R2 photos:", err.message);
    console.error(`You may need to manually clean up galleries/${slug}/ in R2.`);
  }
}

const [, , command, ...args] = process.argv;

if (command === "list") {
  await list();
} else if (command === "upload") {
  await upload(args[0], args[1]);
} else if (command === "create") {
  await create(args[0], args[1], args[2], args[3]);
} else if (command === "set") {
  await setExpiry(args[0], args[1]);
} else if (command === "archive") {
  await setArchived(args[0], true);
} else if (command === "unarchive") {
  await setArchived(args[0], false);
} else if (command === "set-pin") {
  await setPin(args[0]);
} else if (command === "set-password") {
  await setPassword(args[0]);
} else if (command === "delete") {
  await del(args[0], args.slice(1));
} else {
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      '  npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
      "  npm run gallery:upload -- <slug> <local-folder>",
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:set-pin -- <slug>",
      "  npm run gallery:set-password -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    ].join("\n"),
  );
  process.exit(1);
}
