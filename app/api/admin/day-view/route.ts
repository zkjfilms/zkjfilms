import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { computeOpenSlots, resolveHoursForDate } from "@/lib/scheduling";
import { fetchOpenSlotsForDate, type AppointmentTypeRow } from "@/lib/availabilityQuery";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const [{ data: bookings }, { data: blockedTimes }, { data: rules }, { data: overrides }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("id, client_name, start_time, end_time, appointment_type_id, status")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`)
        .in("status", ["confirmed", "pending"])
        .order("start_time", { ascending: true }),
      supabase
        .from("blocked_times")
        .select("id, start_time, end_time, reason")
        .eq("date", date)
        .order("start_time", { ascending: true }),
      supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
      supabase
        .from("availability_overrides")
        .select("date, start_time, end_time, is_closed")
        .eq("date", date),
    ]);

  const hours = resolveHoursForDate(
    date,
    (rules ?? []).map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time })),
    (overrides ?? []).map((o) => ({
      date: o.date,
      startTime: o.start_time,
      endTime: o.end_time,
      isClosed: o.is_closed,
    })),
  );

  let openSlots: ReturnType<typeof computeOpenSlots> = [];
  if (appointmentTypeId && hours) {
    const { data: type } = await supabase
      .from("appointment_types")
      .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
      .eq("id", appointmentTypeId)
      .single();
    if (type) {
      openSlots = await fetchOpenSlotsForDate({ date, appointmentType: type as AppointmentTypeRow });
    }
  }

  return Response.json({ hours, bookings, blockedTimes, openSlots });
}
