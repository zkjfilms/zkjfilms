import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { businessLocalToUtcIso, addMinutesToTime, EMAIL_REGEX } from "@/lib/scheduling";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.appointmentTypeId !== "string" ||
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    typeof b.clientPhone !== "string" ||
    typeof b.notes !== "string"
  ) {
    return null;
  }
  return {
    appointmentTypeId: b.appointmentTypeId,
    date: b.date,
    startTime: b.startTime,
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    clientPhone: b.clientPhone.trim(),
    notes: b.notes.trim(),
  };
}

// Admin-only: creates a real `bookings` row on any date/time, including
// ones the public availability rules don't currently open — those rules
// only exist to gate the public-facing form, not the site owner. No
// honeypot, rate limiting, or Turnstile (all pointless for an
// authenticated admin action), and no availability-window check against
// fetchOpenSlotsForDate (deliberately bypassing it, per the plan). The
// database's own exclusion constraint on `bookings` still applies
// regardless of which code path inserts the row, so two confirmed
// bookings still can't occupy the same time slot.
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Please fill out all required fields with a valid email address." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: type, error: typeError } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes")
    .eq("id", payload.appointmentTypeId)
    .maybeSingle();

  if (typeError || !type) {
    return Response.json({ error: "That appointment type was not found." }, { status: 404 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_phone: payload.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status: "confirmed",
      notes: payload.notes || null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres exclusion-violation error code — this exact time overlaps
    // an existing pending/confirmed booking.
    if (insertError.code === "23P01") {
      return Response.json({ error: "That time overlaps an existing booking." }, { status: 409 });
    }
    console.error("admin bookings insert failed:", insertError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  try {
    const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still created):", err);
  }

  await broadcastBookingChange({ date: payload.date });

  return Response.json({ booking }, { status: 201 });
}
