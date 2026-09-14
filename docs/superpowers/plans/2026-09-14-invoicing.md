# Invoicing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only invoicing system built on Stripe's native Invoicing product, able to bill against an existing booking, a newly admin-created booking (for off-calendar arrangements), or a fully standalone client — with itemized line items, a due date, Void, and Resend-email actions.

**Architecture:** Two new Supabase tables (`invoices`, `invoice_line_items`) mirror Stripe's own invoice state via a new webhook, exactly like the existing `bookings`/`stripe-bookings` webhook pair. A new admin-only booking-creation endpoint reuses the public booking flow's date/time-conversion helpers (extracted into `lib/scheduling.ts` for that reuse) but skips the public flow's availability window, honeypot, rate-limit, and Turnstile checks, since it's an authenticated admin action. A new `/admin/invoices` page follows this codebase's existing admin-page conventions exactly (same auth, same list/form component split, same Tailwind classes) as seen in `/admin/discount-codes`.

**Tech Stack:** Next.js App Router, Supabase (Postgres), Stripe (`stripe` npm package, native Invoicing API — `invoices`, `invoiceItems`, `customers`), Resend (existing email pattern).

## Global Constraints

- New tables `invoices`/`invoice_line_items` are purely additive — `bookings.amount_paid_cents`/`payment_intent_id` are never read or written by any invoicing code. Invoicing is a completely separate payment-tracking path.
- `invoices.status` mirrors Stripe's own invoice status exactly (`draft`, `open`, `paid`, `void`, `uncollectible`) and is only ever written by the new Stripe webhook (`app/api/webhooks/stripe-invoices/route.ts`) — no admin API route writes this column directly, matching how `bookings.status` is only ever written by `lib/bookingsWebhook.ts` or the reschedule/cancel RPCs, never directly by an admin form field.
- Every new admin API route uses this exact auth pattern (copied verbatim from `app/api/admin/discount-codes/route.ts`):
  ```ts
  import { cookies } from "next/headers";
  import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";

  async function requireAdmin(): Promise<boolean> {
    const cookieStore = await cookies();
    return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
  }
  ```
  Every handler starts with `if (!(await requireAdmin())) { return Response.json({ error: "Unauthorized." }, { status: 401 }); }`.
