# Fully-Free Discount Codes

## Context

The booking system's discount codes (added in `docs/superpowers/specs/2026-08-14-booking-phone-clients-discounts-design.md`) currently cap a percentage code at 99% and floor any discounted amount at Stripe's 50-cent minimum charge (`STRIPE_MIN_CHARGE_CENTS` in `lib/discountCodes.ts`). This was a deliberate stopgap: a "100% off" code would otherwise still produce a real $0.50 Stripe charge, contradicting what the client was told. This spec replaces that stopgap with the real fix — when a discount code fully covers an appointment type's price, the booking is confirmed immediately and Stripe is skipped entirely, the same way a `requires_payment: false` appointment type already works.

## 1. Discount math (`lib/discountCodes.ts`)

`computeDiscountedAmountCents` changes from a single floor to a two-tier rule:

- If the raw discounted amount (`priceCents * (100 - value) / 100` for percentage, `priceCents - value` for fixed-amount) is **≤ 0**, return exactly `0` — this is a fully-free booking.
- If the raw amount is **positive but under 50 cents**, it still floors up to `STRIPE_MIN_CHARGE_CENTS` (50) as today — a near-100% discount still requires a real, if tiny, Stripe charge.

```ts
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
```

`isValidDiscountValue` reverts the percentage cap from 99 back to 100, since 100% now does the right thing instead of silently charging 50 cents:

```ts
export function isValidDiscountValue(type: DiscountCodeType, value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  if (type === "percentage") return value <= 100;
  return true;
}
```

The comment explaining the old 99-cap is replaced with one explaining the new zero-floor behavior on `computeDiscountedAmountCents`. A fixed-amount code whose value meets or exceeds the price behaves the same way — it was already possible to create such a code, and it previously produced a confusing 50-cent charge; now it produces a free booking, consistently with the percentage case.

No admin UI changes are needed: `DiscountCodeForm.tsx`'s percentage field already accepts whatever `isValidDiscountValue` allows, so raising the cap back to 100 there is a one-line change to match (the client-side duplicate check and its label, added when the cap was lowered to 99).

## 2. Booking creation (`app/api/bookings/route.ts`)

Today the branch after computing `finalAmountCents` is `type.requires_payment ? (insert 'pending' + create Stripe session) : (insert 'confirmed' + send free-booking email)`. It becomes a single added condition on the existing branch — a booking is confirmed immediately, skipping Stripe, whenever **`!type.requires_payment` OR `finalAmountCents === 0`**:

- `status` on insert: `"confirmed"` in both of those cases, `"pending"` only when a nonzero Stripe charge is actually going to happen.
- `pending_expires_at`: `null` in both confirmed cases, set only for the Stripe path — unchanged logic, just gated on the wider condition.
- After insert, the existing "confirmed" branch (currently only reached when `!type.requires_payment`) additionally handles the discount-covered case:
  - If a discount was applied (`appliedDiscount !== null`), increment its redemption count via the same `increment_discount_code_redemption` RPC the webhook already calls (see §3), and send the confirmation email via `sendBookingPaymentConfirmedEmail` (see §4) instead of `sendFreeBookingConfirmedEmail`.
  - If no discount was applied (the pre-existing `!type.requires_payment` case), behavior is completely unchanged: `sendFreeBookingConfirmedEmail`, no redemption call.
  - Google Calendar push, `broadcastBookingChange`, and the `{ok:true, checkoutUrl:null, bookingToken}` response are shared by both sub-cases, exactly as they are today for the free-type path.
- The Stripe-session branch at the bottom of the function is reached only when `finalAmountCents > 0`, unchanged otherwise.

## 3. Redemption counting

`discount_codes.redemption_count` currently increments only in `lib/bookingsWebhook.ts`'s `handleBookingCheckoutCompleted`, because until now every discount-applied booking necessarily went through Stripe. That invariant no longer holds. For a fully-free booking, `app/api/bookings/route.ts` calls `supabase.rpc("increment_discount_code_redemption", { p_code: appliedDiscount.code })` directly, right after the booking insert succeeds and before sending the confirmation email — mirroring exactly what the webhook does for the paid path (log-and-continue on RPC failure, never block the rest of the confirmation flow on it). No schema change is needed; the RPC and its `revoke execute` grant already exist.

## 4. Confirmation email

No new email code. For the fully-free path, `route.ts` calls the existing `sendBookingPaymentConfirmedEmail` (today only called from the webhook) instead of `sendFreeBookingConfirmedEmail`. Since the booking row has `amount_paid_cents: null` (nothing was charged) and `discount_code`/`discount_cents` populated, that function's existing logic already produces the right copy with zero changes: `paidLine` falls back to `"You're all set."` when `amount_paid_cents` is falsy, and the existing discount line (from the prior discount-codes feature) shows `"Discount applied: CODE (-$500.00)."` — e.g. *"You're confirmed for Wedding Session on [date]. You're all set. Discount applied: FREE100 (-$500.00)."*

## 5. What doesn't change

- `isDiscountCodeApplicable`'s rules (active, expiry, redemption limit, appointment-type restriction) are unaffected.
- `discount_cents`'s bookkeeping formula (`type.price_cents - finalAmountCents`) is unchanged — it now correctly equals the full price when the booking is free.
- The admin discount-codes CRUD API and list/table UI are unaffected beyond the one-line value-cap change in `DiscountCodeForm.tsx`.
- Reschedule (`reschedule_booking` RPC) already carries `discount_code`/`discount_cents` forward regardless of amount — no change needed there.
- Cancellation still does not release a redeemed code's count (a prior, separate, deliberate product decision, documented in `app/api/manage/[token]/cancel/route.ts`) — a fully-free booking that gets canceled behaves the same way a paid one does today.

## Testing

Same constraints as the original discount-codes feature: no test framework in this codebase (verification is `tsc`/`eslint` + live curl/direct-Supabase-query checks against the real project), and `STRIPE_SECRET_KEY` is not configured in the development environment, so the *nonzero*-discount Stripe path still can't be exercised end-to-end there — but the fully-free path introduced by this change requires no Stripe key at all, so it can be fully verified live: create a 100%-off test code, submit a real booking against it, confirm the response is `{ok:true, checkoutUrl:null, bookingToken}` (not a Stripe redirect), confirm the booking row is `status: 'confirmed'` with `amount_paid_cents: null` and the correct `discount_cents`, and confirm `redemption_count` incremented immediately (no webhook needed).
