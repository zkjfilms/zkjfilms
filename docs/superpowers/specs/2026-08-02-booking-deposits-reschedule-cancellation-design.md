# Booking Deposits, Reschedule & Cancellation

## Background

The site has a native booking system (`/book`) that replaced an embedded Acuity
widget: an admin opens discrete time slots in `/admin/availability`, a client
claims one, and a contract/signing-link email goes out. It collects no payment.

This adds three things on top of that:

1. A deposit, collected via Stripe, required to confirm a booking.
2. A private per-client link where they can reschedule their own appointment.
3. The same link lets them cancel, with a tiered refund of their deposit.

## Goals

- Deposits are collected at booking time and are what gets refunded on cancellation.
- A client can reschedule for free with 72+ hours' notice; under 72 hours costs a
  $50 fee, paid before the reschedule takes effect.
- A client can cancel. Refund is 100% at 7+ days' notice, 50% at 3–7 days, 0%
  under 3 days.
- The whole booking flow (browse slots → pay deposit → confirmation) stays on
  `/book` as one self-contained page — no bouncing across the site. `/book` is
  added to the main site nav.
- A cancellation always releases the slot, even if the Stripe refund call
  fails — a failed refund is flagged for manual follow-up, never blocks the
  cancellation.

## Non-goals

- No self-serve rescheduling into a *different* session type or price tier —
  a client can only reschedule into another open slot of the same
  `session_type`, so the deposit already paid stays valid without proration
  logic.
- No cancellation-fee logic beyond the refund tiers above (e.g. no separate
  "cancellation fee" on top of the withheld deposit percentage).
- No client-side Stripe Elements/embedded payment form — deposits and the
  reschedule fee are collected via Stripe Checkout redirect, which needs only
  a secret key server-side, not a publishable key.

## Data model

Extend `booking_slots`:

```sql
alter table booking_slots
  add column deposit_cents integer not null default 0,
  add column deposit_payment_intent_id text,
  add column booking_token uuid,
  add column pending_expires_at timestamptz,
  add column refund_status text
    check (refund_status in ('refunded', 'partial_refund', 'no_refund', 'failed')),
  add column refund_amount_cents integer;

alter table booking_slots drop constraint if exists booking_slots_status_check;
alter table booking_slots add constraint booking_slots_status_check
  check (status in ('open', 'pending', 'booked'));

create index if not exists booking_slots_booking_token_idx
  on booking_slots (booking_token);
```

- `deposit_cents` — set by the admin per slot in `/admin/availability`,
  alongside session type and time range.
- `deposit_payment_intent_id` — Stripe's reference for the paid deposit,
  needed to issue a refund later.
- `booking_token` — the private link's identity. Generated when a booking is
  confirmed. **Not** the same as `id`: `id` belongs to whichever row
  currently represents the appointment, but a reschedule moves the client to
  a *different* row. The token travels with the client across that move so
  `/manage/[booking_token]` keeps working. Cleared (or just left stale, since
  lookups always filter on `status = 'booked'`) once cancelled.
- `pending_expires_at` — set when a slot is held mid-checkout; a 30-minute
  window. Used by the webhook-expiry handler and by a CLI safety-net sweep
  (see below) in case a webhook delivery is ever missed.
- `refund_status` / `refund_amount_cents` — set on cancellation. `failed`
  means the Stripe refund call errored; the slot is released regardless, and
  this is what surfaces the booking for manual follow-up in `/admin`.

`status` gains a third value: `open` → `pending` (mid-checkout hold) →
`booked`.

## Booking flow

1. Client picks an open slot on `/book`, submits name/email/notes.
2. Server marks the slot `pending`, sets `pending_expires_at` = now + 30min,
   and creates a Stripe Checkout Session for `deposit_cents` with the slot id
   in metadata. Client is redirected to Stripe.
3. **Payment succeeds** — webhook `checkout.session.completed` on
   `/api/webhooks/stripe` (signature-verified): slot flips to `booked`,
   `deposit_payment_intent_id` is recorded, `booking_token` is generated, the
   lead is logged, the contract is generated from the template, and one
   confirmation email goes out containing both the contract-signing link
   (`/sign/[contract.id]`) and the new `/manage/[booking_token]` link.
4. **Checkout abandoned/expired** — webhook `checkout.session.expired`
   releases the slot back to `open` and clears the pending fields.
5. **Safety net** — `npm run bookings:sweep-pending` (mirroring the existing
   `gallery:*` CLI scripts pattern) releases any slot still `pending` past
   its `pending_expires_at`, in case a webhook delivery was ever missed.

## Reschedule flow

`/manage/[booking_token]` shows the client's current appointment and a list
of other open slots sharing the same `session_type`.

1. Client picks a new slot. Server computes hours until the *current*
   appointment's start time.
