// Shared discount-code types and math — used by the admin CRUD routes
// (app/api/admin/discount-codes) and the booking checkout flow
// (app/api/bookings/route.ts) so the percentage/fixed-amount rules and
// the Stripe minimum-charge floor are defined in exactly one place.

export type DiscountCodeType = "percentage" | "fixed_amount";

export const DISCOUNT_CODE_TYPES: DiscountCodeType[] = ["percentage", "fixed_amount"];

export type DiscountCode = {
  id: string;
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  appointment_type_ids: string[] | null;
  created_at: string;
};

// Stripe rejects card charges below $0.50 USD at Checkout Session
// creation. computeDiscountedAmountCents below treats this as two
// tiers: a discount that fully covers the price (raw <= 0) produces a
// genuinely free booking (see app/api/bookings/route.ts, which skips
// Stripe entirely in that case); a discount that leaves a small but
// positive amount still floors up to this minimum, since that booking
// still goes through a real Stripe charge.
export const STRIPE_MIN_CHARGE_CENTS = 50;

export function isValidDiscountValue(type: DiscountCodeType, value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  if (type === "percentage") return value <= 100;
  return true;
}

export function computeDiscountedAmountCents(
  priceCents: number,
  discount: { type: DiscountCodeType; value: number },
): number {
  const raw =
    discount.type === "percentage"
      ? Math.round((priceCents * (100 - discount.value)) / 100)
      : priceCents - discount.value;
  if (raw <= 0) return 0;
  return Math.max(raw, STRIPE_MIN_CHARGE_CENTS);
}

export function isDiscountCodeApplicable(
  discount: DiscountCode,
  appointmentTypeId: string,
  now: Date = new Date(),
): boolean {
  if (!discount.active) return false;
  if (discount.expires_at && new Date(discount.expires_at) <= now) return false;
  if (discount.max_redemptions !== null && discount.redemption_count >= discount.max_redemptions) {
    return false;
  }
  if (
    discount.appointment_type_ids &&
    discount.appointment_type_ids.length > 0 &&
    !discount.appointment_type_ids.includes(appointmentTypeId)
  ) {
    return false;
  }
  return true;
}
