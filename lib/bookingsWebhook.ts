// Domain logic for Stripe webhook events touching the `bookings` table —
// kept out of app/api/webhooks/stripe-bookings/route.ts so that route
// stays a thin, signature-verified dispatcher.

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { sendBookingPaymentConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { utcIsoToBusinessDate } from "@/lib/scheduling";

export async function handleBookingCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<{ retry: boolean }> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return { retry: false };

  const supabase = getSupabaseClient();

  // Idempotent: the `.eq("status", "pending")` guard means only the first
  // delivery of this event actually flips status. A retried delivery finds
  // status already 'confirmed', matches no row, and no-ops.
  const { data: booking, error } = await supabase
    .from("bookings")
    .update({
      status: "confirmed",
      payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      amount_paid_cents: session.amount_total,
      pending_expires_at: null,
    })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("*, appointment_types(name)")
    .maybeSingle();

  if (error) {
    console.error("Failed to confirm booking from webhook:", error);
    return { retry: true };
  }
  if (!booking) {
    // Already confirmed (duplicate delivery) or the row is gone — either
    // way, nothing left to do.
    return { retry: false };
  }

  // Only count a redemption once the payment has actually gone through —
  // an abandoned or expired checkout (handleBookingCheckoutExpired below)
  // never reaches this point, so it never consumes a limited-use code.
  if (booking.discount_code) {
    const { error: redemptionError } = await supabase.rpc("increment_discount_code_redemption", {
      p_code: booking.discount_code,
    });
    if (redemptionError) {
      console.error("Failed to increment discount code redemption:", redemptionError);
    }
  }

  try {
    await sendBookingPaymentConfirmedEmail(booking);
  } catch (err) {
    console.error("Confirmation email failed (booking still confirmed):", err);
  }

  try {
    const eventId = await pushBookingToGoogleCalendar(booking);
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", bookingId);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still confirmed):", err);
  }

  await broadcastBookingChange({ date: utcIsoToBusinessDate(booking.start_time) });

  return { retry: false };
}

export async function handleBookingCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const supabase = getSupabaseClient();
  const { data: booking } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("start_time")
    .maybeSingle();

  // An expired hold frees the slot back up — other clients should see it
  // become available again.
  if (booking) {
    await broadcastBookingChange({ date: utcIsoToBusinessDate(booking.start_time) });
  }
}