- The admin-created-bookings endpoint inserts with `status: 'confirmed'` directly (no `pending` hold, no payment wait) and does **not** send any client-facing email itself — the invoice email is the client's actual notification for an admin-arranged session.
- `businessLocalToUtcIso`/`addMinutesToTime` move from `app/api/bookings/route.ts` (where they're currently module-private) to `lib/scheduling.ts` as named exports — pure relocation, no behavior change. `app/api/bookings/route.ts` imports them from there afterward instead of defining them locally.
- This repo has no test framework. Verification throughout is `tsc --noEmit`, `npm run build`, `npm run lint`, `curl`, and real browser/Stripe-dashboard checks — matching every other plan in `docs/superpowers/plans/`.
- There's no migration runner in this project — `supabase/schema.sql` is a single running file, applied manually via the Supabase SQL editor. New DDL is appended at the end of the file, using `create table if not exists` (matching the most recent prior addition, `gallery_favorites`).

---

### Task 1: Schema — `invoices` and `invoice_line_items`

**Files:**
- Modify: `supabase/schema.sql` (append at end)

**Interfaces:**
- Produces: tables `invoices` (`id`, `client_name`, `client_email`, `booking_id` nullable FK to `bookings(id)`, `stripe_invoice_id` unique, `stripe_customer_id`, `status`, `due_date`, `hosted_invoice_url`, `created_at`) and `invoice_line_items` (`id`, `invoice_id` FK to `invoices(id) on delete cascade`, `description`, `amount_cents`, `sort_order`). Later tasks read/write these via `getSupabaseClient()`, matching how every other table in this schema is accessed.

- [ ] **Step 1: Append the new tables to `supabase/schema.sql`**

```sql

-- Invoicing (see docs/superpowers/specs/2026-09-14-invoicing-design.md).
-- Purely additive — never reads or writes bookings.amount_paid_cents /
-- payment_intent_id, which keep meaning exactly what they mean today for
-- the existing pay-at-booking Checkout Session flow. status mirrors
-- Stripe's own invoice status exactly and is only ever written by the
-- stripe-invoices webhook (lib/invoicesWebhook.ts) — never by an admin
-- API route directly.
create table if not exists invoices (
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

create index if not exists invoices_booking_id_idx on invoices (booking_id);
create index if not exists invoices_status_idx on invoices (status);

alter table invoices enable row level security;

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  sort_order integer not null default 0
);

alter table invoice_line_items enable row level security;
```

- [ ] **Step 2: Apply the migration**

Open the Supabase dashboard's SQL editor for this project, paste just the new block from Step 1 (not the whole file — the rest already exists), and run it.

Expected: both tables appear under Table Editor, each with RLS shown as enabled and no policies (deny-by-default, service-role only — matching every other table in this schema).

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add invoices and invoice_line_items tables"
```

---

### Task 2: Shared scheduling helpers + admin-only booking creation

**Files:**
- Modify: `lib/scheduling.ts` (add two exported functions)
- Modify: `app/api/bookings/route.ts:250-288` (remove the two functions, import them instead)
- Create: `app/api/admin/bookings/route.ts`

**Interfaces:**
- Consumes: `getTimeZoneOffsetMs` (already in `lib/scheduling.ts`, module-private — stays private, reused internally by the new export), `BUSINESS_TIME_ZONE` (already exported from `lib/scheduling.ts`).
- Produces: `export function businessLocalToUtcIso(date: string, time: string): string` and `export function addMinutesToTime(time: string, minutes: number): string` from `lib/scheduling.ts` — Task 2's own new admin route uses these; no other task depends on them directly.

- [ ] **Step 1: Add the two functions to `lib/scheduling.ts`**

Add at the end of the file:

```ts
// Anchored with "Z" so this parses as a UTC instant regardless of the
// host process's own timezone. Without the "Z", `new Date(...)` parses
// the string as local time in the *host's* timezone, which happens to
// produce the right answer when the process's TZ is UTC (true on
// Vercel/Lambda by default) but silently shifts every booking's stored
// time by the business-timezone offset — doubled — whenever the host
// isn't UTC (e.g. `next dev` on a laptop set to America/Chicago).
export function businessLocalToUtcIso(date: string, time: string): string {
  const naive = new Date(`${date}T${time}:00Z`);
  const offsetMs = getTimeZoneOffsetMs(naive, BUSINESS_TIME_ZONE);
  return new Date(naive.getTime() - offsetMs).toISOString();
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
```

Note: this reuses the file's existing private `getTimeZoneOffsetMs` helper instead of re-deriving the offset inline the way the original `app/api/bookings/route.ts` copy did (that copy predates `getTimeZoneOffsetMs` existing in this file) — same result, less duplication, since `getTimeZoneOffsetMs` already does exactly this UTC-offset computation for `businessDayUtcBounds` right above it.

- [ ] **Step 2: Update `app/api/bookings/route.ts` to import instead of defining these**

Change the import block at the top of the file from:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createFullPaymentCheckoutSession } from "@/lib/stripe";
import { sendFreeBookingConfirmedEmail, sendBookingPaymentConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { turnstileFailureResponse, verifyTurnstileToken } from "@/lib/turnstile";
import { computeDiscountedAmountCents, isDiscountCodeApplicable, type DiscountCode } from "@/lib/discountCodes";
```

to:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createFullPaymentCheckoutSession } from "@/lib/stripe";
import { sendFreeBookingConfirmedEmail, sendBookingPaymentConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { turnstileFailureResponse, verifyTurnstileToken } from "@/lib/turnstile";
import { computeDiscountedAmountCents, isDiscountCodeApplicable, type DiscountCode } from "@/lib/discountCodes";
import { businessLocalToUtcIso, addMinutesToTime } from "@/lib/scheduling";
```

Then delete the two function definitions at the bottom of the file (everything from `function businessLocalToUtcIso(date: string, time: string): string {` through the closing `}` of `addMinutesToTime`, i.e. the current lines 250-288 — the whole tail of the file after the `POST` handler's closing brace).

- [ ] **Step 3: Verify the refactor changed nothing**

Run: `npx tsc --noEmit`
Expected: no output (clean) — confirms no other file referenced the now-removed local functions.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Create `app/api/admin/bookings/route.ts`**

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { businessLocalToUtcIso, addMinutesToTime } from "@/lib/scheduling";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.appointmentTypeId !== "string" ||
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    typeof b.clientPhone !== "string" ||
    typeof b.notes !== "string"
  ) {
    return null;
  }
  return {
    appointmentTypeId: b.appointmentTypeId,
    date: b.date,
    startTime: b.startTime,
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    clientPhone: b.clientPhone.trim(),
    notes: b.notes.trim(),
  };
}

// Admin-only: creates a real `bookings` row on any date/time, including
// ones the public availability rules don't currently open — those rules
// only exist to gate the public-facing form, not the site owner. No
// honeypot, rate limiting, or Turnstile (all pointless for an
// authenticated admin action), and no availability-window check against
// fetchOpenSlotsForDate (deliberately bypassing it, per the plan). The
// database's own exclusion constraint on `bookings` still applies
// regardless of which code path inserts the row, so two confirmed
// bookings still can't occupy the same time slot.
export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Please fill out all required fields with a valid email address." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: type, error: typeError } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes")
    .eq("id", payload.appointmentTypeId)
    .maybeSingle();

  if (typeError || !type) {
    return Response.json({ error: "That appointment type was not found." }, { status: 404 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_phone: payload.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status: "confirmed",
      notes: payload.notes || null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres exclusion-violation error code — this exact time overlaps
    // an existing pending/confirmed booking.
    if (insertError.code === "23P01") {
      return Response.json({ error: "That time overlaps an existing booking." }, { status: 409 });
    }
    console.error("admin bookings insert failed:", insertError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  try {
    const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still created):", err);
  }

  await broadcastBookingChange({ date: payload.date });

  return Response.json({ booking }, { status: 201 });
}
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Verify auth is enforced**

With `npm run dev` running:
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://localhost:3000/api/admin/bookings \
  -H "Content-Type: application/json" \
  -d '{"appointmentTypeId":"00000000-0000-0000-0000-000000000000","date":"2026-01-01","startTime":"10:00","clientName":"Test","clientEmail":"test@example.com","clientPhone":"","notes":""}'
```
Expected: `401` (no admin cookie sent).

- [ ] **Step 7: Verify it creates a real booking on an off-calendar date**

Log into `/admin` in a browser (sets the admin cookie), then from the same browser session, use the dev tools console or a small fetch call to hit `/api/admin/bookings` with a real `appointmentTypeId` (from `/admin/appointment-types`) and a date you know has no public availability configured (e.g. a day of the week `availability_rules` doesn't cover). Confirm:
- The response is `201` with a `booking` object, `status: "confirmed"`.
- The booking appears on `/admin/dashboard`'s calendar view.
- If Google Calendar is connected, the event appears there too.
- Attempting the exact same date/time/appointment type again returns `409` (exclusion constraint still enforced).

- [ ] **Step 8: Commit**

```bash
git add lib/scheduling.ts app/api/bookings/route.ts app/api/admin/bookings/route.ts
git commit -m "Extract booking time helpers to lib/scheduling.ts; add admin-only booking creation"
```

---

### Task 3: Stripe invoicing core — `lib/invoices.ts`, webhook, and email

**Files:**
- Create: `lib/invoices.ts`
- Create: `lib/invoicesWebhook.ts`
- Create: `app/api/webhooks/stripe-invoices/route.ts`
- Modify: `lib/email.ts` (add `sendInvoiceEmail`)
- Modify: `.env.example` (add `STRIPE_WEBHOOK_SECRET_INVOICES`)

**Interfaces:**
- Consumes: `getStripeClient` (from `lib/stripe.ts`), `getSupabaseClient` (from `lib/supabase.ts`), `FROM_ADDRESS`/`escapeHtml` pattern (from `lib/email.ts`, matched not imported — each `sendX` function is self-contained per this file's existing convention).
- Produces: `export async function createInvoice(params): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }>` and `export async function voidInvoice(stripeInvoiceId: string): Promise<void>` from `lib/invoices.ts`; `export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void>`, `export async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void>`, `export async function handleInvoiceMarkedUncollectible(invoice: Stripe.Invoice): Promise<void>` from `lib/invoicesWebhook.ts`; `export async function sendInvoiceEmail(params: { clientName: string; clientEmail: string; hostedInvoiceUrl: string }): Promise<{ ok: true } | { ok: false; error: string }>` from `lib/email.ts`. Task 4's admin API routes consume all of these directly.

- [ ] **Step 1: Add `sendInvoiceEmail` to `lib/email.ts`**

Add at the end of the file:

```ts
// Sent from the admin invoice create/resend actions
// (app/api/admin/invoices/route.ts, app/api/admin/invoices/[id]/resend/route.ts)
// once Stripe has finalized the invoice and generated its hosted payment
// page. We send our own branded email rather than Stripe's default invoice
// notification — Stripe still handles the actual payment page, PDF, and its
// own automatic payment-reminder emails for unpaid invoices as the due date
// approaches; this only replaces the first notification.
export async function sendInvoiceEmail(params: {
  clientName: string;
  clientEmail: string;
  hostedInvoiceUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: "Your invoice",
      text: [
        `Hi ${params.clientName},`,
        "",
        "You have a new invoice. You can view and pay it here:",
        params.hostedInvoiceUrl,
        "",
        "Thanks,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(params.clientName)},</p>
        <p>You have a new invoice. You can view and pay it here:</p>
        <p><a href="${params.hostedInvoiceUrl}">${params.hostedInvoiceUrl}</a></p>
        <p>Thanks,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

- [ ] **Step 2: Create `lib/invoices.ts`**

```ts
import { getStripeClient } from "@/lib/stripe";

export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // "YYYY-MM-DD"
}): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.list({ email: params.clientEmail, limit: 1 });
  const customer =
    existing.data[0] ??
    (await stripe.customers.create({ email: params.clientEmail, name: params.clientName }));

  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
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

export async function voidInvoice(stripeInvoiceId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.invoices.voidInvoice(stripeInvoiceId);
}
```

- [ ] **Step 3: Create `lib/invoicesWebhook.ts`**

```ts
// Domain logic for Stripe webhook events touching the `invoices` table —
// kept out of app/api/webhooks/stripe-invoices/route.ts so that route
// stays a thin, signature-verified dispatcher, matching
// lib/bookingsWebhook.ts's split from app/api/webhooks/stripe-bookings/route.ts.

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("stripe_invoice_id", invoice.id);
  if (error) {
    console.error("Failed to mark invoice paid:", error);
  }
}

export async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("stripe_invoice_id", invoice.id);
  if (error) {
    console.error("Failed to mark invoice void:", error);
  }
}

