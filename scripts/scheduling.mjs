// scripts/scheduling.mjs
// Safety net for `bookings` rows stuck in 'pending' past
// pending_expires_at — normally released by the
// checkout.session.expired webhook (see lib/bookingsWebhook.ts), this
// covers the case where that webhook delivery was ever missed.
//
// Usage (via the npm script — already loads .env.local):
//   npm run scheduling:sweep-pending

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Run via the npm script, which loads .env.local automatically.`);
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv("SUPABASE_URL").replace(/\/rest\/v1\/?$/, ""),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function sweepPending() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("pending_expires_at", now)
    .select("id");

  if (error) {
    console.error("Sweep failed:", error.message);
    process.exit(1);
  }
  console.log(`Canceled ${data?.length ?? 0} stuck pending booking(s).`);
}

const command = process.argv[2];
if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage: node scripts/scheduling.mjs sweep-pending");
  process.exit(1);
}
