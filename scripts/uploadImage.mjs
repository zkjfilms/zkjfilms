// Upload a local image file to the public R2 bucket used for site
// marketing/portfolio photos (see lib/media.ts) and print its public URL.
//
// Usage (via the npm script — loads .env.local automatically):
//   npm run image:upload -- ./path/to/photo.jpg [destination-key]
//
// destination-key defaults to the file's own name (e.g. hero.jpg). Pass one
// to nest it under a prefix, e.g. `npm run image:upload -- ./photo.jpg
// portraits/river-session-01.jpg`. Uploading to a key that already exists
// overwrites it.
//
// This bucket ("zkjfilms-public") is separate from the private client-
// gallery bucket (lib/r2.ts, "zk-client-galleries") and has R2's Public
// Development URL enabled, so anything uploaded here is immediately and
// permanently public — never point this script at client photos.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Keep in sync with lib/media.ts — see that file's comment for why this
// can't just be imported (this script runs as plain Node, not through
// Next/TypeScript).
const PUBLIC_IMAGES_BASE_URL = "https://pub-a78d2319f08941ff9a3249390ab8f644.r2.dev";

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via \`npm run image:upload\`, which loads .env.local automatically.`,
    );
    process.exit(1);
  }
  return value;
}

const [, , filePath, destinationKeyArg] = process.argv;
if (!filePath) {
  console.error("Usage: npm run image:upload -- <local-file-path> [destination-key]");
  process.exit(1);
}

const ext = extname(filePath).toLowerCase();
const contentType = CONTENT_TYPES[ext];
if (!contentType) {
  console.error(`Unrecognized image extension "${ext}". Supported: ${Object.keys(CONTENT_TYPES).join(", ")}`);
  process.exit(1);
}

const key = destinationKeyArg || basename(filePath);
const body = readFileSync(filePath);

const client = new S3Client({
  region: "auto",
  endpoint: requireEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: requireEnv("R2_PUBLIC_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_PUBLIC_SECRET_ACCESS_KEY"),
  },
});

await client.send(
  new PutObjectCommand({
    Bucket: requireEnv("R2_PUBLIC_BUCKET_NAME"),
    Key: key,
    Body: body,
    ContentType: contentType,
  }),
);

console.log(`Uploaded ${filePath} -> ${key}`);
console.log(`${PUBLIC_IMAGES_BASE_URL}/${key}`);
