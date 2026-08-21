// Upload a local image file to the public R2 bucket used for site
// marketing/portfolio photos (see lib/media.ts) and print its public URL
// plus a ready-to-paste MasonryPhoto snippet (real dimensions via sharp).
//
// Usage (via the npm script — loads .env.local automatically):
//   npm run image:upload -- ./path/to/photo.jpg [destination-key]
//
// destination-key defaults to the file's own name (e.g. hero.jpg). Pass one
// to nest it under a prefix, e.g. `npm run image:upload -- ./photo.jpg
// portraits/river-session-01.jpg`. Uploading to a key that already exists
// overwrites it — if something is already there, this script downloads it
// to ./uploads-backup/ first (gitignored, local only) so an overwrite is
// never a one-way door.
//
// This bucket ("zkjfilms-public") is separate from the private client-
// gallery bucket (lib/r2.ts, "zk-client-galleries") and has R2's Public
// Development URL enabled, so anything uploaded here is immediately and
// permanently public — never point this script at client photos.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const BACKUP_DIR = "uploads-backup";

// Downloads the object currently at `key` (if any) to BACKUP_DIR before it
// gets overwritten. Returns the local backup path, or null if there was
// nothing at that key yet (a fresh key is not an error — just nothing to
// back up).
async function backupExistingObject(client, bucket, key) {
  let response;
  try {
    response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (err.name === "NoSuchKey") return null;
    throw err;
  }

  const bytes = await response.Body.transformToByteArray();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const safeName = key.replace(/\//g, "__");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(BACKUP_DIR, `${safeName}.${timestamp}${extname(key)}`);
  writeFileSync(backupPath, Buffer.from(bytes));
  return backupPath;
}

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

// Alt text that trips this is generic enough it could describe almost any
// portrait — a sign the model (or a human) phoned it in rather than
// describing what's actually in the frame. Used as a last-resort check
// after the model has already been asked to self-critique its own draft.
const LAZY_ALT_TEXT_PATTERNS = [
  /\bimage of\b/i,
  /\bphoto(graph)? of\b/i,
  /\bpicture of\b/i,
  /\bstock photo\b/i,
  /\bprofessional headshot\b/i,
  /\bposing for( the)?( a)? camera\b/i,
  /\b(beautiful|stunning|amazing|wonderful|gorgeous|lovely)\b/i,
];

function isLazyAltText(altText) {
  const wordCount = altText.trim().split(/\s+/).length;
  if (wordCount < 8) return true;
  return LAZY_ALT_TEXT_PATTERNS.some((pattern) => pattern.test(altText));
}

const ALT_TEXT_DRAFT_PROMPT = `Write SEO alt text for this photo from a Columbia, Missouri portrait/headshot photography portfolio.

Describe only what's literally visible: pose, framing, clothing/styling, setting, and lighting. Be specific enough that this sentence couldn't just as well describe a different headshot from the same shoot.

Bad (too generic): "A woman smiling for a professional headshot."
Good (specific): "Woman in a navy blazer leaning against a brick wall, laughing mid-turn with soft window light across one side of her face."

Rules:
- One sentence, roughly 12-25 words.
- Never use: "image of", "photo of", "picture of", "photograph of", "stock photo", "professional headshot", "posing for the camera".
- Never use vague superlatives: "beautiful", "stunning", "amazing", "wonderful", "gorgeous", "lovely".
- Do not invent details you can't actually see in the image.`;

// Two calls, not one: the first drafts, the second asks the model to judge
// its own draft against a concrete "could this describe a different photo
// in the shoot?" test and rewrite if it fails. Plain instructions alone
// tend to still produce safely generic text; an explicit self-critique pass
// catches that a lot more reliably than a longer prompt would on its own.
async function generateAltText(imageBuffer, mediaType, anthropicApiKey) {
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const imageBlock = {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: imageBuffer.toString("base64") },
  };

  const draftResponse = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 200,
    messages: [
      { role: "user", content: [imageBlock, { type: "text", text: ALT_TEXT_DRAFT_PROMPT }] },
    ],
  });
  const draftBlock = draftResponse.content[0];
  if (draftBlock.type !== "text") {
    throw new Error("Unexpected response content type from Anthropic API.");
  }
  const draft = draftBlock.text.trim();

  const reviseResponse = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 200,
    messages: [
      { role: "user", content: [imageBlock, { type: "text", text: ALT_TEXT_DRAFT_PROMPT }] },
      { role: "assistant", content: draft },
      {
        role: "user",
        content:
          "Would a sighted person, reading only that sentence, be able to picture this exact photo and tell it apart from another headshot in the same shoot? If it's generic or could describe almost any portrait, rewrite it with more specific, concrete visual detail actually visible in the image. Reply with only the final alt text — no preamble, no quotes, no explanation.",
      },
    ],
  });
  const reviseBlock = reviseResponse.content[0];
  if (reviseBlock.type !== "text") {
    throw new Error("Unexpected response content type from Anthropic API.");
  }
  const altText = reviseBlock.text.trim();

  if (isLazyAltText(altText)) {
    console.warn(
      "\n⚠ Suggested alt text still reads as generic after review — read it carefully and rewrite by hand before pasting if it doesn't actually distinguish this photo.",
    );
  }

  return altText;
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

const { width, height } = await sharp(body).metadata();
if (!width || !height) {
  console.error("Could not read image dimensions — the file may be corrupt or an unsupported format for sharp.");
  process.exit(1);
}

// Validate before the R2 upload — a missing key here should never let the
// script upload to the permanently-public bucket and only fail afterward.
const anthropicApiKey = requireEnv("ANTHROPIC_API_KEY");

const client = new S3Client({
  region: "auto",
  endpoint: requireEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: requireEnv("R2_PUBLIC_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_PUBLIC_SECRET_ACCESS_KEY"),
  },
});

const bucket = requireEnv("R2_PUBLIC_BUCKET_NAME");
const backupPath = await backupExistingObject(client, bucket, key);

await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }),
);

const altText = await generateAltText(body, contentType, anthropicApiKey);

console.log(`Uploaded ${filePath} -> ${key}`);
if (backupPath) {
  console.log(`Backed up the previous "${key}" to ${backupPath} before overwriting.`);
}
console.log(`${PUBLIC_IMAGES_BASE_URL}/${key}`);
console.log(`Suggested alt text: ${altText}`);
console.log("");
console.log("Paste into a MasonryPhoto list (lib/masonryPhotos.ts):");
console.log(
  `{ key: "${key}", width: ${width}, height: ${height}, alt: ${JSON.stringify(altText)}, src: publicImageUrl("${key}") },`,
);
