# Invoice Session & Client Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the client what date/time they're being billed for directly on the Stripe invoice, and let the admin capture phone/billing-address/notes from the invoice-creation form instead of those staying blank.

**Architecture:** `InvoiceForm.tsx` gains a "Session date & time" free-text field (auto-filled from the selected/created booking, always editable), a phone field, a billing-address group, and a notes field (shown only in "Create new" booking mode). These flow through `POST /api/admin/invoices` into `lib/invoices.ts`'s `createInvoice()`, which puts the session date/time on the Stripe invoice as a `custom_fields` entry and the phone/address on the Stripe customer — but only when creating a brand-new Stripe customer, never overwriting an existing one found by email. `session_date_time` is also persisted locally on the `invoices` row so `InvoiceList.tsx` can show it without an extra click.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres), Stripe SDK `^22.4.0`, TypeScript. No test framework in this repo — verification is `tsc --noEmit` / `npm run build` / `npm run lint` plus curl and live browser checks, matching every other plan in `docs/superpowers/plans/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-invoice-session-details-design.md`.
- `sessionDateTime` is capped at 140 characters (Stripe's hard limit on a custom field `value`, confirmed in `node_modules/stripe/cjs/resources/Invoices.d.ts:1298`). Exceeding it must be a form validation error, not a silent truncation — no `maxLength` attribute on that input.
- `clientPhone` and `billingAddress` are passed to `stripe.customers.create()` **only** inside the branch that creates a brand-new Stripe customer. The existing-customer-found-by-email branch (`existing.data[0]`) must never be touched — an existing customer's Stripe record is never updated by this feature.
- Country is hardcoded to `"US"` on the Stripe address param — no country field anywhere in the UI or API payload.
- Notes only appear (in the UI, and in the booking-creation payload) when `bookingMode === "new"`. `None`/`Link existing` modes never show a notes field.
- Never touch `bookings.amount_paid_cents` or `bookings.payment_intent_id` (carried over from the original invoicing plan's constraint — still applies, nothing in this plan touches either field).
- Admin auth pattern (already present in every route this plan touches — no route in this plan needs a new auth check, all already have `requireAdmin()`).

---

### Task 1: Schema — add `invoices.session_date_time`

**Files:**
- Modify: `supabase/schema.sql` (append at end of file, after line 631)

**Interfaces:**
- Produces: a nullable `session_date_time text` column on `invoices`, used by Task 2 (insert) and Task 4 (display).

- [ ] **Step 1: Append the column migration**

The `invoices`/`invoice_line_items` tables were added earlier this same project as a single `create table if not exists` block (lines 601-631). Following this file's own established convention for adding a column to an *already-created* table (see `alter table bookings add column if not exists discount_code text;` at line 431), append this to the very end of `supabase/schema.sql`:

```sql

alter table invoices add column if not exists session_date_time text;
```

- [ ] **Step 2: Verify the file is still valid SQL by eye**

Read the last 5 lines of `supabase/schema.sql` and confirm the new line is present, ends with a semicolon, and there's nothing after it.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add invoices.session_date_time column"
```

**Do not apply this to any live/remote Supabase database.** That is a manual step owned by the repo's human maintainer, same as every other schema change in this project — note this explicitly in your report.

---

### Task 2: `lib/invoices.ts` + `app/api/admin/invoices/route.ts` — new params, validation, and persistence

`createInvoice()`'s signature and its only caller change together in this task — splitting
them would leave an intermediate state that can't compile, so they're one task with one
combined verification pass at the end.

**Files:**
- Modify: `lib/invoices.ts`
- Modify: `app/api/admin/invoices/route.ts`

**Interfaces:**
- Consumes: nothing new from other tasks (this task is self-contained).
- Produces:
  - `createInvoice(params)` where `params` gains three new fields: `sessionDateTime: string | null`, `clientPhone: string | null`, `billingAddress: { line1: string; city: string; state: string; postalCode: string } | null`.
  - `POST /api/admin/invoices` request body accepts three new optional top-level fields:
    ```ts
    sessionDateTime?: string | null;   // ≤ 140 chars
    clientPhone?: string | null;       // ≤ 32 chars
    billingAddress?: { line1?: string; city?: string; state?: string; postalCode?: string } | null;
                                        // each sub-field ≤ 100 chars
    ```
    Task 3's `InvoiceForm.tsx` sends this exact shape.

- [ ] **Step 1: Replace `lib/invoices.ts`**

Current file (read it first to confirm it still matches — it was last touched by commit `4073146`):

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

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

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
    metadata: params.bookingId ? { bookingId: params.bookingId } : {},
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

Replace the entire file with:

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
            line1: params.billingAddress.line1,
            city: params.billingAddress.city,
            state: params.billingAddress.state,
            postal_code: params.billingAddress.postalCode,
            country: "US",
          }
        : undefined,
    }));

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

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
    metadata: params.bookingId ? { bookingId: params.bookingId } : {},
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

- [ ] **Step 2: Replace `app/api/admin/invoices/route.ts`**

Current file (read it first to confirm it still matches):

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

Replace the entire file with:

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

type BillingAddressPayload = { line1: string; city: string; state: string; postalCode: string } | null;

type CreatePayload = {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: LineItemPayload[];
  dueDate: string | null;
  sessionDateTime: string | null;
  clientPhone: string | null;
  billingAddress: BillingAddressPayload;
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
    if (typeof raw !== "string" || raw.length > 100) return { value: null, valid: false };
    parsed[field] = raw.trim();
  }
  const isBlank = fields.every((field) => !parsed[field]);
  if (isBlank) return { value: null, valid: true };
  return {
    value: { line1: parsed.line1, city: parsed.city, state: parsed.state, postalCode: parsed.postalCode },
    valid: true,
  };
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const { value: billingAddress, valid: billingAddressValid } = parseBillingAddress(b.billingAddress);

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
      (typeof b.sessionDateTime !== "string" || b.sessionDateTime.length > 140)) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.length > 32)) ||
    !billingAddressValid
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
      session_date_time: payload.sessionDateTime,
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

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly — this covers both files changed in this task.

- [ ] **Step 4: Live-test the 401 and validation paths**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices -d '{}'
```

Expected: `401` (no admin cookie). Stop the dev server when done (`kill %1` or equivalent). `STRIPE_SECRET_KEY` is not set anywhere in this environment, so the success path (actually creating a Stripe invoice) cannot be exercised locally — note this in your report rather than attempting it.

- [ ] **Step 5: Commit**

```bash
git add lib/invoices.ts app/api/admin/invoices/route.ts
git commit -m "Add session date/time, phone, and billing address to invoice creation"
```

---

### Task 3: `app/admin/invoices/page.tsx` + `InvoiceForm.tsx` — the form UI

**Files:**
- Modify: `app/admin/invoices/page.tsx`
- Modify: `app/admin/invoices/InvoiceForm.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/invoices` body shape from Task 2 (`sessionDateTime`, `clientPhone`, `billingAddress`).
- Produces: the `BookingOption` type used by this form becomes:
  ```ts
  type BookingOption = {
    id: string;
    client_name: string;
    client_email: string;
    client_phone: string | null;
    start_time: string;
    end_time: string;
    status: string;
  };
  ```
  Task 4's `InvoiceList.tsx` must update its own local `BookingOption` type to this exact shape too (it's duplicated per-component in this codebase, same as before this plan — see `InvoiceList.tsx`'s current copy).

- [ ] **Step 1: Update the bookings query in `page.tsx`**

Read `app/admin/invoices/page.tsx` first to confirm it still matches. Find this line:

```ts
      .select("id, client_name, client_email, start_time, status")
```

Replace with:

```ts
      .select("id, client_name, client_email, client_phone, start_time, end_time, status")
```

That is the only change to this file.

- [ ] **Step 2: Verify page.tsx alone**

```bash
npx tsc --noEmit
```

Expected: the only new-looking errors are inside `InvoiceForm.tsx`/`InvoiceList.tsx` about the now-wider `bookings` data not matching their still-old `BookingOption` types — that's expected until this task's remaining steps and Task 4 land. If you see errors anywhere else, stop and report them.

- [ ] **Step 3: Replace `InvoiceForm.tsx`**

Read the current file first to confirm it still matches (it was last touched by commit `4073146`). Replace the entire file with:

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
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", amount: "" }]);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return b.client_name.toLowerCase().includes(q) || b.client_email.toLowerCase().includes(q);
  });

  // "Link existing": selecting a booking fills in what's already known about
  // that client — still editable afterward. Re-fires only when the selection
  // itself changes, so it never fights a manual edit the admin makes after
  // picking a booking.
  useEffect(() => {
    if (bookingMode !== "existing") return;
    const booking = bookings.find((b) => b.id === selectedBookingId);
    if (!booking) return;
    setClientName(booking.client_name);
    setClientEmail(booking.client_email);
    setPhone(booking.client_phone ?? "");
    setSessionDateTime(formatTimeRange(booking.start_time, booking.end_time));
  }, [bookingMode, selectedBookingId, bookings]);

  // "Create new": recompute the session date/time display string whenever
  // the new booking's appointment type, date, or time changes. Uses the same
  // duration + timezone helpers the admin-booking-creation endpoint itself
  // uses, so the displayed range matches what actually gets booked.
  useEffect(() => {
    if (bookingMode !== "new") return;
    if (!newBookingAppointmentTypeId || !newBookingDate || !newBookingTime) return;
    const type = appointmentTypes.find((t) => t.id === newBookingAppointmentTypeId);
    if (!type) return;
    const startIso = businessLocalToUtcIso(newBookingDate, newBookingTime);
    const endIso = businessLocalToUtcIso(newBookingDate, addMinutesToTime(newBookingTime, type.duration_minutes));
    setSessionDateTime(formatTimeRange(startIso, endIso));
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
            clientPhone: phone.trim(),
            notes: notes.trim(),
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

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: `InvoiceForm.tsx` and `page.tsx` errors are gone. Remaining errors, if any, should only be in `InvoiceList.tsx` (fixed in Task 4) — confirm that and report it, don't fix `InvoiceList.tsx` in this task.

- [ ] **Step 5: Live-test in the browser**

`STRIPE_SECRET_KEY` is not set in this environment, so the actual submit-to-Stripe path can't be exercised locally — don't attempt it. Everything below is pure client-side interaction, fully testable without Stripe:

1. Start `npm run dev`, log into `/admin` (there should already be an admin cookie in this environment's browser from prior sessions — if not, note that in your report rather than trying to bypass auth), navigate to `/admin/invoices`, click "New invoice".
2. Confirm the new fields render: Phone, Billing address (line1 + city/state/ZIP row), "Session date & time".
3. Select "Link existing" and pick a booking from the dropdown (if any confirmed bookings exist — if the list is empty, note this and skip to step 4). Confirm Client name, Client email, and Phone (if that booking has one) auto-fill, and "Session date & time" fills with a `"<Weekday>, <Mon> <Day> · <start>–<end> <TZ>"`-shaped string. Then edit the Session date & time field by hand and confirm your edit sticks (doesn't get overwritten) until you change the booking selection again.
4. Select "Create new", pick an appointment type, fill in a date and time. Confirm "Session date & time" auto-fills with a formatted range reflecting that appointment type's duration. Confirm the Notes field appears only in this mode (switch to "None" and "Link existing" and confirm it disappears both times).
5. Type a "Session date & time" value over 140 characters and submit; confirm the form shows the "Session date & time must be 140 characters or fewer." error instead of submitting.
6. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add app/admin/invoices/page.tsx app/admin/invoices/InvoiceForm.tsx
git commit -m "Add session date/time, phone, billing address, and notes fields to the invoice form"
```

---

### Task 4: `InvoiceList.tsx` — display session date/time

**Files:**
- Modify: `app/admin/invoices/InvoiceList.tsx`

**Interfaces:**
- Consumes: `Invoice` rows now carry `session_date_time: string | null` (Task 2's insert; the page's existing `select("*, invoice_line_items(*)")` already returns every column, no query change needed here). `BookingOption` shape from Task 3 (this file has its own duplicate copy of that type, same as before this plan — must be kept in sync by hand, matching the existing convention).

- [ ] **Step 1: Replace the file content**

Read the current file first to confirm it still matches (it was last touched by commit `4073146`, and Task 3 does not modify this file). Replace the entire file with:

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
2. If any invoices already exist with a `session_date_time` value (e.g. from testing in Task 3), confirm that text renders under the total/due-date line in the list.
3. If none do, create one with "Link existing" or "Create new" mode (so Session date & time auto-fills), submit it (note: this creates a real Stripe invoice and sends a real email if `STRIPE_SECRET_KEY` is configured in the target environment — if it's not configured here, the submit will fail at the Stripe call and that's expected; you only need to confirm the *client-side* rendering of `session_date_time` on invoices that already have one, not create a new one against a live Stripe account from this task).
4. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add app/admin/invoices/InvoiceList.tsx
git commit -m "Show session date/time on the admin invoice list"
```
