import { getSupabaseClient } from "@/lib/supabase";
import { createRescheduleFeeCheckoutSession } from "@/lib/stripe";
import {
  hoursUntil,
  RESCHEDULE_NOTICE_HOURS,
  RESCHEDULE_FEE_CENTS,
  PENDING_HOLD_MINUTES,
} from "@/lib/booking";
import { sendRescheduleConfirmedEmail } from "@/lib/email";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const targetSlotId =
    typeof rawBody === "object" &&
    rawBody !== null &&
    "targetSlotId" in rawBody
      ? (rawBody as { targetSlotId: unknown }).targetSlotId
      : null;

  if (typeof targetSlotId !== "string" || !targetSlotId) {
    return Response.json(
      { error: "A target slot is required." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  const { data: current, error: currentError } = await supabase
    .from("booking_slots")
    .select(
      "id, start_time, session_type, client_name, client_email, client_notes, deposit_payment_intent_id",
    )
    .eq("booking_token", token)
    .eq("status", "booked")
    .maybeSingle();

  if (currentError) {
    console.error("Supabase current-booking lookup failed:", currentError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!current) {
    return Response.json(
      { error: "This link doesn't match an active booking." },
      { status: 404 },
    );
  }

  const { data: target, error: targetError } = await supabase
    .from("booking_slots")
    .select("id, session_type")
    .eq("id", targetSlotId)
    .eq("status", "open")
    .maybeSingle();

  if (targetError) {
    console.error("Supabase target-slot lookup failed:", targetError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!target) {
    return Response.json(
      { error: "That time is no longer available." },
      { status: 409 },
    );
  }

  if (target.session_type !== current.session_type) {
    return Response.json(
      {
        error: `You can only reschedule into another ${current.session_type} slot.`,
      },
      { status: 400 },
    );
  }

  const hoursNotice = hoursUntil(current.start_time);

  // Lock the current booking before touching any target slot, so a
  // second concurrent request against the same booking_token can't
  // also proceed — its own lock attempt below finds status is no
  // longer 'booked' and fails fast instead of racing to claim a
  // different target under the same token.
  const { data: locked, error: lockError } = await supabase
    .from("booking_slots")
    .update({ status: "pending", pending_expires_at: null })
    .eq("id", current.id)
    .eq("status", "booked")
    .select()
    .maybeSingle();

  if (lockError) {
    console.error("Failed to lock current booking for reschedule:", lockError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!locked) {
    return Response.json(
      { error: "This booking is already being modified. Please try again in a moment." },
      { status: 409 },
    );
  }

  if (hoursNotice >= RESCHEDULE_NOTICE_HOURS) {
    // Free path — swap immediately, race-safe on the target slot's
    // claim (same guard pattern as /api/book's original claim).
    const { data: claimed, error: claimError } = await supabase
      .from("booking_slots")
      .update({
        status: "booked",
        client_name: current.client_name,
        client_email: current.client_email,
        client_notes: current.client_notes,
        booking_token: token,
        deposit_payment_intent_id: current.deposit_payment_intent_id,
        refund_status: null,
        refund_amount_cents: null,
        booked_at: new Date().toISOString(),
      })
      .eq("id", target.id)
      .eq("status", "open")
      .select()
      .maybeSingle();

    if (claimError) {
      console.error("Failed to claim target slot for reschedule:", claimError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }

    if (!claimed) {
      await supabase
        .from("booking_slots")
        .update({ status: "booked", pending_expires_at: null })
        .eq("id", current.id)
        .eq("status", "pending");
      return Response.json(
        { error: "That time is no longer available." },
        { status: 409 },
      );
    }

    const { error: releaseError } = await supabase
      .from("booking_slots")
      .update({
        status: "open",
        client_name: null,
        client_email: null,
        client_notes: null,
        booked_at: null,
        booking_token: null,
        deposit_payment_intent_id: null,
      })
      .eq("id", current.id)
      .eq("status", "pending");

    if (releaseError) {
      console.error("Failed to release original slot after reschedule:", releaseError);
    }

    const emailResult = await sendRescheduleConfirmedEmail(claimed);
    if (!emailResult.ok) {
      console.error("Failed to send reschedule confirmation email:", emailResult.error);
    }

    return Response.json({ ok: true, freeSwap: true, slot: claimed });
  }

  // <72h — hold the target slot and charge the $50 fee via Stripe
  // Checkout before the swap takes effect (finished by the webhook).
  const { data: held, error: holdError } = await supabase
    .from("booking_slots")
    .update({
      status: "pending",
      pending_expires_at: new Date(
        Date.now() + PENDING_HOLD_MINUTES * 60 * 1000,
      ).toISOString(),
    })
    .eq("id", target.id)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (holdError) {
    console.error("Failed to hold target slot for reschedule fee checkout:", holdError);
    await supabase
      .from("booking_slots")
      .update({ status: "booked", pending_expires_at: null })
      .eq("id", current.id)
      .eq("status", "pending");
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!held) {
    await supabase
      .from("booking_slots")
      .update({ status: "booked", pending_expires_at: null })
      .eq("id", current.id)
      .eq("status", "pending");
    return Response.json(
      { error: "That time is no longer available." },
      { status: 409 },
    );
  }

  try {
    const session = await createRescheduleFeeCheckoutSession({
      bookingToken: token,
      currentSlotId: current.id,
      targetSlotId: target.id,
      clientEmail: current.client_email!,
      amountCents: RESCHEDULE_FEE_CENTS,
    });

    return Response.json({ ok: true, freeSwap: false, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create reschedule-fee checkout session:", err);
    await supabase
      .from("booking_slots")
      .update({ status: "open", pending_expires_at: null })
      .eq("id", target.id)
      .eq("status", "pending");
    await supabase
      .from("booking_slots")
      .update({ status: "booked", pending_expires_at: null })
      .eq("id", current.id)
      .eq("status", "pending");
    return Response.json(
      { error: "Something went wrong starting checkout." },
      { status: 500 },
    );
  }
}
