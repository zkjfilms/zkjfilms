import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenDatesForMonth, type AppointmentTypeRow } from "@/lib/availabilityQuery";
import { daysInMonth } from "@/lib/scheduling";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  const month = url.searchParams.get("month");
  if (!appointmentTypeId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "appointmentTypeId and month (YYYY-MM) are required." }, { status: 400 });
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

    const [year, monthNum] = month.split("-").map(Number);
    const dates = daysInMonth(year, monthNum);

    const openDates = await fetchOpenDatesForMonth({ dates, appointmentType: type as AppointmentTypeRow });

    return Response.json({ openDates });
  } catch (err) {
    console.error("Failed to fetch open dates:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
