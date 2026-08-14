# Booking: Mandatory Phone, Client Directory, Discount Codes

## Context

Three additions to the existing booking system (`app/book/*`, `app/api/bookings/route.ts`, Stripe Checkout via `lib/stripe.ts`, webhook confirmation via `lib/bookingsWebhook.ts`):

1. Phone number becomes required on the booking form, not optional.
2. A new admin page lists clients who have completed a booking (derived from `bookings`, not the separate `leads` inquiry pipeline).
3. Admin-managed discount codes (percentage or fixed-amount) that clients enter on the booking form; the discounted amount is what Stripe actually charges.

## 1. Mandatory phone number

- `app/book/BookingForm.tsx`: remove the "(optional)" label text and add `required` to the phone `<input>`, matching the existing name/email fields.
- `app/api/bookings/route.ts` `parsePayload`: require `clientPhone` to be non-empty after trimming (same presence-only check already used for `clientName` — no format/regex validation is added, consistent with the rest of this validator, where only email has a pattern check).
- `bookings.client_phone` remains nullable in the schema. Enforcement is at the API boundary only; historical rows and the `reschedule_booking` RPC (which carries the existing value forward on reschedule) are unaffected.

## 2. Client directory

No new table. A new admin page aggregates existing `bookings` rows in application code.

- `app/admin/clients/page.tsx` (server component): queries `bookings` where `status = 'confirmed'`, selecting `client_name, client_email, client_phone, start_time, amount_paid_cents, appointment_type_id` with `appointment_types(name)` joined in. Groups the results by `client_email` in JS:
  - `name`, `phone`: from the most recent booking for that email.
  - `bookingCount`: count of rows.
  - `firstBooking` / `lastBooking`: min/max `start_time`.
  - `totalPaidCents`: sum of `amount_paid_cents` (treating null as 0).
  - `bookings`: the full list of that client's bookings (type name, date, amount), for row expansion.
