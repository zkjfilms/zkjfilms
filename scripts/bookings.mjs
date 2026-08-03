// Safety net for booking_slots stuck in 'pending' past their hold
// window — normally released by the checkout.session.expired webhook
// (see lib/bookingWebhooks.ts), this covers the case where that webhook
// delivery was ever missed.
//
// Two kinds of stuck row, told apart by booking_token: a locked real
// booking (mid-reschedule or mid-cancel) has one and is restored to
// 'booked'; an abandoned new-booking/target hold has none and is
// released back to 'open'.
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
  const now = new Date().toISOString();

  // Locked bookings (mid-reschedule or mid-cancel) — restore to booked.
  // Client info is still intact on these rows; never release them.
  const { data: restored, error: restoreError } = await supabase
    .from("booking_slots")
    .update({ status: "booked", pending_expires_at: null })
    .eq("status", "pending")
    .not("booking_token", "is", null)
    .lt("pending_expires_at", now)
    .select("id, session_type, start_time");

  if (restoreError) {
    console.error("Failed to restore stuck locked bookings:", restoreError.message);
    process.exit(1);
  }

  for (const slot of restored ?? []) {
    console.log(`Restored ${slot.id} (${slot.session_type}, ${slot.start_time}) to booked`);
  }

  // Abandoned new-booking/target holds — release back to open.
  const { data: released, error: releaseError } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      pending_expires_at: null,
    })
    .eq("status", "pending")
    .is("booking_token", null)
    .lt("pending_expires_at", now)
    .select("id, session_type, start_time");

  if (releaseError) {
    console.error("Failed to sweep pending slots:", releaseError.message);
    process.exit(1);
  }

  for (const slot of released ?? []) {
    console.log(`Released ${slot.id} (${slot.session_type}, ${slot.start_time})`);
  }

  const total = (restored?.length ?? 0) + (released?.length ?? 0);
  if (total === 0) {
    console.log("No stuck pending slots found.");
    return;
  }
  console.log(`Restored ${restored?.length ?? 0}, released ${released?.length ?? 0}.`);
}

const [, , command] = process.argv;

if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage:\n  npm run bookings:sweep-pending");
  process.exit(1);
}
