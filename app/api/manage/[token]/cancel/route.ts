import { getSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { daysUntil, refundTierForCancellation } from "@/lib/booking";
import { sendCancellationConfirmedEmail } from "@/lib/email";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  // Claim the booking atomically (status 'booked' -> 'pending') instead
  // of a plain SELECT. A plain read here would leave a window where a
  // double-submitted cancel (double-click, a retried request) reads the
  // row twice while it's still 'booked', and both requests go on to
  // call Stripe — risking a duplicate refund on the same payment
  // intent. Locking it first, mirroring the reschedule route's
  // current-booking lock step, means only one concurrent request can
  // win the claim; a second one finds status no longer 'booked' and
  // bails out below before ever touching Stripe.
  const { data: booking, error } = await supabase
    .from("booking_slots")
    .update({ status: "pending", pending_expires_at: null })
    .eq("booking_token", token)
    .eq("status", "booked")
    .select(
      "id, start_time, session_type, deposit_cents, deposit_payment_intent_id, client_name, client_email",
    )
    .maybeSingle();

  if (error) {
    console.error("Supabase booking lookup for cancellation failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!booking) {
    return Response.json(
      { error: "This link doesn't match an active booking." },
      { status: 404 },
    );
  }

  const tier = refundTierForCancellation(daysUntil(booking.start_time));
  const refundAmountCents = Math.round(
    (booking.deposit_cents * tier.percent) / 100,
  );

  let refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";

  if (tier.percent === 0 || refundAmountCents === 0) {
    refundStatus = "no_refund";
  } else if (!booking.deposit_payment_intent_id) {
    console.error(
      "Cancellation owed a refund but no deposit_payment_intent_id on file:",
      booking.id,
    );
    refundStatus = "failed";
  } else {
    try {
      const stripe = getStripeClient();
      await stripe.refunds.create({
        payment_intent: booking.deposit_payment_intent_id,
        amount: refundAmountCents,
      });
      refundStatus = tier.percent === 100 ? "refunded" : "partial_refund";
    } catch (err) {
      console.error("Stripe refund failed during cancellation:", err);
      refundStatus = "failed";
    }
  }

  // Cancellation always goes through, even if the refund above failed —
  // a Stripe hiccup shouldn't trap a client in a booking they no longer
  // want. refund_status = 'failed' is what flags this row in
  // /admin/availability for manual follow-up (note: that flag only
  // stays visible while this exact row remains 'open' — if it gets
  // rebooked before you notice, the flag clears with it. Stripe's own
  // dashboard is the durable fallback record of the failed attempt).
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
      refund_status: refundStatus,
      refund_amount_cents: refundStatus === "failed" ? 0 : refundAmountCents,
    })
    .eq("id", booking.id)
    .eq("status", "pending");

  if (releaseError) {
    console.error("Failed to release slot after cancellation:", releaseError);
    // Best-effort: put the slot back the way we found it so the client
    // isn't left holding a dead link — a plain retry can pick this back
    // up. If this also fails, the row is stranded 'pending' and needs
    // manual attention; either way we still tell the client something
    // went wrong rather than claim success.
    const { error: rollbackError } = await supabase
      .from("booking_slots")
      .update({ status: "booked" })
      .eq("id", booking.id)
      .eq("status", "pending");
    if (rollbackError) {
      console.error(
        "Failed to roll back booking to 'booked' after release failure:",
        rollbackError,
      );
    }
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  const emailResult = await sendCancellationConfirmedEmail({
    clientName: booking.client_name!,
    clientEmail: booking.client_email!,
    sessionType: booking.session_type,
    startTime: booking.start_time,
    refundStatus,
    refundAmountCents,
  });
  if (!emailResult.ok) {
    console.error("Failed to send cancellation confirmation email:", emailResult.error);
  }

  return Response.json({ ok: true, refundStatus, refundAmountCents });
}
