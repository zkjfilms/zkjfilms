# Invoicing System

## Problem

The site's only payment path today is `createFullPaymentCheckoutSession` in `lib/stripe.ts` — a single Stripe Checkout Session charged in full at the moment someone books an appointment type marked `requires_payment`. There's no way to bill a client for anything outside that one moment: a remaining balance, add-ons decided after a session (extra prints, an album, overtime), or something with no booking behind it at all (image licensing, a referral fee). There's also no way to book a client on a date/time that isn't currently open to the public — every booking, including ones the photographer arranges privately, has to go through the public availability rules.

## Goal

An admin-only invoicing system, built on Stripe's native Invoicing product (not another Checkout Session), that can bill against an existing booking, a newly admin-created booking (for off-calendar arrangements), or nothing at all — with itemized line items, a due date, and Stripe handling the hosted payment page, PDF, and payment-reminder emails.

## Design

### Data model

Two new tables, additive only — nothing here touches the existing `bookings` table's payment fields (`amount_paid_cents`, `payment_intent_id`), which keep meaning exactly what they mean today for the existing pay-at-booking flow. An invoice can cover something beyond a booking's base price, so conflating the two would misrepresent what a booking's own fields say was paid for it.

```sql
create table invoices (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_email text not null,
  booking_id uuid references bookings(id),
  stripe_invoice_id text not null unique,
  stripe_customer_id text not null,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  due_date date,
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);

create index invoices_booking_id_idx on invoices (booking_id);
create index invoices_status_idx on invoices (status);

alter table invoices enable row level security;

create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  sort_order integer not null default 0
);

alter table invoice_line_items enable row level security;
```

`booking_id` is nullable — a standalone invoice (licensing, a referral fee) has no booking at all. `status` mirrors Stripe's own invoice statuses exactly (`draft`, `open`, `paid`, `void`, `uncollectible`); Stripe is the source of truth, our column is a mirror kept in sync by a webhook, not an independently-derived state machine.

### Shared timezone helpers (small refactor, needed by the new admin-booking path)

`businessLocalToUtcIso` and `addMinutesToTime` currently live as module-private functions inside `app/api/bookings/route.ts`. The new admin booking-creation endpoint (below) needs the exact same date/time-to-UTC conversion the public booking flow already uses — duplicating it would risk the two silently drifting. Both functions move to `lib/scheduling.ts` (which already holds this project's other timezone helpers — `businessDayUtcBounds`, `utcIsoToBusinessDate`) as named exports, and `app/api/bookings/route.ts` imports them from there instead of defining them locally. Pure relocation — no behavior change to either function.

### Admin-created bookings

A new endpoint, `app/api/admin/bookings/route.ts` (`POST`), following this project's existing admin-route auth pattern exactly (`requireAdmin()` via `ADMIN_ACCESS_COOKIE`/`isValidAccessToken` from `lib/adminAccess.ts` — the same pattern `app/api/admin/appointment-types/route.ts` and every other admin route use). Given an `appointmentTypeId`, `date`, and `startTime`, it:

1. Looks up the appointment type (for `duration_minutes`, to compute `end_time` — same as the public flow).
2. Converts to UTC via the now-shared `businessLocalToUtcIso`/`addMinutesToTime`.
3. Inserts directly into `bookings` with `status: 'confirmed'` (skipping `pending` entirely — no payment hold to wait on for an admin-arranged booking) and the client details from the request.
4. Pushes to Google Calendar (`pushBookingToGoogleCalendar`, already exported from `lib/googleCalendar.ts`) and broadcasts the change (`broadcastBookingChange`, already exported from `lib/realtimeBroadcast.ts`) — reusing the exact same calls the public flow makes after a confirmed booking, so an admin-created booking is indistinguishable from a public one anywhere else in the app.

Deliberately **not** run for this endpoint: the public flow's availability-window check (`fetchOpenSlotsForDate`), honeypot, rate limiting, or Turnstile — none of those make sense for an authenticated admin action, and skipping them is exactly what "not constrained by the public availability rules" requires. The database's existing exclusion constraint on `bookings` (`exclude using gist (time_range with &&) where (status in ('pending', 'confirmed'))`) still applies regardless of which code path inserts the row, so two confirmed bookings still can't occupy the same time slot — the safety net that actually matters (no accidental double-booking) is unaffected.

No confirmation email is sent from this endpoint — the client's actual communication for an admin-arranged session is the invoice email (below), not a separate booking-confirmed email meant for the public self-serve flow.

### Stripe integration

`lib/invoices.ts` (new), the invoicing equivalent of `lib/stripe.ts`'s existing `createFullPaymentCheckoutSession`:

```ts
export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // YYYY-MM-DD
}): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.list({ email: params.clientEmail, limit: 1 });
  const customer = existing.data[0] ?? (await stripe.customers.create({
    email: params.clientEmail,
    name: params.clientName,
  }));

  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(params.dueDate).getTime() - Date.now()) / 86_400_000))
    : 30;

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    auto_advance: false,
    metadata: params.bookingId ? { bookingId: params.bookingId } : {},
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);

  return {
    stripeInvoiceId: finalized.id!,
    stripeCustomerId: customer.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url!,
  };
}
```

`stripe.invoiceItems.create` attaches pending items to the customer; `stripe.invoices.create` automatically pulls in all of that customer's pending items (Stripe's default behavior — no explicit line-item-to-invoice linking needed). `collection_method: "send_invoice"` + `auto_advance: false` means Stripe does **not** auto-email its own default invoice notification — we control sending, below. `finalizeInvoice` locks the invoice and generates `hosted_invoice_url` (the page the client pays on) and a PDF.

