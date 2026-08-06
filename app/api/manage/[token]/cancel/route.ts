import { getSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { deleteGoogleCalendarEvent } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { utcIsoToBusinessDate } from "@/lib/scheduling";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("booking_token", token)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error || !booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const hoursUntil = (new Date(booking.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < noticeHours) {
    return Response.json({ error: "This booking is too close to cancel online — please contact us directly." }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", booking.id)
    .eq("status", "confirmed");
  if (updateError) {
    console.error("Cancellation update failed:", updateError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (booking.google_event_id) {
    await deleteGoogleCalendarEvent(booking.google_event_id);
  }

  if (booking.payment_intent_id) {
    try {
      const stripe = getStripeClient();
      await stripe.refunds.create({ payment_intent: booking.payment_intent_id });
    } catch (err) {
      // Cancellation always succeeds even if the refund call fails —
      // same non-negotiable rule as the previous booking system. Flagged
      // for manual follow-up via the admin day view, which shows every
      // canceled booking's payment_intent_id.
      console.error(`Refund failed for booking ${booking.id}, needs manual follow-up:`, err);
    }
  }

  await broadcastBookingChange({ date: utcIsoToBusinessDate(booking.start_time) });

  return Response.json({ ok: true });
}
