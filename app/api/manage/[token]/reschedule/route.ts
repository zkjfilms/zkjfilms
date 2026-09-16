import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { deleteGoogleCalendarEvent, pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { sendBookingRescheduledEmail } from "@/lib/email";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { utcIsoToBusinessDate, businessLocalToUtcIso, addMinutesToTime } from "@/lib/scheduling";

type Payload = { date: string; startTime: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string"
  ) {
    return null;
  }
  return { date: b.date, startTime: b.startTime };
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: current, error } = await supabase
    .from("bookings")
    .select("*, appointment_types(name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color)")
    .eq("booking_token", token)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error || !current) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const hoursUntil = (new Date(current.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < noticeHours) {
    return Response.json({ error: "This booking is too close to reschedule online — please contact us directly." }, { status: 403 });
  }

  const type = Array.isArray(current.appointment_types) ? current.appointment_types[0] : current.appointment_types;
  const openSlots = await fetchOpenSlotsForDate({ date: payload.date, appointmentType: { ...type, id: current.appointment_type_id } });
  if (!openSlots.some((s) => s.startTime === payload.startTime)) {
    return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  // Same guard as app/api/bookings/route.ts: an expired pending hold
  // that was never swept is invisible to fetchOpenSlotsForDate above but
  // the exclusion constraint the RPC's insert relies on doesn't know
  // about pending_expires_at, so it would 23P01 this reschedule forever
  // without this.
  await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("pending_expires_at", new Date().toISOString())
    .lt("start_time", endIso)
    .gt("end_time", startIso);

  const { data: newBooking, error: rpcError } = await supabase.rpc("reschedule_booking", {
    p_booking_token: token,
    p_new_start: startIso,
    p_new_end: endIso,
  });

  if (rpcError) {
    if (rpcError.code === "23P01") {
      return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
    }
    console.error("reschedule_booking RPC failed:", rpcError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  // Past this point the reschedule has already committed via the RPC, so
  // nothing below may fail the response — same log-and-continue treatment
  // the Calendar push and the email get. deleteGoogleCalendarEvent catches
  // its own events.delete call but not getAuthenticatedGoogleClient(),
  // which does a Supabase read and throws on missing/invalid OAuth config.
  if (current.google_event_id) {
    try {
      await deleteGoogleCalendarEvent(current.google_event_id);
    } catch (err) {
      console.error("Google Calendar delete failed after reschedule:", err);
    }
  }
  try {
    const eventId = await pushBookingToGoogleCalendar({ ...newBooking, appointment_types: type });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", newBooking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed after reschedule:", err);
  }

  try {
    await sendBookingRescheduledEmail({ ...newBooking, appointment_types: type });
  } catch (err) {
    console.error("Reschedule confirmation email failed:", err);
  }

  await broadcastBookingChange({ date: utcIsoToBusinessDate(current.start_time) });
  await broadcastBookingChange({ date: payload.date });

  return Response.json({ ok: true });
}
