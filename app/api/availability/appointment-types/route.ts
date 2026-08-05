import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";

export async function GET() {
  try {
    const appointmentTypes = await fetchActiveAppointmentTypes();
    return Response.json({ appointmentTypes });
  } catch (err) {
    console.error("Failed to fetch appointment types:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
