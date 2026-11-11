// Manage client galleries — expiration, archiving, deletion — without
// touching SQL.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run gallery:list
//   npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]
//   npm run gallery:upload -- <slug> <local-folder> | <file> [file2...] [--no-zip]
//   npm run gallery:set-expiry -- <slug> <date|none>
//   npm run gallery:archive -- <slug>
//   npm run gallery:unarchive -- <slug>
//   npm run gallery:set-pin -- <slug>
//   npm run gallery:set-password -- <slug>
//   npm run gallery:delete -- <slug> [--yes] [--keep-photos]
//   npm run gallery:remove-photo -- <slug> <filename> [filename2...] [--yes]
//   npm run gallery:previews -- <slug> [--from <local-folder>] [--force]
//   npm run gallery:zip -- <slug> [--from <local-folder>] [--force]
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
//
// remove-photo deletes one or more individual photos from a gallery,
// leaving the gallery and its other photos alone — for the "wrong photo
// got uploaded" case where a full gallery:delete would be overkill.
// Filenames are matched against what's actually in R2 (not assumed), so
// a typo'd filename is reported as skipped rather than silently doing
// nothing. Interactive y/n by default; pass --yes to skip the prompt.
//
// Previews: upload also writes two downsized WebP copies of each photo to
// gallery-previews/<slug>/{thumb,large}/<filename>.webp — the gallery grid
// and lightbox load those instead of the full-res originals (downloads and
// zips still use the originals). `previews` backfills them for photos
// uploaded before this existed, or that failed to generate; --force
// regenerates all of them. By default it re-downloads each original from
// R2; --from <folder> reads same-named files from a local folder instead
// (much faster on a slow connection — only the small previews upload),
// falling back to R2 for any photo not found there. lib/r2.ts
// galleryPreviewKeys() must match previewKeys() below.
//
// Full-gallery zip: after uploading, upload also builds one .zip of every
// original in the gallery and stores it at
// gallery-zips/<slug>/<fingerprint>.zip — "Download all" serves that as a
// normal browser download instead of zipping in the visitor's browser. The
// fingerprint is a hash of every original's filename + ETag (see
// galleryFingerprint, which must match lib/r2.ts), so once the gallery
// changes the old zip no longer matches and the site falls back to the
// in-browser zip until it's rebuilt with `gallery:zip`. Pass --no-zip to
// upload when adding photos in several batches, then run gallery:zip once
// at the end. Files are read from the local folder when they match what's
// in R2 (same MD5), otherwise streamed from R2.

import { createHash, randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createReadStream, openAsBlob, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import { downloadZip } from "client-zip";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import {
  S3Client,
  GetObjectCommand,
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
// lib/galleryCredentials.ts is a hand-synced TypeScript twin of this
// word list and generatePassword()/generatePin() — edit one, check the
// other.
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
// Sanity cap against accidentally pointing this at a folder of full-res
// RAW/TIFF exports (or the wrong folder entirely) — not a hard product limit.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const UPLOAD_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

// Grid tiles are at most ~400 CSS px wide (2 columns on phones), so 800px
// covers 2x screens; the lightbox fills the viewport, so 2400px stays
// sharp on a large retina display while being a fraction of the original.
const PREVIEW_SIZES = {
  thumb: { width: 800, quality: 72 },
  large: { width: 2400, quality: 82 },
};

// Animated GIFs would lose their animation as a WebP still, and videos
// have no image to resize — both keep using the original in the UI.
const PREVIEWABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

function previewKeys(slug, filename) {
  return {
    thumb: `gallery-previews/${slug}/thumb/${filename}.webp`,
    large: `gallery-previews/${slug}/large/${filename}.webp`,
  };
}

async function generatePreviews(client, bucket, slug, filename, input) {
  const keys = previewKeys(slug, filename);
  for (const [size, { width, quality }] of Object.entries(PREVIEW_SIZES)) {
    const body = await sharp(input)
      .rotate() // apply EXIF orientation before metadata is stripped
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: keys[size],
        Body: body,
        ContentType: "image/webp",
      }),
    );
  }
}

