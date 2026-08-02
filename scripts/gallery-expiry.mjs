// Set, clear, or list gallery expiration dates without touching SQL.
//
// Usage (via npm scripts — these already load .env.local):
//   npm run gallery:list
//   npm run gallery:set-expiry -- <slug> <date|none>
//
// <date> accepts anything JS's Date constructor understands, e.g.
// 2026-12-31 or 2026-12-31T23:59:59Z. Use "none" (or "clear") to remove
// an expiration so the gallery never expires.

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm scripts (gallery:list / gallery:set-expiry), which load .env.local automatically.`,
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

async function list() {
  const { data, error } = await supabase
    .from("galleries")
    .select("slug, title, expires_at")
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
    const status = !gallery.expires_at
      ? "never expires"
      : new Date(gallery.expires_at).getTime() < Date.now()
        ? `EXPIRED (${gallery.expires_at})`
        : `expires ${gallery.expires_at}`;
    console.log(`${gallery.slug.padEnd(24)} ${gallery.title.padEnd(32)} ${status}`);
  }
}

async function set(slug, dateArg) {
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

const [, , command, ...args] = process.argv;

if (command === "list") {
  await list();
} else if (command === "set") {
  await set(args[0], args[1]);
} else {
  console.error(
    "Usage:\n  npm run gallery:list\n  npm run gallery:set-expiry -- <slug> <date|none>",
  );
  process.exit(1);
}
