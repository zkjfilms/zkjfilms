# Invoice Payment-Triggered Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Create new" booking mode invoices stop reserving the slot at invoice-creation time — the real booking only exists once the client pays, with the calendar and a client confirmation email updating at that moment — and appointment-type-driven line-item auto-fill becomes available in every booking mode.

**Architecture:** `InvoiceForm.tsx`'s "Create new" mode stops calling the booking-creation endpoint directly; the booking's intended details ride along in the Stripe invoice's metadata instead (the same mechanism already used for `bookingId`). The `invoice.paid` webhook reads that metadata and creates the real booking at payment time, pushing it to Google Calendar and emailing the client. A new `booking_conflict` flag and admin notification email cover the rare case where the slot got taken before payment. Separately, an appointment-type picker (reusing the existing "Create new" dropdown, or a new standalone one in the other two modes) auto-fills a line item's description and price.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres), Stripe SDK, TypeScript, Resend (email), Google Calendar API. No test framework in this repo — verification is `tsc --noEmit` / `npm run build` / `npm run lint` plus curl and browser checks, matching every other plan in `docs/superpowers/plans/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-invoice-payment-booking-design.md`.
- **No hold/reservation mechanism while an invoice is outstanding.** This is deliberate — the slot stays open to everyone until the client actually pays, so there's real pressure to pay quickly. Do not add a `pending` booking row, a `pending_expires_at` value, or any sweep/cron job for this feature.
- **Stripe metadata keys are exact and must match verbatim between the task that sets them and the task that reads them:** `pendingBookingAppointmentTypeId`, `pendingBookingDate`, `pendingBookingStartTime`, `pendingBookingClientPhone`, `pendingBookingNotes`.
- **This feature only changes "Create new" booking mode's relationship to bookings.** "Link existing" still requires an already-`confirmed` booking; "None" still has no booking at all. Neither needs any change to how bookings are created or confirmed — only the line-item auto-fill (a separate, mode-independent piece) touches those two modes.
- **`booking_conflict` is a terminal flag, not a retry signal.** Any failure to create the deferred booking (the slot got taken, the appointment type was deleted, any other insert error) sets `invoices.booking_conflict = true` and returns `{ retry: false }` from the webhook handler — Stripe must not redeliver for this outcome, since redelivery can't fix a permanently-taken slot. The invoice's `status` stays `paid` regardless — the payment is real and is never undone by this flow.
- **All admin-facing notification emails go to `BUSINESS.email`** (from `lib/seo.ts`), the same constant already used for the contact form's owner notification — not a new env var or constant.
- **The pre-send conflict-check warning is purely advisory.** It never blocks form submission — there's nothing to enforce since no hold exists.
- **Appointment-type auto-fill only ever touches line item 0.** Any additional line items the admin has added are left untouched.
- Never touch `bookings.amount_paid_cents` or `bookings.payment_intent_id` (carried over from the original invoicing plan's constraint — still applies).

---

### Task 1: Schema — add `invoices.booking_conflict`

**Files:**
- Modify: `supabase/schema.sql` (append at end of file)

**Interfaces:**
- Produces: a `booking_conflict boolean not null default false` column on `invoices`, used by Task 5 (set) and Task 7 (displayed).

- [ ] **Step 1: Append the column migration**

The file currently ends with the `session_date_time` migration line. Append this new line after it:

```sql

alter table invoices add column if not exists booking_conflict boolean not null default false;
```

- [ ] **Step 2: Verify**

Read the last 5 lines of `supabase/schema.sql` and confirm the new line is present, ends with a semicolon, and there's nothing after it.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add invoices.booking_conflict column"
```

**Do not apply this to any live/remote Supabase database.** That is a manual step owned by the repo's human maintainer.

---

### Task 2: `lib/email.ts` — three new email functions

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (self-contained).
- Produces, for Task 5 and Task 4 to call:
  ```ts
  sendInvoiceSentNotification(params: {
    clientName: string;
    clientEmail: string;
    hostedInvoiceUrl: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>

  sendInvoiceBookingConfirmedEmail(
    booking: {
      client_name: string;
      client_email: string;
      start_time: string;
      end_time: string;
      booking_token: string;
      appointment_types: { name: string } | { name: string }[] | null;
    },
  ): Promise<{ ok: true } | { ok: false; error: string }>

  sendInvoiceBookingConflictEmail(params: {
    clientName: string;
    clientEmail: string;
    hostedInvoiceUrl: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>
  ```

- [ ] **Step 1: Add the three functions to the end of `lib/email.ts`**

Read the current file first to confirm it still matches — it was last touched by commit `b32c052` and ends with `sendInvoiceEmail`. Append this to the end of the file (after the closing brace of `sendInvoiceEmail`):

```ts

// Sent to the site owner (BUSINESS.email) alongside the client-facing
// sendInvoiceEmail, from both the initial create and the Resend action
// (app/api/admin/invoices/route.ts, app/api/admin/invoices/[id]/resend/route.ts).
// Gives the owner a standing record of every invoice that actually went out,
// without having to check the admin dashboard.
export async function sendInvoiceSentNotification(params: {
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
      to: [BUSINESS.email],
      subject: `Invoice sent to ${params.clientName}`,
      text: [
        `An invoice was sent to ${params.clientName} (${params.clientEmail}).`,
        "",
        "View it here:",
        params.hostedInvoiceUrl,
      ].join("\n"),
      html: `
        <p>An invoice was sent to ${escapeHtml(params.clientName)} (${escapeHtml(params.clientEmail)}).</p>
        <p>View it here:</p>
        <p><a href="${params.hostedInvoiceUrl}">${params.hostedInvoiceUrl}</a></p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent from the stripe-invoices webhook (lib/invoicesWebhook.ts) once a
// "Create new" mode invoice's payment confirms and the real booking gets
// created. Modeled on sendBookingPaymentConfirmedEmail's template but kept
// as its own function rather than reusing that one directly —
// sendBookingPaymentConfirmedEmail is built around amount_paid_cents and
// discount-code fields on the booking record, which invoicing intentionally
// never touches.
export async function sendInvoiceBookingConfirmedEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `Your payment is in — you're confirmed for ${typeName} on ${when}.`,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>Your payment is in — you're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent to the site owner (BUSINESS.email) from the stripe-invoices webhook
// (lib/invoicesWebhook.ts) when a "Create new" mode invoice gets paid but
// the deferred booking can't be created (most often: someone else took the
// slot while the invoice sat unpaid). The invoice stays marked paid —
// resolving the conflict (a new time, a refund) is a manual, out-of-band
// step; this email is the only signal that one's needed.
export async function sendInvoiceBookingConflictEmail(params: {
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
      to: [BUSINESS.email],
      subject: `Action needed: reschedule ${params.clientName}`,
      text: [
        `${params.clientName} (${params.clientEmail}) paid their invoice, but the time slot it was for is no longer available.`,
        "",
        "The invoice is still marked paid. You'll need to reach out and arrange a new time (or a refund).",
        "",
        "Invoice:",
        params.hostedInvoiceUrl,
      ].join("\n"),
      html: `
        <p>${escapeHtml(params.clientName)} (${escapeHtml(params.clientEmail)}) paid their invoice, but the time slot it was for is no longer available.</p>
        <p>The invoice is still marked paid. You'll need to reach out and arrange a new time (or a refund).</p>
        <p>Invoice:</p>
        <p><a href="${params.hostedInvoiceUrl}">${params.hostedInvoiceUrl}</a></p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

Note: `sendInvoiceBookingConfirmedEmail` uses the file's existing (unexported) `BookingForEmail` type and `appointmentTypeName` helper, both already defined earlier in this file — no new imports needed, and no need to export `BookingForEmail`, since the caller (Task 5) will pass a plain object that structurally matches it.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly (exit 0).

- [ ] **Step 3: Commit**

```bash
git add lib/email.ts
git commit -m "Add invoice-sent, booking-confirmed, and booking-conflict email notifications"
```

---

### Task 3: `lib/invoices.ts` — optional `newBooking` param

**Files:**
- Modify: `lib/invoices.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (self-contained).
- Produces: `createInvoice(params)` gains an optional field:
  ```ts
  newBooking?: {
    appointmentTypeId: string;
    date: string; // "YYYY-MM-DD"
    startTime: string; // "HH:MM"
    clientPhone: string;
    notes: string;
  } | null;
  ```
  Task 4 calls `createInvoice` passing this field. Since it's optional, this task alone compiles standalone — Task 4 (the only caller) doesn't need to change in this task for the build to stay green.

- [ ] **Step 1: Replace the file content**

Read the current file first to confirm it still matches — it was last touched by commit `b32c052`. Replace the entire file with:

```ts
import { getStripeClient } from "@/lib/stripe";

export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // "YYYY-MM-DD"
  sessionDateTime: string | null;
  clientPhone: string | null;
  billingAddress: { line1: string; city: string; state: string; postalCode: string } | null;
  newBooking?: {
    appointmentTypeId: string;
    date: string; // "YYYY-MM-DD"
    startTime: string; // "HH:MM"
    clientPhone: string;
    notes: string;
  } | null;
}): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.list({ email: params.clientEmail, limit: 1 });
  // Phone and billing address are only ever attached to a brand-new Stripe
  // customer — this branch. An existing customer found by email above is
  // never updated, so a repeat client's already-populated (possibly more
  // complete) Stripe record can't be clobbered by a blank or partial form.
  const customer =
    existing.data[0] ??
    (await stripe.customers.create({
      email: params.clientEmail,
      name: params.clientName,
      phone: params.clientPhone ?? undefined,
      address: params.billingAddress
        ? {
            line1: params.billingAddress.line1 || undefined,
            city: params.billingAddress.city || undefined,
            state: params.billingAddress.state || undefined,
            postal_code: params.billingAddress.postalCode || undefined,
            country: "US",
          }
        : undefined,
    }));

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

  // "Create new" mode invoices don't create a real booking synchronously —
  // the intended session details ride along in this invoice's Stripe
  // metadata instead, the same mechanism already used for bookingId. The
  // stripe-invoices webhook (lib/invoicesWebhook.ts) reads these exact keys
  // back out once the invoice is actually paid, and creates the real
  // booking at that point — see that file for why (no hold on an unpaid
  // invoice is deliberate).
  const metadata = params.bookingId
    ? { bookingId: params.bookingId }
    : params.newBooking
      ? {
          pendingBookingAppointmentTypeId: params.newBooking.appointmentTypeId,
          pendingBookingDate: params.newBooking.date,
          pendingBookingStartTime: params.newBooking.startTime,
          pendingBookingClientPhone: params.newBooking.clientPhone,
          pendingBookingNotes: params.newBooking.notes,
        }
      : {};

  // Create the invoice first, then attach line items directly to it by ID.
  // Creating items on the customer before the invoice exists would make them
  // "pending invoice items" — Stripe's default pending_invoice_items_behavior
  // is "include", which sweeps in every pending item on the customer,
  // including ones left over from a prior failed attempt. pending_invoice_items_behavior:
  // "exclude" is defense-in-depth in case any pending items exist on this customer.
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    metadata,
    // Stripe's built-in mechanism for a labeled, non-billable row on the
    // hosted invoice/PDF — distinct from line items, doesn't affect the
    // total. Up to 4 allowed; this feature only ever sends one.
    custom_fields: params.sessionDateTime ? [{ name: "Session", value: params.sessionDateTime }] : undefined,
  });

  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

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

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly. No other file references `newBooking` yet, so nothing else should change.

- [ ] **Step 3: Commit**

```bash
git add lib/invoices.ts
git commit -m "Add optional newBooking param to createInvoice, carried as Stripe metadata"
```

---

### Task 4: `app/api/admin/invoices/route.ts` + `.../resend/route.ts`

**Files:**
- Modify: `app/api/admin/invoices/route.ts`
- Modify: `app/api/admin/invoices/[id]/resend/route.ts`

**Interfaces:**
- Consumes: `createInvoice(params)` from Task 3 (its optional `newBooking` field), `sendInvoiceSentNotification` from Task 2.
- Produces: `POST /api/admin/invoices` accepts a new optional top-level field:
  ```ts
  newBooking?: {
    appointmentTypeId: string;
    date: string; // "YYYY-MM-DD"
    startTime: string; // "HH:MM"
    clientPhone: string;
    notes: string;
  } | null;
  ```
  Task 6's `InvoiceForm.tsx` sends this exact shape (or omits it / sends `null`) in the request body.

- [ ] **Step 1: Replace `app/api/admin/invoices/route.ts`**

Read the current file first to confirm it still matches — it was last touched by commit `b32c052`. Replace the entire file with:

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { createInvoice } from "@/lib/invoices";
import { sendInvoiceEmail, sendInvoiceSentNotification } from "@/lib/email";

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

type BillingAddressPayload = { line1: string; city: string; state: string; postalCode: string } | null;

type NewBookingPayload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientPhone: string;
  notes: string;
};

type CreatePayload = {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: LineItemPayload[];
  dueDate: string | null;
  sessionDateTime: string | null;
  clientPhone: string | null;
  billingAddress: BillingAddressPayload;
  newBooking: NewBookingPayload | null;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBillingAddress(value: unknown): { value: BillingAddressPayload; valid: boolean } {
  if (value === null || value === undefined) return { value: null, valid: true };
  if (typeof value !== "object") return { value: null, valid: false };
  const v = value as Record<string, unknown>;
  const fields = ["line1", "city", "state", "postalCode"] as const;
  const parsed: Record<string, string> = {};
  for (const field of fields) {
    const raw = v[field];
    if (raw === undefined) {
      parsed[field] = "";
      continue;
    }
    if (typeof raw !== "string" || raw.trim().length > 100) return { value: null, valid: false };
    parsed[field] = raw.trim();
  }
  const isBlank = fields.every((field) => !parsed[field]);
  if (isBlank) return { value: null, valid: true };
  return {
    value: { line1: parsed.line1, city: parsed.city, state: parsed.state, postalCode: parsed.postalCode },
    valid: true,
  };
}

function parseNewBooking(value: unknown): { value: NewBookingPayload | null; valid: boolean } {
  if (value === null || value === undefined) return { value: null, valid: true };
  if (typeof value !== "object") return { value: null, valid: false };
  const v = value as Record<string, unknown>;
  if (
    typeof v.appointmentTypeId !== "string" ||
    !v.appointmentTypeId.trim() ||
    typeof v.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
    typeof v.startTime !== "string" ||
    !v.startTime.trim() ||
    typeof v.clientPhone !== "string" ||
    typeof v.notes !== "string"
  ) {
    return { value: null, valid: false };
  }
  return {
    value: {
      appointmentTypeId: v.appointmentTypeId,
      date: v.date,
      startTime: v.startTime,
      clientPhone: v.clientPhone.trim(),
      notes: v.notes.trim(),
    },
    valid: true,
  };
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const { value: billingAddress, valid: billingAddressValid } = parseBillingAddress(b.billingAddress);
  const { value: newBooking, valid: newBookingValid } = parseNewBooking(b.newBooking);

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
    (b.dueDate !== null && (typeof b.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))) ||
    (b.sessionDateTime !== null &&
      b.sessionDateTime !== undefined &&
      (typeof b.sessionDateTime !== "string" || b.sessionDateTime.trim().length > 140)) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.trim().length > 32)) ||
    !billingAddressValid ||
    !newBookingValid
  ) {
    return null;
  }
  return {
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    bookingId: b.bookingId as string | null,
    lineItems: b.lineItems as LineItemPayload[],
    dueDate: b.dueDate as string | null,
    sessionDateTime: typeof b.sessionDateTime === "string" && b.sessionDateTime.trim() ? b.sessionDateTime.trim() : null,
    clientPhone: typeof b.clientPhone === "string" && b.clientPhone.trim() ? b.clientPhone.trim() : null,
    billingAddress,
    newBooking,
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
      sessionDateTime: payload.sessionDateTime,
      clientPhone: payload.clientPhone,
      billingAddress: payload.billingAddress,
      newBooking: payload.newBooking,
    });
  } catch (err) {
    console.error("Stripe invoice creation failed:", err);
    return Response.json({ error: "Failed to create invoice in Stripe." }, { status: 502 });
  }

  const supabase = getSupabaseClient();

  // The full row includes session_date_time — a column that can, in
  // principle, not exist yet on a given deployment if a migration hasn't
  // landed (this happened live once already: the app deployed before the
  // matching `alter table` ran). If that insert fails for any reason, the
  // Stripe invoice above is already real and finalized — retry once with
  // only the table's original eight columns, so the invoice still ends up
  // as a manageable local row (voidable/resendable from the admin UI)
  // rather than an orphan only reachable from the Stripe Dashboard.
  const fullRow = {
    client_name: payload.clientName,
    client_email: payload.clientEmail,
    booking_id: payload.bookingId,
    stripe_invoice_id: created.stripeInvoiceId,
    stripe_customer_id: created.stripeCustomerId,
    status: "open" as const,
    due_date: payload.dueDate,
    hosted_invoice_url: created.hostedInvoiceUrl,
    session_date_time: payload.sessionDateTime,
  };

  let { data: invoice, error: insertError } = await supabase
    .from("invoices")
    .insert(fullRow)
    .select()
    .single();

  if (insertError) {
    console.error("invoices insert failed for full row, retrying with core columns only:", insertError);
    const coreRow = {
      client_name: fullRow.client_name,
      client_email: fullRow.client_email,
      booking_id: fullRow.booking_id,
      stripe_invoice_id: fullRow.stripe_invoice_id,
      stripe_customer_id: fullRow.stripe_customer_id,
      status: fullRow.status,
      due_date: fullRow.due_date,
      hosted_invoice_url: fullRow.hosted_invoice_url,
    };
    const fallback = await supabase.from("invoices").insert(coreRow).select().single();
    invoice = fallback.data;
    insertError = fallback.error;
    if (invoice) {
      console.warn("Invoice saved with a degraded row (session_date_time dropped):", created.stripeInvoiceId);
    }
  }

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
  } else {
    const notifyResult = await sendInvoiceSentNotification({
      clientName: payload.clientName,
      clientEmail: payload.clientEmail,
      hostedInvoiceUrl: created.hostedInvoiceUrl,
    });
    if (!notifyResult.ok) {
      console.error("Invoice-sent admin notification failed:", notifyResult.error);
    }
  }

  return Response.json({ invoice }, { status: 201 });
}
```

- [ ] **Step 2: Replace `app/api/admin/invoices/[id]/resend/route.ts`**

Read the current file first to confirm it still matches. Replace the entire file with:

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { sendInvoiceEmail, sendInvoiceSentNotification } from "@/lib/email";

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

  const notifyResult = await sendInvoiceSentNotification({
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
  });
  if (!notifyResult.ok) {
    console.error("Invoice-sent admin notification failed:", notifyResult.error);
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly.

- [ ] **Step 4: Live-test the 401 and validation paths**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices -d '{}'
```

Expected: `401` (no admin cookie). Stop the dev server when done. `STRIPE_SECRET_KEY` may not be set in this environment — if it isn't, the success path can't be tested locally; note this in your report rather than attempting to fake it.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/invoices/route.ts "app/api/admin/invoices/[id]/resend/route.ts"
git commit -m "Accept newBooking on invoice creation; send invoice-sent admin notification"
```

---

### Task 5: `lib/invoicesWebhook.ts` — create the deferred booking on payment

**Files:**
- Modify: `lib/invoicesWebhook.ts`

**Interfaces:**
- Consumes: the exact metadata keys Task 3 sets (`pendingBookingAppointmentTypeId`, `pendingBookingDate`, `pendingBookingStartTime`, `pendingBookingClientPhone`, `pendingBookingNotes`); `sendInvoiceBookingConfirmedEmail`/`sendInvoiceBookingConflictEmail` from Task 2; the `booking_conflict` column from Task 1.
- Produces: no new exports — `handleInvoicePaid`'s exported signature (`(invoice: Stripe.Invoice) => Promise<{ retry: boolean }>`) is unchanged; only its internal behavior grows.

- [ ] **Step 1: Replace the file content**

Read the current file first to confirm it still matches — it was last touched by commit `6ffeabf` (from the original invoicing plan) and has not changed since. Replace the entire file with:

```ts
// Domain logic for Stripe webhook events touching the `invoices` table —
// kept out of app/api/webhooks/stripe-invoices/route.ts so that route
// stays a thin, signature-verified dispatcher, matching
// lib/bookingsWebhook.ts's split from app/api/webhooks/stripe-bookings/route.ts.

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { businessLocalToUtcIso, addMinutesToTime } from "@/lib/scheduling";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { sendInvoiceBookingConfirmedEmail, sendInvoiceBookingConflictEmail } from "@/lib/email";

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id, booking_id, client_name, client_email, hosted_invoice_url")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice paid:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }

  // "Create new" mode invoices don't create a real booking until payment —
  // the intended session details ride along in this invoice's Stripe
  // metadata instead (see lib/invoices.ts's createInvoice). If this invoice
  // doesn't carry that intent, or already has a booking linked, there's
  // nothing more to do.
  const meta = invoice.metadata;
  if (data.booking_id || !meta || !meta.pendingBookingAppointmentTypeId) {
    return { retry: false };
  }

  const appointmentTypeId = meta.pendingBookingAppointmentTypeId;
  const date = meta.pendingBookingDate;
  const startTime = meta.pendingBookingStartTime;
  const clientPhone = meta.pendingBookingClientPhone ?? "";
  const notes = meta.pendingBookingNotes ?? "";

  const { data: type } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes")
    .eq("id", appointmentTypeId)
    .maybeSingle();

  // Any failure past this point — most likely the database's exclusion
  // constraint rejecting an overlapping booking because someone else took
  // the slot while this invoice sat unpaid, but a deleted appointment type
  // or any other insert error is treated the same way — means the payment
  // is real but the reservation isn't. Flag it for the admin rather than
  // retrying: this is a terminal state for a human to resolve (a new time,
  // a refund), not a transient failure Stripe redelivery would fix.
  let booking: {
    id: string;
    client_name: string;
    client_email: string;
    start_time: string;
    end_time: string;
    booking_token: string;
  } | null = null;

  if (type) {
    const startIso = businessLocalToUtcIso(date, startTime);
    const endIso = businessLocalToUtcIso(date, addMinutesToTime(startTime, type.duration_minutes));
    const { data: insertedBooking, error: insertError } = await supabase
      .from("bookings")
      .insert({
        appointment_type_id: type.id,
        client_name: data.client_name,
        client_email: data.client_email,
        client_phone: clientPhone || null,
        start_time: startIso,
        end_time: endIso,
        status: "confirmed",
        notes: notes || null,
      })
      .select()
      .single();
    if (insertError) {
      console.error("Deferred booking creation failed for invoice", data.id, insertError);
    } else {
      booking = insertedBooking;
    }
  } else {
    console.error("Deferred booking creation failed: appointment type not found for invoice", data.id);
  }

  if (!booking) {
    await supabase.from("invoices").update({ booking_conflict: true }).eq("id", data.id);
    const conflictEmail = await sendInvoiceBookingConflictEmail({
      clientName: data.client_name,
      clientEmail: data.client_email,
      hostedInvoiceUrl: data.hosted_invoice_url ?? "",
    });
    if (!conflictEmail.ok) {
      console.error("Booking-conflict admin notification failed:", conflictEmail.error);
    }
    return { retry: false };
  }

  await supabase.from("invoices").update({ booking_id: booking.id }).eq("id", data.id);

  try {
    const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type!.name } });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still created):", err);
  }

  await broadcastBookingChange({ date });

  const confirmEmail = await sendInvoiceBookingConfirmedEmail({
    client_name: booking.client_name,
    client_email: booking.client_email,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_token: booking.booking_token,
    appointment_types: { name: type!.name },
  });
  if (!confirmEmail.ok) {
    console.error("Booking-confirmed email failed (booking still created):", confirmEmail.error);
  }

  return { retry: false };
}

export async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice void:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }
  return { retry: false };
}

export async function handleInvoiceMarkedUncollectible(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "uncollectible" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice uncollectible:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }
  return { retry: false };
}
```

Note: `type!.name` uses a non-null assertion — safe here because `booking` is only ever set inside the `if (type)` branch, so by the time `booking` is truthy, `type` is guaranteed non-null too. This matches the existing non-null-assertion style already used elsewhere in this codebase (e.g. `invoice.id!`, `finalized.id!` in `lib/invoices.ts`).

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly.

- [ ] **Step 3: Note on testing**

This handler is only reachable via a real Stripe webhook delivery, which requires `STRIPE_SECRET_KEY` and a configured webhook endpoint — neither is available in most environments this session has used. Verify correctness by reading the code carefully instead: confirm the metadata key names match Task 3's exactly, confirm the early-return guard (`data.booking_id || !meta || !meta.pendingBookingAppointmentTypeId`) correctly skips both "already has a booking" and "not a deferred-booking invoice" cases, and confirm `booking_conflict` gets set (not a retry) on every failure path. Note this environment limitation in your report rather than attempting to fake a live test.

- [ ] **Step 4: Commit**

```bash
git add lib/invoicesWebhook.ts
git commit -m "Create the deferred booking on invoice payment, or flag a conflict"
```

---

### Task 6: `app/admin/invoices/InvoiceForm.tsx` — deferred booking, auto-fill, conflict warning

**Files:**
- Modify: `app/admin/invoices/InvoiceForm.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/invoices` body shape from Task 4 (`newBooking` field). `GET /api/admin/day-view?date=YYYY-MM-DD` (existing, unchanged endpoint) returns `{ bookings: { start_time: string; end_time: string; ... }[] | null, ... }` for that business-local day, filtered to `status in ('confirmed', 'pending')`.
- Produces: no new exports — this is a leaf client component. Task 7 (`InvoiceList.tsx`) does not depend on anything new from this task.

- [ ] **Step 1: Replace the file content**

Read the current file first to confirm it still matches — it was last touched by commit `b32c052`. Replace the entire file with:

```tsx
"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import { addMinutesToTime, businessLocalToUtcIso } from "@/lib/scheduling";
import { formatTimeRange } from "@/lib/format";

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  start_time: string;
  end_time: string;
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
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [bookingMode, setBookingMode] = useState<BookingMode>("none");
  const [bookingSearch, setBookingSearch] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [newBookingAppointmentTypeId, setNewBookingAppointmentTypeId] = useState("");
  const [newBookingDate, setNewBookingDate] = useState("");
  const [newBookingTime, setNewBookingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [pricingAppointmentTypeId, setPricingAppointmentTypeId] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", amount: "" }]);
  const [dueDate, setDueDate] = useState("");
  const [conflictWarning, setConflictWarning] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return b.client_name.toLowerCase().includes(q) || b.client_email.toLowerCase().includes(q);
  });

  // "Link existing": selecting a booking fills in what's already known about
  // that client — still editable afterward. Adjusted during render (not in an effect)
  // per React's own guidance for syncing state when a prop/selection changes —
  // avoids the extra render an effect-based sync would cause, and the lint rule
  // that flags setState inside effects for exactly this reason. The key folds in
  // bookingMode (empty string whenever this mode isn't active) so leaving and
  // re-entering "existing" — even with the same booking still selected — re-syncs,
  // matching what a bookingMode-dependent effect would have done. Initializing the
  // synced-key state from the current key (not a sentinel that can never match)
  // avoids a harmless-but-wasteful first render.
  const existingKey = bookingMode === "existing" ? selectedBookingId : "";
  const [syncedExistingKey, setSyncedExistingKey] = useState(existingKey);
  if (existingKey !== syncedExistingKey) {
    setSyncedExistingKey(existingKey);
    const booking = bookingMode === "existing" ? bookings.find((b) => b.id === existingKey) : undefined;
    if (booking) {
      setClientName(booking.client_name);
      setClientEmail(booking.client_email);
      setPhone(booking.client_phone ?? "");
      setSessionDateTime(formatTimeRange(booking.start_time, booking.end_time));
    }
  }

  // "Create new": recompute the session date/time display string whenever the
  // new booking's appointment type, date, or time changes, or when re-entering
  // this mode (same bookingMode-folding rationale as above). Uses the same
  // duration + timezone helpers the admin-booking-creation endpoint itself
  // uses, so the displayed range matches what actually gets booked — except
  // addMinutesToTime doesn't wrap past 24:00 (e.g. "23:00" + 120 minutes
  // returns "25:00", not "01:00"), which would make businessLocalToUtcIso
  // build an invalid Date and throw. Skip the auto-fill rather than crash the
  // form in that case; the admin can still type the session time in by hand.
  const newBookingKey =
    bookingMode === "new" ? `${newBookingAppointmentTypeId}|${newBookingDate}|${newBookingTime}` : "";
  const [syncedNewBookingKey, setSyncedNewBookingKey] = useState(newBookingKey);
  if (newBookingKey !== syncedNewBookingKey) {
    setSyncedNewBookingKey(newBookingKey);
    if (bookingMode === "new" && newBookingAppointmentTypeId && newBookingDate && newBookingTime) {
      const type = appointmentTypes.find((t) => t.id === newBookingAppointmentTypeId);
      if (type) {
        const endTime = addMinutesToTime(newBookingTime, type.duration_minutes);
        const [endHours] = endTime.split(":").map(Number);
        if (endHours < 24) {
          const startIso = businessLocalToUtcIso(newBookingDate, newBookingTime);
          const endIso = businessLocalToUtcIso(newBookingDate, endTime);
          setSessionDateTime(formatTimeRange(startIso, endIso));
        }
      }
    }
  }

  // Appointment-type-driven line-item auto-fill: fires whenever the relevant
  // appointment-type selection changes — the "Create new" mode dropdown
  // above (reused for this second purpose) or the standalone pricing-only
  // dropdown rendered near Line Items in "None"/"Link existing" modes.
  // Deliberately keyed only on the appointment-type id, not date/time, so
  // changing the date in "Create new" mode doesn't re-trigger a price
  // overwrite. Same render-time-sync pattern as the two blocks above; only
  // ever touches line item 0, leaving any additional line items alone.
  const priceAppointmentTypeId = bookingMode === "new" ? newBookingAppointmentTypeId : pricingAppointmentTypeId;
  const [syncedPriceAppointmentTypeId, setSyncedPriceAppointmentTypeId] = useState(priceAppointmentTypeId);
  if (priceAppointmentTypeId !== syncedPriceAppointmentTypeId) {
    setSyncedPriceAppointmentTypeId(priceAppointmentTypeId);
    const type = appointmentTypes.find((t) => t.id === priceAppointmentTypeId);
    if (type) {
      setLineItems((prev) => {
        const next = [...prev];
        next[0] = { description: type.name, amount: (type.price_cents / 100).toFixed(2) };
        return next;
      });
    }
  }

  // Non-blocking heads-up for "Create new" mode: since the slot is no longer
  // held while the invoice is unpaid, check whether the picked time already
  // has a confirmed/pending booking, so the admin isn't caught by surprise
  // later — informational only, never blocks submission. This is a genuine
  // async effect (a network fetch with cancellation), unlike the three
  // render-time sync blocks above — it belongs in useEffect because it's
  // reaching out to an external system, not deriving state that was already
  // available synchronously.
  useEffect(() => {
    if (bookingMode !== "new" || !newBookingAppointmentTypeId || !newBookingDate || !newBookingTime) {
      setConflictWarning(false);
      return;
    }
    const type = appointmentTypes.find((t) => t.id === newBookingAppointmentTypeId);
    if (!type) {
      setConflictWarning(false);
      return;
    }
    const endTime = addMinutesToTime(newBookingTime, type.duration_minutes);
    const [endHours] = endTime.split(":").map(Number);
    if (endHours >= 24) {
      setConflictWarning(false);
      return;
    }
    const startIso = businessLocalToUtcIso(newBookingDate, newBookingTime);
    const endIso = businessLocalToUtcIso(newBookingDate, endTime);
    let cancelled = false;
    fetch(`/api/admin/day-view?date=${newBookingDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bookings?: { start_time: string; end_time: string }[] | null } | null) => {
        if (cancelled || !data?.bookings) return;
        const overlaps = data.bookings.some(
          (b) => new Date(b.start_time) < new Date(endIso) && new Date(b.end_time) > new Date(startIso),
        );
        setConflictWarning(overlaps);
      })
      .catch(() => {
        if (!cancelled) setConflictWarning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingMode, newBookingAppointmentTypeId, newBookingDate, newBookingTime, appointmentTypes]);

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

    if (sessionDateTime.length > 140) {
      setError("Session date & time must be 140 characters or fewer.");
      setStatus("error");
      return;
    }

    if (phone.trim().length > 32) {
      setError("Phone must be 32 characters or fewer.");
      setStatus("error");
      return;
    }

    if (
      addressLine1.trim().length > 100 ||
      addressCity.trim().length > 100 ||
      addressState.trim().length > 100 ||
      addressPostalCode.trim().length > 100
    ) {
      setError("Billing address fields must be 100 characters or fewer.");
      setStatus("error");
      return;
    }

    const nonEmptyLineItems = lineItems.filter(
      (item) => item.description.trim() || item.amount.trim(),
    );

    if (nonEmptyLineItems.length === 0) {
      setError("Add at least one line item with a description and amount.");
      setStatus("error");
      return;
    }

    const parsedLineItems: { description: string; amountCents: number }[] = [];
    for (const item of nonEmptyLineItems) {
      const amount = Number(item.amount);
      if (!item.description.trim() || !Number.isFinite(amount) || amount <= 0) {
        setError("Every line item needs a description and a valid amount.");
        setStatus("error");
        return;
      }
      parsedLineItems.push({ description: item.description.trim(), amountCents: Math.round(amount * 100) });
    }

    if (bookingMode === "new" && (!newBookingAppointmentTypeId || !newBookingDate || !newBookingTime)) {
      setError("Fill out the new booking's appointment type, date, and time.");
      setStatus("error");
      return;
    }

    if (bookingMode === "existing" && !selectedBookingId) {
      setError('Select a booking to link, or choose "None".');
      setStatus("error");
      return;
    }

    const billingAddress =
      addressLine1.trim() || addressCity.trim() || addressState.trim() || addressPostalCode.trim()
        ? {
            line1: addressLine1.trim(),
            city: addressCity.trim(),
            state: addressState.trim(),
            postalCode: addressPostalCode.trim(),
          }
        : null;

    let bookingId: string | null = null;
    let newBooking: {
      appointmentTypeId: string;
      date: string;
      startTime: string;
      clientPhone: string;
      notes: string;
    } | null = null;

    if (bookingMode === "existing") {
      bookingId = selectedBookingId || null;
    } else if (bookingMode === "new") {
      newBooking = {
        appointmentTypeId: newBookingAppointmentTypeId,
        date: newBookingDate,
        startTime: newBookingTime,
        clientPhone: phone.trim(),
        notes: notes.trim(),
      };
    }

    try {
      const response = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          bookingId,
          newBooking,
          lineItems: parsedLineItems,
          dueDate: dueDate || null,
          sessionDateTime: sessionDateTime.trim() || null,
          clientPhone: phone.trim() || null,
          billingAddress,
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
        <label htmlFor="phone" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Phone (optional)
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Billing address (optional)</p>
        <input
          type="text"
          placeholder="Address line 1"
          value={addressLine1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressLine1(e.target.value)}
          className="mb-3 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <input
            type="text"
            placeholder="City"
            value={addressCity}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressCity(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="State"
            value={addressState}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressState(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="ZIP"
            value={addressPostalCode}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressPostalCode(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
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
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            {conflictWarning && (
              <p className="text-xs text-amber-700">⚠ This time already has a booking.</p>
            )}
            <div>
              <label htmlFor="notes" className="block text-xs uppercase tracking-[0.15em] text-muted">
                Notes (optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                rows={2}
                className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="sessionDateTime" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Session date &amp; time (shown on invoice)
        </label>
        <input
          id="sessionDateTime"
          type="text"
          value={sessionDateTime}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSessionDateTime(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        {bookingMode !== "new" && (
          <div className="mb-3">
            <label htmlFor="pricingAppointmentType" className="block text-xs uppercase tracking-[0.15em] text-muted">
              Appointment type (optional — auto-fills a line item)
            </label>
            <select
              id="pricingAppointmentType"
              value={pricingAppointmentTypeId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setPricingAppointmentTypeId(e.target.value)}
              className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Select appointment type</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
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

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly. Pay particular attention to lint here — `react-hooks/set-state-in-effect` bit this exact file earlier today; the new `useEffect` in this task is a legitimate exception (an async fetch, not synchronously-derivable state) and should not trigger it, but confirm `npm run lint` actually exits 0, don't just eyeball the output.

- [ ] **Step 3: Live-test in the browser**

`STRIPE_SECRET_KEY` may not be set in this environment — if it isn't, the actual submit-to-Stripe path can't be exercised locally; don't attempt it. Everything below is pure client-side interaction:

1. Start `npm run dev`, log into `/admin` (an admin cookie should already be present in this environment's browser from prior sessions — if not, note that in your report), navigate to `/admin/invoices`, click "New invoice".
2. Select "Create new" mode, pick an appointment type. Confirm line item 0's description and amount auto-fill with that type's name and price (divide the type's `price_cents` by 100 to check the expected dollar value).
3. Switch to "None" mode. Confirm a new standalone "Appointment type" dropdown appears above Line Items. Pick a type there and confirm line item 0 auto-fills the same way. Switch to "Link existing" mode and confirm the same dropdown (and behavior) appears there too.
4. Back in "Create new" mode: pick a date and time. If any confirmed/pending booking exists on that day at an overlapping time, confirm the "⚠ This time already has a booking." warning appears; if the admin day-view is empty for that day, note that you couldn't exercise this specific path but confirm the code reads correctly instead.
5. Confirm the Notes field still only appears in "Create new" mode, and the 140-character Session date & time / 32-character phone / 100-character address validations from earlier today still work (spot-check at least one).
6. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add app/admin/invoices/InvoiceForm.tsx
git commit -m "Defer booking creation to payment, add appointment-type line-item auto-fill and conflict warning"
```

---

### Task 7: `InvoiceList.tsx` — booking-conflict badge

**Files:**
- Modify: `app/admin/invoices/InvoiceList.tsx`

**Interfaces:**
- Consumes: `invoices.booking_conflict: boolean` from Task 1 (the page's existing `select("*, invoice_line_items(*)")` in `app/admin/invoices/page.tsx` already returns every column — no query change needed).

- [ ] **Step 1: Replace the file content**

Read the current file first to confirm it still matches — it was last touched by commit `449db6c` (from the invoice-session-details plan) and has not changed since. Replace the entire file with:

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
  session_date_time: string | null;
  booking_conflict: boolean;
  invoice_line_items: InvoiceLineItem[];
};

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  start_time: string;
  end_time: string;
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
                  {invoice.due_date
                    ? ` · due ${new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString("en-US")}`
                    : ""}
                </p>
                {invoice.session_date_time && (
                  <p className="text-sm text-muted">{invoice.session_date_time}</p>
                )}
                {invoice.booking_conflict && (
                  <p className="text-sm text-red-700">⚠ Slot no longer available — needs rescheduling</p>
                )}
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

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly with zero errors anywhere in the project — this is the last task, so this is the first point where the whole branch should compile clean end to end.

- [ ] **Step 3: Live-test in the browser**

1. Start `npm run dev`, log into `/admin/invoices`.
2. If any invoice already has `booking_conflict: true` (unlikely in a fresh environment), confirm the warning renders. If none do, that's expected — this flag can only be set by a real Stripe webhook delivery, which isn't testable locally; confirm the rendering logic is correct by reading the code instead.
3. Confirm the page otherwise renders exactly as before (existing invoices, Void/Resend buttons, session date/time line) — this task's diff should be purely additive.
4. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add app/admin/invoices/InvoiceList.tsx
git commit -m "Show a warning badge on invoices with a booking conflict"
```
