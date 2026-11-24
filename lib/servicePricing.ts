import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";
import { startingPriceCents } from "@/lib/pricing";

// Live "from" price (cents) for a service page's Offer schema — same
// appointment_types data as /book. Kept out of lib/pricing.ts so that module
// (and its tests) never import the Supabase-backed query layer.
export async function servicePrice(appointmentTypeName: string): Promise<number | null> {
  try {
    return startingPriceCents(await fetchActiveAppointmentTypes(), (n) => n === appointmentTypeName);
  } catch (err) {
    console.error("Failed to load live pricing for service schema:", err);
    return null;
  }
}