export async function handleInvoiceMarkedUncollectible(invoice: Stripe.Invoice): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "uncollectible" })
    .eq("stripe_invoice_id", invoice.id);
  if (error) {
    console.error("Failed to mark invoice uncollectible:", error);
  }
}
```

- [ ] **Step 4: Create `app/api/webhooks/stripe-invoices/route.ts`**

```ts
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import {
  handleInvoicePaid,
  handleInvoiceVoided,
  handleInvoiceMarkedUncollectible,
} from "@/lib/invoicesWebhook";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_INVOICES;

  if (!signature || !webhookSecret) {
    return new Response("Missing signature.", { status: 400 });
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  if (event.type === "invoice.paid") {
    await handleInvoicePaid(event.data.object as Stripe.Invoice);
  } else if (event.type === "invoice.voided") {
    await handleInvoiceVoided(event.data.object as Stripe.Invoice);
  } else if (event.type === "invoice.marked_uncollectible") {
    await handleInvoiceMarkedUncollectible(event.data.object as Stripe.Invoice);
  }

  return Response.json({ received: true });
}
```

- [ ] **Step 5: Add the new secret to `.env.example`**

Find this existing block:
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET_BOOKINGS=
```
Replace with:
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET_BOOKINGS=
STRIPE_WEBHOOK_SECRET_INVOICES=
```

- [ ] **Step 6: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/invoices.ts lib/invoicesWebhook.ts app/api/webhooks/stripe-invoices/route.ts lib/email.ts .env.example
git commit -m "Add Stripe invoicing core: create/void, webhook handlers, invoice email"
```

