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