2. **≥72h notice:** swap happens immediately, no payment — old slot releases
   to `open` (cleared), new slot claims `booked` with the client's info, and
   `booking_token` moves to the new row. Confirmation email sent noting the
   new time.
3. **<72h notice:** same shape as the booking flow — the target slot flips to
   `pending`, a $50 Stripe Checkout Session is created, client is redirected
   to pay. On webhook success, the swap happens exactly as in the free path.
   On expiry, the hold releases and nothing about the original booking
   changes.
4. The 72h/$50 rule always evaluates against whatever appointment is
   *currently* booked at the moment of the request — a second reschedule is
   judged against the first reschedule's new time, not the original one.

## Cancellation flow

Same `/manage/[booking_token]` page, a cancel option alongside reschedule.

1. Server computes days until the current appointment and determines the
   refund tier: **≥7 days → 100%**, **<7 but ≥3 days → 50%**, **<3 days → 0%**.
2. If the tier is >0%, call Stripe's Refund API against
   `deposit_payment_intent_id` for that percentage of `deposit_cents`.
3. **Regardless of refund outcome**, the slot releases to `open` (cleared)
   and the cancellation is final — `booking_token` no longer resolves to a
   booked row afterward.
4. `refund_status` is set to `refunded` (100%), `partial_refund` (50%),
   `no_refund` (0% tier, nothing attempted), or `failed` (refund API call
   errored). `failed` bookings are what `/admin` surfaces for manual
   follow-up — the client sees a cancellation-confirmed message regardless,
   since we don't want a Stripe hiccup to trap them in a booking they no
   longer want.

## Admin visibility

Extend `/admin/availability` rather than add a new page — same underlying
`booking_slots` rows:

- `AddSlotForm` gains a deposit amount field alongside session type.
- The slot list shows deposit amount and payment/refund status per row.
- Any row with `refund_status = 'failed'` is visually flagged for manual
  refund follow-up.

## Navigation

`/book` is added to `components/Navbar.tsx`'s `links` array, positioned
between "About" and "Contact": Home → Portraits → About → Book → Contact.

## Error handling

- **Webhook signature verification** on `/api/webhooks/stripe`, same
  defensive posture as the existing HMAC/timing-safe patterns in
  `lib/adminAccess.ts` / `lib/gatedAccess.ts`.
- **Idempotency** — Stripe can retry webhook delivery; processing keys off
  `checkout.session.id` so a duplicate delivery doesn't double-book, double
  swap, or double-send email.
- **Refund failures never block cancellation** (see above) — flagged, not
  fatal.
- **Lead-logging failures remain best-effort**, matching the existing
  `/api/book` behavior — a lead-insert error is logged but doesn't fail the
  booking/reschedule/cancellation itself.

## Environment variables

Add to `.env.example` / `.env.local` / Vercel:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

No publishable key needed (Checkout redirect flow, not client-side Elements).

## New/changed files (for the implementation plan)

- `supabase/schema.sql` — column/constraint changes above
- `lib/stripe.ts` — Stripe client, mirroring `lib/supabase.ts`'s
  `getSupabaseClient()` pattern
- `app/api/webhooks/stripe/route.ts` — signature-verified webhook handler
  for `checkout.session.completed` / `checkout.session.expired`
- `app/api/book/route.ts` — reworked to create a Checkout Session and hold
  the slot instead of claiming it directly
- `app/manage/[token]/page.tsx` + client component — reschedule/cancel UI
- `app/api/manage/[token]/reschedule/route.ts` — reschedule request handler
- `app/api/manage/[token]/cancel/route.ts` — cancellation request handler
- `app/admin/availability/AddSlotForm.tsx` — deposit field
- `app/admin/availability/page.tsx` — deposit/refund status display, failed-
  refund flag
- `components/Navbar.tsx` — add `/book` link
- `scripts/bookings.mjs` + `bookings:sweep-pending` npm script — pending-hold
  safety net, mirroring `scripts/gallery.mjs`
- `lib/email.ts` — new templates: deposit-paid confirmation (contract link +
  manage link), reschedule confirmation, cancellation confirmation
- `.env.example` — Stripe vars

## Testing plan

- Deposit checkout completes → slot books, token/email/contract all fire.
- Checkout expires → slot reopens (both webhook path and CLI sweep path).
- Reschedule ≥72h → swaps instantly, no payment, link keeps working
  afterward.
- Reschedule <72h → requires the $50 Checkout; swap only happens on webhook
  success; expiry leaves the original booking untouched.
- Cancel at each of the three notice tiers → correct refund percentage
  issued.
- Forced Stripe refund failure → cancellation still completes, booking is
  flagged in `/admin`, client still sees a confirmation.
- Tampered/invalid webhook signature → rejected.
- Duplicate webhook delivery (same `checkout.session.id`) → no double
  booking, swap, or email.
- `/book` reachable from the main nav; `/contact` and footer still point to
  `/book` (no regression from the earlier session's work).