---

### Task 4: Admin invoice API routes — list, create, void, resend

**Files:**
- Create: `app/api/admin/invoices/route.ts` (GET list, POST create)
- Create: `app/api/admin/invoices/[id]/void/route.ts` (POST)
- Create: `app/api/admin/invoices/[id]/resend/route.ts` (POST)

**Interfaces:**
- Consumes: `createInvoice`, `voidInvoice` (from `lib/invoices.ts`, Task 3), `sendInvoiceEmail` (from `lib/email.ts`, Task 3), the `requireAdmin()` pattern (Global Constraints).
- Produces: `POST /api/admin/invoices` accepting `{ clientName, clientEmail, bookingId: string | null, lineItems: { description: string; amountCents: number }[], dueDate: string | null }`, returning `{ invoice }` (the inserted `invoices` row) on `201`. `GET /api/admin/invoices` returning `{ invoices }` (each row plus its `invoice_line_items`, for the list view's amount-sum display). Task 5's admin UI consumes both, plus the two action routes.

- [ ] **Step 1: Create `app/api/admin/invoices/route.ts`**

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { createInvoice } from "@/lib/invoices";
import { sendInvoiceEmail } from "@/lib/email";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_line_items(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("invoices list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ invoices: data });
}

type LineItemPayload = { description: string; amountCents: number };

type CreatePayload = {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: LineItemPayload[];
  dueDate: string | null;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    (b.bookingId !== null && typeof b.bookingId !== "string") ||
    !Array.isArray(b.lineItems) ||
    b.lineItems.length === 0 ||
    !b.lineItems.every(
      (item): item is LineItemPayload =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).description === "string" &&
        ((item as Record<string, unknown>).description as string).trim().length > 0 &&
        typeof (item as Record<string, unknown>).amountCents === "number" &&
        Number.isInteger((item as Record<string, unknown>).amountCents as number) &&
        ((item as Record<string, unknown>).amountCents as number) > 0,
    ) ||
    (b.dueDate !== null && (typeof b.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)))
  ) {
    return null;
  }
  return {
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    bookingId: b.bookingId as string | null,
    lineItems: b.lineItems as LineItemPayload[],
    dueDate: b.dueDate as string | null,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid invoice." }, { status: 400 });
  }

  let created: Awaited<ReturnType<typeof createInvoice>>;
  try {
    created = await createInvoice({
      clientName: payload.clientName,
      clientEmail: payload.clientEmail,
      bookingId: payload.bookingId,
      lineItems: payload.lineItems,
      dueDate: payload.dueDate,
    });
  } catch (err) {
    console.error("Stripe invoice creation failed:", err);
    return Response.json({ error: "Failed to create invoice in Stripe." }, { status: 502 });
  }

  const supabase = getSupabaseClient();
  const { data: invoice, error: insertError } = await supabase
    .from("invoices")
    .insert({
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      booking_id: payload.bookingId,
      stripe_invoice_id: created.stripeInvoiceId,
      stripe_customer_id: created.stripeCustomerId,
      status: "open",
      due_date: payload.dueDate,
      hosted_invoice_url: created.hostedInvoiceUrl,
    })
    .select()
    .single();

  if (insertError) {
    console.error("invoices insert failed (Stripe invoice already created):", insertError);
    return Response.json({ error: "Invoice created in Stripe but failed to save locally." }, { status: 500 });
  }

  const { error: lineItemsError } = await supabase.from("invoice_line_items").insert(
    payload.lineItems.map((item, index) => ({
      invoice_id: invoice.id,
      description: item.description.trim(),
      amount_cents: item.amountCents,
      sort_order: index,
    })),
  );
  if (lineItemsError) {
    console.error("invoice_line_items insert failed:", lineItemsError);
  }

  const emailResult = await sendInvoiceEmail({
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    hostedInvoiceUrl: created.hostedInvoiceUrl,
  });
  if (!emailResult.ok) {
    console.error("Invoice email failed (invoice still created):", emailResult.error);
  }

  return Response.json({ invoice }, { status: 201 });
}
```

- [ ] **Step 2: Create `app/api/admin/invoices/[id]/void/route.ts`**

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { voidInvoice } from "@/lib/invoices";

// No local status write here — the existing invoice.voided webhook
// listener (lib/invoicesWebhook.ts, wired up in Task 3) is what flips
// invoices.status to 'void', so voiding has exactly one code path
// regardless of whether it's triggered from this admin action or
// directly in Stripe's own dashboard.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, stripe_invoice_id, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load invoice:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!invoice) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "draft" && invoice.status !== "open") {
    return Response.json({ error: "Only a draft or open invoice can be voided." }, { status: 409 });
  }

  try {
    await voidInvoice(invoice.stripe_invoice_id);
  } catch (err) {
    console.error("Stripe void failed:", err);
    return Response.json({ error: "Failed to void invoice in Stripe." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Create `app/api/admin/invoices/[id]/resend/route.ts`**

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { sendInvoiceEmail } from "@/lib/email";

// No Stripe API call at all — this only re-sends our own notification
// email using the hosted_invoice_url already stored on the row.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("client_name, client_email, hosted_invoice_url, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load invoice:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!invoice || !invoice.hosted_invoice_url) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "open") {
    return Response.json({ error: "Only an open invoice can be resent." }, { status: 409 });
  }

  const result = await sendInvoiceEmail({
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
  });

  if (!result.ok) {
    console.error("Failed to resend invoice email:", result.error);
    return Response.json({ error: "Failed to send email." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify auth is enforced on all three routes**

With `npm run dev` running:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/invoices
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices/00000000-0000-0000-0000-000000000000/void
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices/00000000-0000-0000-0000-000000000000/resend
```
Expected: `401` for all three (no admin cookie sent).

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/invoices
git commit -m "Add admin invoice API routes: list, create, void, resend"
```

---

### Task 5: Admin UI — `/admin/invoices`

**Files:**
- Create: `app/admin/invoices/page.tsx`
- Create: `app/admin/invoices/InvoiceList.tsx`
- Create: `app/admin/invoices/InvoiceForm.tsx`
- Modify: `app/admin/layout.tsx` (add nav link)

**Interfaces:**
- Consumes: `GET /api/admin/invoices`, `POST /api/admin/invoices`, `POST /api/admin/invoices/[id]/void`, `POST /api/admin/invoices/[id]/resend` (Task 4); `POST /api/admin/bookings` (Task 2); `AppointmentType` type (from `app/admin/appointment-types/AppointmentTypeList.tsx`, already existing); `formatCents` (from `lib/format.ts`, already existing).
- Produces: nothing consumed by other tasks — this is the final task.

- [ ] **Step 1: Add the nav link in `app/admin/layout.tsx`**

Change:
```ts
const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/discount-codes", label: "Discount Codes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/clients", label: "Clients" },
];
```
to:
```ts
const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/discount-codes", label: "Discount Codes" },
  { href: "/admin/invoices", label: "Invoices" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/clients", label: "Clients" },
];
```

- [ ] **Step 2: Create `app/admin/invoices/page.tsx`**

```tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import InvoiceList from "./InvoiceList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Invoices" };
}

