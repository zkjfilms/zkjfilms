# Invoice Payment-Triggered Booking Design

## Problem

Today, "Create new" booking mode on the invoice-creation form reserves the slot
immediately — a real `confirmed` booking is created and pushed to Google Calendar
the moment the admin sends the invoice, regardless of whether the client ever
pays. That's backwards: an unpaid invoice shouldn't hold a slot indefinitely, and
there's no pressure on the client to actually pay before someone else takes that
time.

Separately, the admin currently has to retype a session's description and price
into the invoice's line items by hand every time, even though that information
already exists on the appointment type being billed for.

## Goals

- A slot for a "Create new" mode invoice is only reserved once the client
  actually pays — not when the invoice is sent, not while it's outstanding.
- The moment payment confirms, the real booking exists, it's on the Google
  Calendar, and the client has a confirmation email with the session details —
  matching what a client gets from the public booking flow.
- Picking from the appointment-type catalog can auto-fill a line item's
  description and price, in any booking mode, while staying fully editable.
- The admin has visibility into problems (a slot taken out from under a paid
  invoice, an invoice that just went out) without having to babysit the admin
  dashboard.

## Non-goals

- No hold/reservation mechanism while an invoice is outstanding. This is
  intentional — holding the slot would undercut the incentive to pay quickly,
  which is the whole point of this change.
- No in-app tool to resolve a booking conflict (reschedule, rebook, refund).
  Stripe doesn't allow voiding an already-paid invoice, so resolution is
  inherently a manual, out-of-band conversation with the client. Only
  visibility (a flag + a notification) is in scope.
- No changes to "Link existing" or "None" booking modes' relationship to
  bookings — "Link existing" still requires picking an already-`confirmed`
  booking, and "None" still has no booking at all. Only the appointment-type
  line-item auto-fill (Goal 3) touches those modes.
- No discount codes on invoices. The admin already controls price directly via
  line items; that's a different concept from the public flow's promo codes.

## Design

### A. Deferred booking creation

**Today:** `InvoiceForm.tsx`'s "Create new" mode calls `POST /api/admin/bookings`
first (creating a real `confirmed` row), then threads the resulting `booking.id`
into `POST /api/admin/invoices`.

**New:** that first call is removed. Instead, `POST /api/admin/invoices`'s
payload gains an optional `newBooking` object
(`{ appointmentTypeId, date, startTime, clientPhone, notes }`), present only in
"Create new" mode, alongside `bookingId: null`. `createInvoice()` stores these
fields in the Stripe invoice's metadata (the same mechanism already used to
carry `bookingId` for the "Link existing" case) instead of a real booking ID,
since no booking exists yet.

**Pre-send advisory check:** while the admin has an appointment type, date, and
time filled in (in "Create new" mode), the form checks for an existing
confirmed/pending booking overlapping that slot — reusing the admin day-view
data already used elsewhere in the admin UI — and shows a non-blocking inline
warning ("⚠ This time already has a booking") if one exists. This doesn't
block submission; since nothing is held anyway, it's purely informational so
the admin doesn't obliviously send an invoice for a slot that's visibly already
taken.

**On payment — `invoice.paid` webhook (`handleInvoicePaid` in
`lib/invoicesWebhook.ts`):** after marking the local invoice row `paid`, if its
Stripe metadata carries a not-yet-created booking intent (and the invoice has
no `booking_id` yet), the handler:

1. Looks up the appointment type, computes `start_time`/`end_time` using the
   same `businessLocalToUtcIso`/`addMinutesToTime` helpers
   `app/api/admin/bookings/route.ts` already uses.
2. Inserts a real `bookings` row with `status: "confirmed"`.
3. On success: links it back (`invoices.booking_id`), pushes it to Google
   Calendar, broadcasts the change (so the admin day-view reflects it live),
   and sends the client a booking-confirmation email with their session
   details.
4. On failure — most notably the database's existing exclusion constraint
   rejecting an overlapping slot someone else booked in the meantime, but any
   other insert failure is treated the same way — the invoice keeps its `paid`
   status (the payment is real and isn't undone) but gets a new
   `booking_conflict` flag instead of a linked booking, and the admin gets a
   one-off notification email. No retry loop: this is a state for a human to
   resolve, not a transient failure Stripe redelivery would fix.

**Void behavior:** unchanged, and needs no new logic — since nothing is ever
reserved before payment in "Create new" mode, there's nothing for a void to
release.

### B. Appointment-type line-item auto-fill

A new capability, available regardless of booking mode, letting the admin pick
from the appointment-type catalog to auto-fill a line item instead of typing it
by hand.

- **"Create new" mode:** the existing appointment-type dropdown (already there
  for scheduling) gains a second effect — selecting a type also sets line item
  0 to `{ description: type.name, amount: (type.price_cents / 100).toFixed(2) }`.
  This follows the same "fires once per selection change, stays fully editable
  afterward" pattern already established for the session-date/time auto-fill
  (see `docs/superpowers/plans/2026-09-15-invoice-session-details.md`).
- **"None" / "Link existing" modes:** a new, separate "Appointment type"
  dropdown appears directly above the Line Items section, populated from the
  same `appointmentTypes` prop already passed into the form. It has no
  scheduling effect in these modes — purely a pricing shortcut.
- Only line item 0 is ever touched by this auto-fill; any additional line
  items the admin has added are left alone. If the type's price is 0 or just
  not what the admin wants, they edit the amount exactly as they would a
  manually-typed line item — existing validation (amount must be a positive
  number) is unchanged.

### C. Email notifications

Four email touchpoints in total — two already exist, two are new, all using
the existing Resend-based `lib/email.ts` pattern:

1. **Client invoice email** (`sendInvoiceEmail`) — existing, unchanged.
2. **Client booking-confirmation email** — sent from the webhook after a
   successful deferred booking creation (Design A, step 3). Modeled on the
   public flow's `sendBookingPaymentConfirmedEmail` template (session date/time,
   appointment type name), but as its own smaller function rather than reusing
   that one directly — `sendBookingPaymentConfirmedEmail` is written around the
   public flow's own `amount_paid_cents`/discount-code fields on the booking
   record, which invoicing intentionally never touches (an explicit constraint
   carried over from the original invoicing spec). Forcing a reuse would mean
   passing nulls through fields that don't conceptually apply here.
3. **Admin invoice-sent notification** (new — `sendInvoiceSentNotification` or
   similar) — a short "Invoice sent to `<name>` — `<amount>` — `<link>`" email
   to `BUSINESS.email` (the existing constant from `lib/seo.ts`, already used
   for the contact form's owner-facing notification). Fires alongside
   `sendInvoiceEmail`, both on initial creation and on Resend.
4. **Admin booking-conflict notification** (new) — fires once, from the
   webhook, when `booking_conflict` gets set (Design A, step 4). Also sent to
   `BUSINESS.email`.

## Schema changes

```sql
alter table invoices add column if not exists booking_conflict boolean not null default false;
```

Matches this file's established convention for adding a column to an
already-created table.

## Admin UI changes

`InvoiceList.tsx` shows a warning badge ("⚠ Slot no longer available — needs
rescheduling", or similar copy) on any invoice with `booking_conflict: true`,
alongside its existing status/total display.

## Testing

Same constraints as every other plan in this project: `tsc`/`build`/`lint`,
plus curl and browser checks for what's locally testable. The full success
path (Stripe webhook firing, a real booking getting created, both new emails
actually sending) depends on a live Stripe connection and can't be exercised
end-to-end without one — verified instead by careful code tracing, matching
how every Stripe-dependent piece of this project has been verified all session.
