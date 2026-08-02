// Manage client galleries — expiration, archiving, deletion — without
// touching SQL.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run gallery:list
//   npm run gallery:set-expiry -- <slug> <date|none>
//   npm run gallery:archive -- <slug>
//   npm run gallery:unarchive -- <slug>
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

import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
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
} else if (command === "set") {
  await setExpiry(args[0], args[1]);
} else if (command === "archive") {
  await setArchived(args[0], true);
} else if (command === "unarchive") {
  await setArchived(args[0], false);
} else if (command === "delete") {
  await del(args[0], args.slice(1));
} else {
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    ].join("\n"),
  );
  process.exit(1);
}
