# Invoice Session & Client Details Design

## Problem

The invoicing system (shipped 2026-09-14) lets an admin bill a client via Stripe's
native invoicing, optionally linked to a booking. But the resulting Stripe invoice
only shows line items like "Session fee — $250.00" — nothing on the invoice itself
tells the client *what date and time* they're being billed for. The admin has to
communicate that separately (email, text) outside the invoice.

Separately, the invoice-creation form only captures client name and email. When the
form creates a *new* booking ("Create new" mode), it silently sends blank phone and
notes to the booking API even though those fields exist on `bookings` — there's no
UI for them.

## Goals

- The client sees the session date/time directly on the invoice they receive.
- The admin can capture phone, billing address, and (when creating a new booking)
  notes from the invoice-creation form, instead of those staying blank.
- Selecting an existing booking auto-fills what's already known about that client
  (name, email, phone, date/time) rather than making the admin retype it — while
  staying editable, consistent with the original invoicing spec's "select and
  override" requirement for admin-created bookings.

## Non-goals

- Editing an already-sent invoice's session date/time or client details (invoices
  are immutable once finalized — this is an existing, accepted constraint of the
  underlying feature, not something this change addresses).
- Persisting phone or billing address locally on the `invoices` row. Stripe is the
  record of truth for those — visible via the existing "View" link on any invoice —
  and duplicating them locally adds schema/sync surface with no established need.
- A country selector on the billing address. The business operates in the US only
  (see `BUSINESS_TIME_ZONE = "America/Chicago"`); country is fixed to `"US"`.

## Design

### Session date & time

A single free-text "Session date & time" field on `InvoiceForm.tsx`, always visible
regardless of booking mode:

- **"Link existing" mode:** auto-fills from the selected booking's `start_time`/
  `end_time` via the existing `formatTimeRange()` helper (`lib/format.ts`) — the
  same helper booking confirmation emails already use, so the format is identical
  and already timezone-correct (`"Sat, Sep 20 · 3:00–4:00 PM CDT"`).
- **"Create new" mode:** auto-computed client-side from the selected appointment
  type's `duration_minutes` plus the date/time inputs, using the existing
  `addMinutesToTime`/`businessLocalToUtcIso` exports from `lib/scheduling.ts` to
  derive an end time, then the same `formatTimeRange()` call.
- **"None" mode:** blank by default; the admin types it in manually.
- In every mode the field stays editable after auto-fill. It recomputes (overwriting
  any manual edit) only when the underlying selection changes again — e.g. picking
  a different existing booking, or changing the new-booking date/time/appointment
  type.
- Optional. Capped at 140 characters — Stripe's hard limit on a custom field value
  (confirmed in `node_modules/stripe/cjs/resources/Invoices.d.ts`). Exceeding it is
  a form validation error, not a silent truncation.

On the Stripe side, a non-empty value becomes a `custom_fields` entry on invoice
creation: `[{ name: "Session", value: sessionDateTime }]`. Custom fields are
Stripe's built-in mechanism for exactly this — a labeled row shown near the top of
the hosted invoice and PDF, distinct from line items, with no effect on the total.

Locally, `invoices` gains a nullable `session_date_time text` column, set at
creation time. `InvoiceList.tsx` renders it under the client name/status line when
present, so the admin can see what each invoice is for at a glance without opening
the Stripe link.

### Client details

Three new optional inputs on `InvoiceForm.tsx`:

- **Phone** — always visible, under Client Email.
- **Billing address** — always visible: Address line 1, City, State, ZIP (country
  fixed to `"US"`, not user-facing).
- **Notes** — visible only when `bookingMode === "new"`, since that's the only mode
  where it has anywhere to go (the new booking's own `notes` column). Not shown in
  "None" or "Link existing" mode.

Auto-fill in "Link existing" mode: selecting a booking also fills Client Name,
Client Email, and Phone from that booking's stored `client_name`/`client_email`/
`client_phone` — all still editable afterward, following the same
auto-fill-but-overridable pattern as session date/time. This requires adding
`client_phone, end_time` to the bookings query in `page.tsx` (currently only
selects `id, client_name, client_email, start_time, status`).

Data flow:

- `clientPhone` and `billingAddress` are passed to `stripe.customers.create()` in
  `lib/invoices.ts` — but **only when creating a new Stripe customer**. An existing
  customer found by the existing email lookup (`stripe.customers.list`) is never
  updated, so a repeat client's already-populated (possibly more complete) Stripe
  record can't be clobbered by a blank or partial form submission.
- In "Create new" booking mode, `clientPhone` and `notes` replace the currently
  hardcoded `clientPhone: ""` / `notes: ""` sent to `POST /api/admin/bookings`.

### API surface

`POST /api/admin/invoices` body gains three optional fields:

```
sessionDateTime: string | null   // ≤ 140 chars
clientPhone: string | null       // ≤ 32 chars
billingAddress: { line1?: string; city?: string; state?: string; postalCode?: string } | null
                                  // each field ≤ 100 chars; billingAddress itself
                                  // null if every sub-field is blank/omitted
```

`parseCreatePayload` in `app/api/admin/invoices/route.ts` validates and normalizes
these the same way it already handles `bookingId`/`dueDate` (trim, null if empty,
reject with a 400 if over the relevant length cap).

### Testing

Same constraints as the rest of this feature: `tsc`/`build`/`lint`, plus live
browser interaction checks (auto-fill on booking selection and on new-booking
date/time changes, edit-after-prefill, notes field showing/hiding with booking
mode, 140-char validation). The Stripe-calling path (whether `custom_fields`/
`phone`/`address` actually reach Stripe correctly) isn't locally testable — no
`STRIPE_SECRET_KEY` in this environment — and gets verified live in production the
same way Void was verified after the original feature shipped.
