// Show or apply the R2 bucket's CORS policy.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run r2:cors:show
//   npm run r2:cors:apply -- [extra-origin ...]
//
// Why this exists: the client gallery's "Download all" / "Download
// favorites" buttons build a single .zip in the visitor's browser by
// fetch()ing each photo/video from its signed R2 URL. Plain <img>/<video>
// tags don't need CORS, but fetch() does — without a rule allowing GET
// from the site's origin, the zip download fails.
//
// `apply` is non-destructive to unrelated rules: R2's PutBucketCors
// replaces the whole policy, so this reads the current policy first, drops
// only rules that already cover one of our origins (i.e. a previous run of
// this script), and appends the fresh rule. Extra origins (e.g. a Vercel
// preview URL) can be passed as arguments.
//
// Credentials: bucket settings like CORS need an R2 API token with
// "Admin Read & Write" permission — the site's normal token is scoped to
// objects only and gets AccessDenied here. Put an admin token's keys in
// .env.local as R2_ADMIN_ACCESS_KEY_ID / R2_ADMIN_SECRET_ACCESS_KEY; the
// script falls back to the regular R2_* keys if those aren't set.

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm scripts (r2:cors:*), which load .env.local automatically.`,
    );
    process.exit(1);
  }
  return value;
}

const DEFAULT_ORIGINS = [
  "https://zkjfilms.com",
  "https://www.zkjfilms.com",
  "http://localhost:3000",
];

const client = new S3Client({
  region: "auto",
  endpoint: requireEnv("R2_ENDPOINT"),
  credentials: process.env.R2_ADMIN_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.R2_ADMIN_ACCESS_KEY_ID,
        secretAccessKey: requireEnv("R2_ADMIN_SECRET_ACCESS_KEY"),
      }
    : {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
});
const Bucket = requireEnv("R2_BUCKET_NAME");

async function getRules() {
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket }));
    return res.CORSRules ?? [];
  } catch (err) {
    // No policy set yet — S3 reports that as an error rather than [].
    if (err?.name === "NoSuchCORSConfiguration" || err?.Code === "NoSuchCORSConfiguration") {
      return [];
    }
    throw err;
  }
}

async function show() {
  const rules = await getRules();
  if (rules.length === 0) {
    console.log(`No CORS policy on bucket "${Bucket}".`);
    return;
  }
  console.log(JSON.stringify(rules, null, 2));
}

async function apply(extraOrigins) {
  const origins = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins])];
  const existing = await getRules();
  const kept = existing.filter(
    (rule) => !(rule.AllowedOrigins ?? []).some((o) => origins.includes(o)),
  );

  const rules = [
    ...kept,
    {
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["Content-Length", "Content-Type"],
      MaxAgeSeconds: 3600,
    },
  ];

  await client.send(
    new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }),
  );
  console.log(
    `Applied CORS policy to "${Bucket}" (${kept.length} unrelated rule(s) kept):`,
  );
  console.log(JSON.stringify(rules, null, 2));
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "show") {
    await show();
  } else if (command === "apply") {
    await apply(args);
  } else {
    console.error("Usage: r2-cors.mjs <show|apply> [extra-origin ...]");
    process.exit(1);
  }
} catch (err) {
  if (err?.name === "AccessDenied" || err?.Code === "AccessDenied") {
    console.error(
      `Access denied reading/writing bucket settings on "${Bucket}".\n` +
        `This needs an R2 API token with "Admin Read & Write" permission.\n` +
        `Create one in Cloudflare → R2 → Manage API tokens, then add its keys to .env.local as\n` +
        `R2_ADMIN_ACCESS_KEY_ID and R2_ADMIN_SECRET_ACCESS_KEY and re-run.`,
    );
    process.exit(1);
  }
  throw err;
}
