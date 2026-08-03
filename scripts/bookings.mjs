// Safety net for booking_slots stuck in 'pending' past their hold
// window — normally released by the checkout.session.expired webhook
// (see lib/bookingWebhooks.ts), this covers the case where that webhook
// delivery was ever missed.
//
// Usage (via the npm script — already loads .env.local):
//   npm run bookings:sweep-pending

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm script (bookings:sweep-pending), which loads .env.local automatically.`,
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

async function sweepPending() {
  const { data, error } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      pending_expires_at: null,
    })
    .eq("status", "pending")
    .lt("pending_expires_at", new Date().toISOString())
    .select("id, session_type, start_time");

  if (error) {
    console.error("Failed to sweep pending slots:", error.message);
    process.exit(1);
  }

  if (!data.length) {
    console.log("No stuck pending slots found.");
    return;
  }

  for (const slot of data) {
    console.log(`Released ${slot.id} (${slot.session_type}, ${slot.start_time})`);
  }
  console.log(`Released ${data.length} slot(s).`);
}

const [, , command] = process.argv;

if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage:\n  npm run bookings:sweep-pending");
  process.exit(1);
}
