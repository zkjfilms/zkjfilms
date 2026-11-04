import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";

// ?id=<type id> also returns that type if it's private — see
// fetchActiveAppointmentTypes.
export async function GET(request: Request) {
  try {
    const includePrivateId = new URL(request.url).searchParams.get("id") ?? undefined;
    const appointmentTypes = await fetchActiveAppointmentTypes({ includePrivateId });
    return Response.json({ appointmentTypes });
  } catch (err) {
    console.error("Failed to fetch appointment types:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
