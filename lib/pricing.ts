import type { AppointmentTypeRow } from "@/lib/availabilityQuery";

// Lowest price among paid, active appointment types matching a service.
// Shared by the homepage cards and the service pages' Offer schema so the
// two can't disagree.
export function startingPriceCents(
  types: AppointmentTypeRow[],
  match: (name: string) => boolean,
): number | null {
  const prices = types.filter((t) => t.requires_payment && match(t.name)).map((t) => t.price_cents);
  return prices.length ? Math.min(...prices) : null;
}