async function listAllObjects(client, bucket, prefix) {
  const objects = [];
  let ContinuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && !obj.Key.endsWith("/")) objects.push(obj);
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

async function listAllKeys(client, bucket, prefix) {
  return (await listAllObjects(client, bucket, prefix)).map((obj) => obj.Key);
}

// Must match galleryFingerprint() in lib/r2.ts exactly.
function galleryFingerprint(objects) {
  const lines = objects
    .map((o) => `${o.filename}\t${o.etag.replaceAll('"', "")}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

function md5File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

function localFilesIn(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) files.set(entry.name, join(dir, entry.name));
  }
  return files;
}

function formatMB(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

// Builds the full-gallery zip (see the header comment) and uploads it in
// parts, streaming — the zip never exists on disk or fully in memory.
// localFiles maps filename -> local path for files that may be read
// locally instead of downloaded from R2.
async function buildFullZip(client, bucket, slug, { localFiles = new Map(), force = false } = {}) {
  const prefix = `galleries/${slug}/`;
  const zipPrefix = `gallery-zips/${slug}/`;

  const [originals, existingZips] = await Promise.all([
    listAllObjects(client, bucket, prefix),
    listAllKeys(client, bucket, zipPrefix),
  ]);
  if (originals.length === 0) {
    console.log(`No files in "${slug}" to zip.`);
    return;
  }

  const files = originals.map((obj) => ({
    filename: obj.Key.slice(prefix.length),
    key: obj.Key,
    etag: obj.ETag ?? "",
    size: obj.Size ?? 0,
    lastModified: obj.LastModified,
  }));
  const zipKey = `${zipPrefix}${galleryFingerprint(files)}.zip`;

  if (existingZips.includes(zipKey) && !force) {
    console.log(`Full-gallery zip for "${slug}" is already up to date.`);
    return;
  }

  // Use a local file only if it's byte-identical to what's in R2 — a
  // single-part upload's ETag is the file's MD5. (Multipart ETags contain
  // a "-" and aren't an MD5, so those always come from R2.)
  let localCount = 0;
  for (const file of files) {
    const path = localFiles.get(file.filename);
    const etag = file.etag.replaceAll('"', "");
    if (
      path &&
      !etag.includes("-") &&
      statSync(path, { throwIfNoEntry: false })?.size === file.size &&
      (await md5File(path)) === etag
    ) {
      file.localPath = path;
      localCount += 1;
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `Building full-gallery zip for "${slug}": ${files.length} file(s), ${formatMB(totalBytes)} ` +
      `(${localCount} from local disk, ${files.length - localCount} from R2)...`,
  );

  async function* entries() {
    for (const file of files) {
      let input;
      if (file.localPath) {
        input = await openAsBlob(file.localPath);
      } else {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.key }));
        input = res.Body.transformToWebStream();
      }
      yield { name: file.filename, input, lastModified: file.lastModified, size: file.size };
    }
  }

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: zipKey,
      Body: Readable.fromWeb(downloadZip(entries()).body),
      ContentType: "application/zip",
    },
    partSize: 64 * 1024 * 1024,
    queueSize: 4,
  });

  let lastLogged = 0;
  upload.on("httpUploadProgress", ({ loaded = 0 }) => {
    const pct = Math.min(100, Math.floor((loaded / totalBytes) * 100));
    if (pct >= lastLogged + 10) {
      lastLogged = pct - (pct % 10);
      console.log(`  zip upload ${lastLogged}% (${formatMB(loaded)})`);
    }
  });
  await upload.done();

  // Older zips are now stale — the site would never serve them anyway.
  const stale = existingZips.filter((key) => key !== zipKey);
  if (stale.length > 0) await deleteKeys(client, bucket, stale);

  console.log(`Full-gallery zip uploaded (${formatMB(totalBytes)}).`);
}

async function zipCommand(slug, rest) {
  const force = rest.includes("--force");
  const fromIndex = rest.indexOf("--from");
  const fromDir = fromIndex >= 0 ? rest[fromIndex + 1] : null;
  if (!slug || (fromIndex >= 0 && !fromDir)) {
    console.error("Usage: npm run gallery:zip -- <slug> [--from <local-folder>] [--force]");
    process.exit(1);
  }
  if (fromDir && !statSync(fromDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`"${fromDir}" is not a folder.`);
    process.exit(1);
  }
  await buildFullZip(getR2Client(), requireEnv("R2_BUCKET_NAME"), slug, {
    localFiles: fromDir ? localFilesIn(fromDir) : new Map(),
    force,
  });
}

async function deleteKeys(client, bucket, keys) {
  // DeleteObjects takes at most 1000 keys per request.
  for (let i = 0; i < keys.length; i += 1000) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}

async function backfillPreviews(slug, rest) {
  const force = rest.includes("--force");
  const fromIndex = rest.indexOf("--from");
  const fromDir = fromIndex >= 0 ? rest[fromIndex + 1] : null;
  if (!slug || (fromIndex >= 0 && !fromDir)) {
    console.error("Usage: npm run gallery:previews -- <slug> [--from <local-folder>] [--force]");
    process.exit(1);
  }
  if (fromDir && !statSync(fromDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`"${fromDir}" is not a folder.`);
    process.exit(1);
  }

  const client = getR2Client();
  const bucket = requireEnv("R2_BUCKET_NAME");
  const prefix = `galleries/${slug}/`;

  const [originals, existing] = await Promise.all([
    listAllKeys(client, bucket, prefix),
    listAllKeys(client, bucket, `gallery-previews/${slug}/`).then((k) => new Set(k)),
  ]);

  const todo = originals
    .map((key) => key.slice(prefix.length))
    .filter((name) => name && !name.includes("/"))
    .filter((name) => PREVIEWABLE_EXTENSIONS.has(extname(name).toLowerCase()))
    .filter((name) => {
      if (force) return true;
      const keys = previewKeys(slug, name);
      return !existing.has(keys.thumb) || !existing.has(keys.large);
    });

  if (todo.length === 0) {
    console.log(`All photos in "${slug}" already have previews.`);
    return;
  }

  console.log(`Generating previews for ${todo.length} photo(s) in "${slug}"...`);
  let done = 0;
  let failed = 0;
  let next = 0;

  // A few at a time — each worker downloads a full-res original, so this
  // is mostly network-bound.
  async function worker() {
    while (next < todo.length) {
      const name = todo[next++];
      try {
        const localPath = fromDir ? join(fromDir, name) : null;
        let input;
        if (localPath && statSync(localPath, { throwIfNoEntry: false })?.isFile()) {
          input = readFileSync(localPath);
        } else {
          if (fromDir) console.log(`  "${name}" not in ${fromDir}, downloading from R2...`);
          const res = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: prefix + name }),
          );
          input = Buffer.from(await res.Body.transformToByteArray());
        }
        await generatePreviews(client, bucket, slug, name, input);
        done += 1;
        console.log(`[${done + failed}/${todo.length}] ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`[${done + failed}/${todo.length}] Failed on "${name}":`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  console.log(`\nGenerated previews for ${done} photo(s)${failed ? `, ${failed} failed` : ""}.`);
  if (failed > 0) process.exit(1);
}

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

async function upload(slug, args) {
  const noZip = (args ?? []).includes("--no-zip");
  const paths = (args ?? []).filter((arg) => arg !== "--no-zip");
  if (!slug || paths.length === 0) {
    console.error("Usage: npm run gallery:upload -- <slug> <local-folder> | <file> [file2...] [--no-zip]");
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

  // Each given path can be a folder (every file inside it is included,
  // same as the original folder-only behavior) or a specific file
  // (uploaded on its own) — mixing both in one call is fine too, e.g.
  // `gallery:upload -- slug ./folder ./one-more-file.jpg`. Resolved up
  // front into a flat list so the upload loop below doesn't need to care
  // which kind of path each file came from.
  const filesToConsider = [];
  for (const p of paths) {
    let stat;
    try {
      stat = statSync(p);
    } catch (err) {
      console.error(`Skipping "${p}": ${err.message}`);
      continue;
    }

    if (stat.isDirectory()) {
      let entries;
      try {
        entries = readdirSync(p, { withFileTypes: true });
      } catch (err) {
        console.error(`Failed to read folder "${p}":`, err.message);
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile()) {
          filesToConsider.push({ name: entry.name, filePath: join(p, entry.name) });
        }
      }
    } else if (stat.isFile()) {
      filesToConsider.push({ name: basename(p), filePath: p });
    } else {
      console.error(`Skipping "${p}": not a file or folder.`);
    }
  }

  const client = getR2Client();
  const bucket = requireEnv("R2_BUCKET_NAME");

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const { name, filePath } of filesToConsider) {
    if (name.startsWith(".")) {
      console.log(`Skipping "${name}" (dotfile — likely a sidecar/system file, not a photo).`);
      skipped += 1;
      continue;
    }

    const ext = extname(name).toLowerCase();
    const contentType = UPLOAD_CONTENT_TYPES[ext];

    if (!contentType) {
      console.log(`Skipping "${name}" (not a recognized image type).`);
      skipped += 1;
      continue;
    }

    const { size } = statSync(filePath);
    if (size > MAX_UPLOAD_BYTES) {
      console.log(
        `Skipping "${name}" (${(size / (1024 * 1024)).toFixed(1)}MB exceeds ${
          MAX_UPLOAD_BYTES / (1024 * 1024)
        }MB sanity limit).`,
      );
      skipped += 1;
      continue;
    }

    const key = `galleries/${slug}/${name}`;

    try {
      const body = readFileSync(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      console.log(`Uploaded ${name} -> ${key}`);
      uploaded += 1;

      if (PREVIEWABLE_EXTENSIONS.has(ext)) {
        try {
          await generatePreviews(client, bucket, slug, name, body);
        } catch (err) {
          // The original is already up — the gallery still works, it just
          // shows the full-res file for this photo until backfilled.
          console.error(
            `  Couldn't generate previews for "${name}" (${err.message}). Run gallery:previews -- ${slug} to retry.`,
          );
        }
      }
    } catch (err) {
      console.error(`Failed to upload "${name}":`, err.message);
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

  if (uploaded > 0) {
    if (noZip) {
      console.log(
        `Skipped the full-gallery zip (--no-zip). Run gallery:zip -- ${slug} --from <folder> once all photos are up.`,
      );
    } else {
      try {
        await buildFullZip(client, bucket, slug, {
          localFiles: new Map(filesToConsider.map((f) => [f.name, f.filePath])),
        });
      } catch (err) {
        // The photos are up — "Download all" just falls back to zipping in
        // the browser until this is retried.
        console.error(
          `Couldn't build the full-gallery zip (${err.message}). Retry with gallery:zip -- ${slug} --from <folder>.`,
        );
        failed += 1;
      }
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

  const [previews, zips] = await Promise.all([
    listAllKeys(client, bucket, `gallery-previews/${slug}/`),
    listAllKeys(client, bucket, `gallery-zips/${slug}/`),
  ]);
  await deleteKeys(client, bucket, [...keys, ...previews, ...zips]);

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

// Removes one or more individual photos from a gallery, keeping the
// gallery itself and its other photos intact. Filenames are matched
// against the actual R2 listing (not blindly turned into keys), so a
// typo'd or already-deleted filename is reported as skipped rather than
// silently doing nothing. Also cleans up any gallery_favorites rows for
// the removed photos, so a hearted-then-removed photo doesn't leave a
// stale favorite pointing at nothing.
async function removePhotos(slug, rest) {
  const filenames = rest.filter((arg) => !arg.startsWith("-"));
  const autoConfirm = rest.includes("--yes") || rest.includes("-y");

  if (!slug || filenames.length === 0) {
    console.error(
      "Usage: npm run gallery:remove-photo -- <slug> <filename> [filename2...] [--yes]",
    );
    process.exit(1);
  }

  const { data: gallery, error: lookupError } = await supabase
    .from("galleries")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to look up gallery:", lookupError.message);
    process.exit(1);
  }

  if (!gallery) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  const client = getR2Client();
  const bucket = requireEnv("R2_BUCKET_NAME");
  const prefix = `galleries/${slug}/`;

  const listing = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const existingByFilename = new Map(
    (listing.Contents ?? [])
      .filter((obj) => typeof obj.Key === "string")
      .map((obj) => [obj.Key.slice(prefix.length), obj.Key]),
  );

  const matchedKeys = [];
  const notFound = [];
  for (const filename of filenames) {
    const key = existingByFilename.get(filename);
    if (key) {
      matchedKeys.push(key);
    } else {
      notFound.push(filename);
    }
  }

  if (notFound.length > 0) {
    console.log(`Not found in "${slug}", skipping: ${notFound.join(", ")}`);
  }

  if (matchedKeys.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  if (!autoConfirm) {
    if (!process.stdin.isTTY) {
      console.error(
        "Refusing to delete without confirmation in a non-interactive shell. Pass --yes to skip the prompt.",
      );
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Delete ${matchedKeys.length} photo(s) from "${slug}": ${filenames.filter((f) => existingByFilename.has(f)).join(", ")}? (y/N) `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.error("Aborted.");
      process.exit(1);
    }
  }

  // Preview keys may not exist (videos, GIFs, pre-preview uploads) —
  // deleting a missing key is a no-op in S3/R2, so no need to check first.
  const matchedPreviewKeys = matchedKeys.flatMap((key) =>
    Object.values(previewKeys(slug, key.slice(prefix.length))),
  );
  // The full-gallery zip still contains the removed photo(s) — delete it
  // (the site already ignores it, since the gallery's fingerprint changed).
  const staleZips = await listAllKeys(client, bucket, `gallery-zips/${slug}/`);
  await deleteKeys(client, bucket, [...matchedKeys, ...matchedPreviewKeys, ...staleZips]);

  const { error: favoritesError } = await supabase
    .from("gallery_favorites")
    .delete()
    .eq("gallery_id", gallery.id)
    .in("image_key", matchedKeys);

  if (favoritesError) {
    console.error("Warning: failed to clean up gallery_favorites:", favoritesError.message);
  }

  console.log(`Deleted ${matchedKeys.length} photo(s) from "${slug}".`);
  if (staleZips.length > 0) {
    console.log(
      `Removed the out-of-date full-gallery zip. Rebuild it with: npm run gallery:zip -- ${slug} --from <folder>`,
    );
  }
}

const [, , command, ...args] = process.argv;

if (command === "list") {
  await list();
} else if (command === "upload") {
  await upload(args[0], args.slice(1));
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
} else if (command === "remove-photo") {
  await removePhotos(args[0], args.slice(1));
} else if (command === "previews") {
  await backfillPreviews(args[0], args.slice(1));
} else if (command === "zip") {
  await zipCommand(args[0], args.slice(1));
} else {
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      '  npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
      "  npm run gallery:upload -- <slug> <local-folder> | <file> [file2...] [--no-zip]",
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:set-pin -- <slug>",
      "  npm run gallery:set-password -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
      "  npm run gallery:remove-photo -- <slug> <filename> [filename2...] [--yes]",
      "  npm run gallery:previews -- <slug> [--from <local-folder>] [--force]",
      "  npm run gallery:zip -- <slug> [--from <local-folder>] [--force]",
    ].join("\n"),
  );
  process.exit(1);
}
