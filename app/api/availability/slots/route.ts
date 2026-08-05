import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate, type AppointmentTypeRow } from "@/lib/availabilityQuery";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  const date = url.searchParams.get("date");
  if (!appointmentTypeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "appointmentTypeId and date (YYYY-MM-DD) are required." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseClient();
    const { data: type, error } = await supabase
      .from("appointment_types")
      .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
      .eq("id", appointmentTypeId)
      .eq("active", true)
      .maybeSingle();

    if (error || !type) {
      return Response.json({ error: "Appointment type not found." }, { status: 404 });
    }

    const slots = await fetchOpenSlotsForDate({ date, appointmentType: type as AppointmentTypeRow });
    return Response.json({ slots });
  } catch (err) {
    console.error("Failed to fetch open slots:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