export default async function InvoicesPage() {
  const supabase = getSupabaseClient();
  const [
    { data: invoices, error: invoicesError },
    { data: appointmentTypes, error: appointmentTypesError },
    { data: bookings, error: bookingsError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, invoice_line_items(*)")
      .order("created_at", { ascending: false }),
    supabase.from("appointment_types").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, client_name, client_email, start_time, status")
      .eq("status", "confirmed")
      .order("start_time", { ascending: false })
      .limit(200),
  ]);

  if (invoicesError) {
    console.error("invoices list failed:", invoicesError);
  }
  if (appointmentTypesError) {
    console.error("appointment_types list failed:", appointmentTypesError);
  }
  if (bookingsError) {
    console.error("bookings list failed:", bookingsError);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Invoices</h1>
      </div>
      <InvoiceList
        initialInvoices={invoices ?? []}
        appointmentTypes={appointmentTypes ?? []}
        bookings={bookings ?? []}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/admin/invoices/InvoiceForm.tsx`**

```tsx
"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  status: string;
};

type LineItem = { description: string; amount: string };

type BookingMode = "none" | "existing" | "new";

export default function InvoiceForm({
  appointmentTypes,
  bookings,
  onDone,
  onCancel,
}: {
  appointmentTypes: AppointmentType[];
  bookings: BookingOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [bookingMode, setBookingMode] = useState<BookingMode>("none");
  const [bookingSearch, setBookingSearch] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [newBookingAppointmentTypeId, setNewBookingAppointmentTypeId] = useState("");
  const [newBookingDate, setNewBookingDate] = useState("");
  const [newBookingTime, setNewBookingTime] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", amount: "" }]);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return b.client_name.toLowerCase().includes(q) || b.client_email.toLowerCase().includes(q);
  });

  function updateLineItem(index: number, field: keyof LineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { description: "", amount: "" }]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    if (!clientName.trim() || !clientEmail.trim()) {
      setError("Enter a client name and email.");
      setStatus("error");
      return;
    }

    const parsedLineItems = lineItems
      .filter((item) => item.description.trim())
      .map((item) => {
        const amount = Number(item.amount);
        return { description: item.description.trim(), amountCents: Math.round(amount * 100) };
      });

    if (
      parsedLineItems.length === 0 ||
      parsedLineItems.some((item) => !Number.isFinite(item.amountCents) || item.amountCents <= 0)
    ) {
      setError("Add at least one line item with a valid amount.");
      setStatus("error");
      return;
    }

    if (bookingMode === "new" && (!newBookingAppointmentTypeId || !newBookingDate || !newBookingTime)) {
      setError("Fill out the new booking's appointment type, date, and time.");
      setStatus("error");
      return;
    }

    try {
      let bookingId: string | null = null;

      if (bookingMode === "existing") {
        bookingId = selectedBookingId || null;
      } else if (bookingMode === "new") {
        const bookingResponse = await fetch("/api/admin/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointmentTypeId: newBookingAppointmentTypeId,
            date: newBookingDate,
            startTime: newBookingTime,
            clientName: clientName.trim(),
            clientEmail: clientEmail.trim(),
            clientPhone: "",
            notes: "",
          }),
        });
        const bookingData: { booking?: { id: string }; error?: string } = await bookingResponse.json();
        if (!bookingResponse.ok) {
          setError(bookingData.error ?? "Failed to create the booking.");
          setStatus("error");
          return;
        }
        bookingId = bookingData.booking?.id ?? null;
      }

      const response = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          bookingId,
          lineItems: parsedLineItems,
          dueDate: dueDate || null,
        }),
      });
      const data: { error?: string } = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      router.refresh();
      onDone();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4 border border-border p-6">
      <div>
        <label htmlFor="clientName" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Client name
        </label>
        <input
          id="clientName"
          type="text"
          required
          value={clientName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setClientName(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="clientEmail" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Client email
        </label>
        <input
          id="clientEmail"
          type="email"
          required
          value={clientEmail}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setClientEmail(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Booking</p>
        <div className="flex gap-4 text-sm text-foreground">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "none"}
              onChange={() => setBookingMode("none")}
              className="h-4 w-4 border-border accent-accent"
            />
            None
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "existing"}
              onChange={() => setBookingMode("existing")}
              className="h-4 w-4 border-border accent-accent"
            />
            Link existing
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "new"}
              onChange={() => setBookingMode("new")}
              className="h-4 w-4 border-border accent-accent"
            />
            Create new
          </label>
        </div>

        {bookingMode === "existing" && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              placeholder="Search by name or email"
              value={bookingSearch}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBookingSearch(e.target.value)}
              className="w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
            <select
              value={selectedBookingId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedBookingId(e.target.value)}
              className="w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Select a booking</option>
              {filteredBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.client_name} — {new Date(b.start_time).toLocaleString("en-US")}
                </option>
              ))}
            </select>
          </div>
        )}

        {bookingMode === "new" && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <select
              value={newBookingAppointmentTypeId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewBookingAppointmentTypeId(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Appointment type</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newBookingDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewBookingDate(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
            <input
              type="time"
              value={newBookingTime}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewBookingTime(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Line items</p>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateLineItem(index, "description", e.target.value)}
                className="flex-1 border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount ($)"
                value={item.amount}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateLineItem(index, "amount", e.target.value)}
                className="w-32 border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
              {lineItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLineItem(index)}
                  className="text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLineItem}
          className="mt-3 text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Add line item
        </button>
      </div>

      <div>
        <label htmlFor="dueDate" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Due date (optional — defaults to 30 days)
        </label>
        <input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDueDate(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "loading"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : "Send invoice"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={status === "loading"}
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Create `app/admin/invoices/InvoiceList.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/format";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import InvoiceForm from "./InvoiceForm";

type InvoiceLineItem = { id: string; description: string; amount_cents: number };

type Invoice = {
  id: string;
  client_name: string;
  client_email: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  due_date: string | null;
  hosted_invoice_url: string | null;
  booking_id: string | null;
  invoice_line_items: InvoiceLineItem[];
};

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  status: string;
};

function invoiceTotalCents(invoice: Invoice): number {
  return invoice.invoice_line_items.reduce((sum, item) => sum + item.amount_cents, 0);
}

function VoidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function handleVoid() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/void`, { method: "POST" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to void.");
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to void.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={handleVoid}
          disabled={pending}
          className="text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Confirm void"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-muted hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline"
    >
      Void
    </button>
  );
}

function ResendButton({ invoiceId }: { invoiceId: string }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleResend() {
    setPending(true);
    setError("");
    setSent(false);
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/resend`, { method: "POST" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to resend.");
        return;
      }
      setSent(true);
    } catch {
      setError("Failed to resend.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={pending}
        className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : sent ? "Sent!" : "Resend"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export default function InvoiceList({
  initialInvoices,
  appointmentTypes,
  bookings,
}: {
  initialInvoices: Invoice[];
  appointmentTypes: AppointmentType[];
  bookings: BookingOption[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      {creating ? (
        <InvoiceForm
          appointmentTypes={appointmentTypes}
          bookings={bookings}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New invoice
        </button>
      )}

      {initialInvoices.length === 0 ? (
        <p className="text-muted">No invoices yet.</p>
      ) : (
        <div className="border-t border-border">
          {initialInvoices.map((invoice) => (
            <div
              key={invoice.id}
              className="flex items-center justify-between gap-4 border-b border-border/60 py-4"
            >
              <div>
                <p className="text-foreground">
                  {invoice.client_name}
                  <span className="ml-2 text-xs uppercase tracking-[0.15em] text-muted">
                    {invoice.status}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {formatCents(invoiceTotalCents(invoice))}
                  {invoice.due_date ? ` · due ${new Date(invoice.due_date).toLocaleDateString("en-US")}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {invoice.hosted_invoice_url && (
                  <a
                    href={invoice.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    View
                  </a>
                )}
                {invoice.status === "open" && (
                  <>
                    <ResendButton invoiceId={invoice.id} />
                    <VoidButton invoiceId={invoice.id} />
                  </>
                )}
                {invoice.status === "draft" && <VoidButton invoiceId={invoice.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Type-check, lint, and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run lint`
Expected: no new errors beyond the pre-existing, unrelated `components/Navbar.tsx` warnings this repo already has.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Browser verification — standalone invoice**

With `npm run dev` running and logged into `/admin`:
1. Go to `/admin/invoices`. Confirm the page loads and shows "Invoices" in the nav.
2. Click **New invoice**. Fill in a client name/email, leave Booking as "None", add two line items, leave due date blank, submit.
3. Confirm it appears in the list as `open`, with the correct summed total.
4. Click **View** — confirm it opens Stripe's real hosted invoice page with both line items and a due date ~30 days out.
5. Confirm the invoice email arrived (check Resend's dashboard or the actual inbox) with a working link.

- [ ] **Step 7: Browser verification — invoice with a new off-calendar booking**

1. **New invoice** again. Fill in client name/email, select **Create new** under Booking, pick an appointment type and a date/time you know has no public availability.
2. Add a line item, submit.
3. Confirm the invoice is created (same checks as Step 6), and separately confirm a new `confirmed` booking now exists for that date/time on `/admin/dashboard`.

- [ ] **Step 8: Browser verification — Void and Resend**

1. On an `open` invoice, click **Resend** — confirm a second email arrives with the same link, and confirm in the Stripe dashboard that no duplicate invoice or customer was created.
2. Click **Void**, confirm — confirm the row's status flips to `void` (may require a manual refresh depending on webhook delivery timing) and that both **Void**/**Resend** buttons disappear for it.
3. Confirm the underlying Stripe invoice shows as voided in the Stripe dashboard too.

- [ ] **Step 9: Commit**

```bash
git add app/admin/invoices app/admin/layout.tsx
git commit -m "Add /admin/invoices UI: list, create form, void/resend actions"
```

---

## Manual Setup (for you — not part of the subagent task loop above)

1. **Create the second Stripe webhook endpoint:** Stripe dashboard → Developers → Webhooks → Add endpoint → URL `https://zkjfilms.com/api/webhooks/stripe-invoices` → subscribe to exactly `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`.
2. **Copy the new endpoint's signing secret** into `.env.local` as `STRIPE_WEBHOOK_SECRET_INVOICES`, and into Vercel's Production + Preview environment variables (same process as the existing `STRIPE_WEBHOOK_SECRET_BOOKINGS`).
3. **Apply the schema migration** (Task 1, Step 2) via the Supabase SQL editor before testing any of this locally or in production — the app will error on every invoice-related request until the tables exist.
