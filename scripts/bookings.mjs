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

  // Locked bookings (mid-reschedule or mid-cancel) — normally restore to
  // booked. But if the swap this row belongs to already completed on a
  // different row (the "release the old row" step failed just once,
  // after a successful claim elsewhere), restoring would create two
  // booked rows sharing one booking_token — release this one instead.
  const { data: candidates, error: candidatesError } = await supabase
    .from("booking_slots")
    .select("id, session_type, start_time, booking_token")
    .eq("status", "pending")
    .not("booking_token", "is", null)
    .lt("pending_expires_at", now);

  if (candidatesError) {
    console.error("Failed to find locked bookings to restore:", candidatesError.message);
    process.exit(1);
  }

  let restoredCount = 0;
  let releasedDuplicateCount = 0;

  for (const slot of candidates ?? []) {
    const { data: conflict, error: conflictError } = await supabase
      .from("booking_slots")
      .select("id")
      .eq("booking_token", slot.booking_token)
      .eq("status", "booked")
      .maybeSingle();

    if (conflictError) {
      console.error(`Failed to check ${slot.id} for a conflicting booking:`, conflictError.message);
      continue;
    }

    if (conflict) {
      const { error: releaseDuplicateError } = await supabase
        .from("booking_slots")
        .update({
          status: "open",
          client_name: null,
          client_email: null,
          client_notes: null,
          booking_token: null,
          deposit_payment_intent_id: null,
          pending_expires_at: null,
        })
        .eq("id", slot.id)
        .eq("status", "pending");
      if (releaseDuplicateError) {
        console.error(
          `Failed to release stale duplicate ${slot.id}:`,
          releaseDuplicateError.message,
        );
        continue;
      }
      console.log(
        `Released stale duplicate ${slot.id} (${slot.session_type}, ${slot.start_time}) — already booked elsewhere under this token`,
      );
      releasedDuplicateCount++;
      continue;
    }

    const { error: restoreError } = await supabase
      .from("booking_slots")
      .update({ status: "booked", pending_expires_at: null })
      .eq("id", slot.id)
      .eq("status", "pending");
    if (restoreError) {
      console.error(`Failed to restore ${slot.id}:`, restoreError.message);
      continue;
    }
    console.log(`Restored ${slot.id} (${slot.session_type}, ${slot.start_time}) to booked`);
    restoredCount++;
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

  const total = restoredCount + releasedDuplicateCount + (released?.length ?? 0);
  if (total === 0) {
    console.log("No stuck pending slots found.");
    return;
  }
  console.log(
    `Restored ${restoredCount}, released ${releasedDuplicateCount} duplicate(s), released ${released?.length ?? 0} hold(s).`,
  );
}

const [, , command] = process.argv;

if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage:\n  npm run bookings:sweep-pending");
  process.exit(1);
}