**Email:** a new `sendInvoiceEmail` in `lib/email.ts`, matching the existing `sendXEmail` pattern exactly (`FROM_ADDRESS`, same HTML/text structure as `sendBookingPaymentConfirmedEmail`), linking to `hostedInvoiceUrl`. This keeps every client-facing email on this site consistently branded, rather than mixing in Stripe's own default invoice email template for this one case. Stripe still handles the actual payment page, PDF, and its own automatic payment-reminder emails for unpaid invoices as the due date approaches — we only replace the *first* notification email, not the reminder/receipt emails Stripe sends afterward.

**Webhook:** `app/api/webhooks/stripe-invoices/route.ts`, structurally identical to the existing `app/api/webhooks/stripe-bookings/route.ts` (own signature verification, own secret `STRIPE_WEBHOOK_SECRET_INVOICES`, delegates to a new `lib/invoicesWebhook.ts`). Listens for `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible` — each handler looks up the `invoices` row by `stripe_invoice_id` and updates `status` to match. This is the only place `invoices.status` ever changes after creation; the admin UI never writes it directly, matching how `bookings.status` is only ever changed by the Stripe webhook or the reschedule/cancel flows, never by an admin-facing form field.

### Admin UI

`/admin/invoices`, matching every other admin page's conventions — same `AdminGate.tsx` session, same list/detail visual style as `/admin/contracts`.

- **List view:** every invoice — client, status (colored the same way `/admin/contracts`' signed/unsigned states already are), amount (sum of its line items), due date, linked booking if any (as a clickable reference).
- **Create form** (`app/admin/invoices/InvoiceForm.tsx`, client component, `POST`s to a new `app/api/admin/invoices/route.ts`):
  1. Client name + email.
  2. A booking section with three states: **link an existing booking** (search by client name/email, matching the pattern `/admin/clients` or `/admin/leads` already uses for lookups), **create a new one** (appointment-type dropdown + date/time pickers, calling `app/api/admin/bookings/route.ts` above before the invoice itself is created, so the resulting `booking_id` is available to pass into the invoice), or **none** (fully standalone).
  3. One or more line items — a repeatable description + amount row, add/remove, matching this project's existing repeatable-row UI pattern (the discount-code appointment-type multi-select or a similar existing pattern — implementer's judgment on the exact visual treatment, following whatever this codebase's closest existing repeatable-list UI already does).
  4. A due date field (optional — Stripe defaults to 30 days out if left blank, per `createInvoice`'s `daysUntilDue` fallback above).
  5. **Send** — one submit that creates the (optional) booking, then the Stripe invoice, then sends the Resend email, then redirects to the list view showing the new invoice as `open`.

### Environment variables

One new secret, added to `.env.example` alongside the existing `STRIPE_WEBHOOK_SECRET_BOOKINGS`:

```
STRIPE_WEBHOOK_SECRET_INVOICES=
```

Set up the same way the existing bookings webhook was — a second Stripe webhook endpoint pointed at `/api/webhooks/stripe-invoices`, subscribed to `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`.

### Out of scope

- Editing or voiding an invoice after it's sent (Stripe's own dashboard already covers manual voiding if ever needed; not worth duplicating in our admin UI for a first version).
- Partial payments on a single invoice (Stripe invoices are pay-in-full by default; splitting one invoice into installments is a materially different feature).
- Recurring/subscription invoicing — every invoice here is a one-off.
- Changing anything about the existing `createFullPaymentCheckoutSession` pay-at-booking flow — invoicing is additive, not a replacement.
- A client-facing invoice list or portal — clients only ever see Stripe's own hosted invoice page via the emailed link, never a page on this site.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- Apply the schema migration, confirm both new tables exist with RLS enabled (service-role-only, matching every other table in this schema).
- Confirm `businessLocalToUtcIso`/`addMinutesToTime` moved cleanly: `app/api/bookings/route.ts` still behaves identically for a normal public booking (existing behavior, not modified) after switching to the `lib/scheduling.ts` imports.
- `curl` the admin bookings endpoint without the admin cookie — confirm `401`.
- Through the admin UI: create a booking on a date with no open public availability (e.g. a day `availability_rules` doesn't cover) and confirm it succeeds, appears on `/admin/dashboard`'s calendar view, and syncs to Google Calendar.
- Confirm the database exclusion constraint still rejects an admin-created booking that overlaps an existing confirmed booking (attempt one on purpose, confirm it's rejected rather than silently double-booking).
- Create a standalone invoice (no booking) with two line items via the admin UI; confirm it appears in Stripe's dashboard as a finalized, open invoice with both items and the correct due date.
- Confirm the invoice email actually arrives (via Resend) and its link opens Stripe's real hosted invoice page.
- Pay a test invoice with a Stripe test card; confirm the webhook fires and `invoices.status` flips to `paid` in the admin list view without a page reload being required to see stale data (or on next load, at minimum).
- Void a test invoice directly in the Stripe dashboard; confirm the webhook updates `invoices.status` to `void`.