- `app/admin/clients/ClientDirectoryList.tsx` (client component, mirrors `AppointmentTypeList.tsx`'s structure): renders the aggregated table (Name, Email, Phone, # Bookings, Last Booking, Total Paid), with each row expandable to show that client's individual booking history.
- `app/admin/layout.tsx`: add a "Clients" entry to `NAV_LINKS`.

This is intentionally separate from the `leads` table (`supabase/schema.sql`), which is a manually-progressed inquiry pipeline (new → contacted → booked → completed/lost) fed by the contact form and manual entry. The client directory is a read-only view derived from actual completed bookings, not another status pipeline.

## 3. Discount codes

### Schema additions (`supabase/schema.sql`, appended as a new block per the file's append-only convention; RLS enabled with no policies, matching every other admin-managed table — all access goes through the service-role client)

```sql
create table discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,               -- always stored uppercased
  type text not null check (type in ('percentage', 'fixed_amount')),
  value integer not null check (value > 0), -- percentage: 1-100; fixed_amount: cents
  active boolean not null default true,
  expires_at timestamptz,
  max_redemptions integer,                  -- null = unlimited
  redemption_count integer not null default 0,
  appointment_type_ids uuid[],              -- null/empty = valid for every appointment type
  created_at timestamptz not null default now()
);

alter table discount_codes enable row level security;
```

```sql
alter table bookings add column if not exists discount_code text;
alter table bookings add column if not exists discount_cents integer;
```

`reschedule_booking(...)` (the existing RPC in `supabase/schema.sql`) must also copy `discount_code, discount_cents` from the old row into the new one — every other payment-related column (`payment_intent_id`, `amount_paid_cents`) is already carried forward there, and skipping these two would silently drop discount history on a reschedule.

### Admin UI (`/admin/discount-codes`)

Mirrors the existing `appointment-types` admin CRUD:

- `app/admin/discount-codes/page.tsx` + `DiscountCodeList.tsx` + `DiscountCodeForm.tsx`.
- `app/api/admin/discount-codes/route.ts` (GET list, POST create) and `app/api/admin/discount-codes/[id]/route.ts` (PATCH update, DELETE), all behind the existing `requireAdmin()` cookie check (see `app/api/admin/appointment-types/route.ts` for the pattern).
- Form fields: code (text, uppercased on submit), type (percentage/fixed-amount radio, changes the value field's suffix/label), value, active (checkbox), expiration date (optional date input), max redemptions (optional number input), and a checkbox list of appointment types the code applies to (unchecked/empty = all types).
- `app/admin/layout.tsx`: add "Discount Codes" to `NAV_LINKS`.

### Client-side entry (`app/book/BookingForm.tsx`, `BookingFlow.tsx`)

- `BookingFlow.tsx` passes `requiresPayment` (from the already-selected `AppointmentType`) down to `BookingForm` alongside the existing props.
- `BookingForm.tsx` renders an optional "Discount code" text input only when `requiresPayment` is true.
- The code is submitted as part of the existing single POST to `/api/bookings` — no separate "Apply"/preview round trip. If the code is invalid, the existing error-display path (`data.error`) surfaces the message, same as any other validation failure today.

### Server-side application (`app/api/bookings/route.ts`)

After the existing appointment-type lookup and before the availability re-check:

1. `parsePayload` gains an optional `discountCode: string`.
2. If `discountCode` is present and `type.requires_payment` is true:
   - Normalize to uppercase, look up in `discount_codes` by `code`.
   - Validate: exists, `active = true`, `expires_at` is null or in the future, `max_redemptions` is null or `redemption_count < max_redemptions`, and `appointment_type_ids` is null/empty or contains `type.id`.
   - Any failure returns `400` with a single generic message: `"That discount code is invalid or no longer available."` (no distinction between "expired" vs. "wrong type" vs. "not found" surfaced to the client).
3. Compute the final charge amount:
   - `percentage`: `Math.round(price_cents * (100 - value) / 100)`.
   - `fixed_amount`: `price_cents - value`, floored at **50 cents** (Stripe's minimum card-payment amount), so a fixed-amount code can never produce an amount Stripe would reject at checkout-session creation.
4. The booking insert includes `discount_code` (normalized) and `discount_cents` (= `price_cents - finalAmountCents`). `createFullPaymentCheckoutSession` receives `finalAmountCents` in place of `type.price_cents`.
5. If no discount code is present, or the appointment type doesn't require payment, behavior is unchanged from today.

### Redemption counting (`lib/bookingsWebhook.ts`)

`redemption_count` increments only in `handleBookingCheckoutCompleted`, on the same pending → confirmed transition that already fires the confirmation email and calendar push — not when the checkout session is first created. This means an abandoned or expired checkout (`handleBookingCheckoutExpired`) never consumes a limited-use code.

The increment uses a conditional update rather than a plain `+1`, as a lightweight guard against two simultaneous checkouts both redeeming the last use of a capped code:

```sql
update discount_codes
set redemption_count = redemption_count + 1
where code = $1
  and (max_redemptions is null or redemption_count < max_redemptions)
```

This bounds the stored counter but does not retroactively cancel a booking if the race already happened at reservation time — acceptable given this is a single-photographer, low-volume booking system, not a high-traffic promo.

### Confirmation email (`lib/email.ts`)

`sendBookingPaymentConfirmedEmail` already displays `amount_paid_cents`, which is the real Stripe-charged (already-discounted) amount — no correctness change needed. When `booking.discount_code` is set, add one line in the same itemized style already used there: `Discount applied: CODE (-$X.XX)`.

## Testing

- Discount validation/amount computation in the API route: expired code, inactive code, code restricted to a different appointment type, code at its redemption limit, percentage vs. fixed-amount math, and the 50¢ floor.
- Manual pass through the full booking flow against a Stripe test-mode session, confirming the Checkout total matches the discounted amount and the webhook increments `redemption_count` only after payment completes.
- Mandatory phone: form rejects empty submission client-side; API rejects a request with `clientPhone` missing/blank even if the client-side check is bypassed.
