# Invoice Local-Save Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating an invoice, if the local Supabase insert fails after Stripe already finalized the invoice, retry once with only the table's original eight columns (dropping the newer optional `session_date_time`) so the invoice still becomes a manageable, voidable local row instead of an orphan only reachable from the Stripe Dashboard.

**Architecture:** A single-file change to `app/api/admin/invoices/route.ts`'s `POST` handler: the existing one-shot insert becomes a full-row attempt followed, only on failure, by one fallback attempt with `session_date_time` omitted. Everything downstream (line items insert, email send, response shape) is unchanged and already depends only on fields present in both the full and fallback rows.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres), TypeScript. No test framework in this repo — verification is `tsc --noEmit` / `npm run build` / `npm run lint` plus curl and browser checks, matching every other plan in `docs/superpowers/plans/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-invoice-insert-fallback-design.md`.
- The fallback insert must contain exactly the eight columns that existed on the `invoices` table before `session_date_time` was added: `client_name`, `client_email`, `booking_id`, `stripe_invoice_id`, `stripe_customer_id`, `status`, `due_date`, `hosted_invoice_url`. No other columns, no generic "retry with fewer fields" mechanism.
- Nothing sent to Stripe changes. `createInvoice()`'s call and its `custom_fields` payload are untouched — by the time either local insert runs, the Stripe invoice is already finalized.
- The `201` success response shape is unchanged (`{ invoice }`) whether the full insert or the fallback insert is what actually succeeded — the client (`InvoiceForm.tsx`) doesn't need to know or care which path was taken.
- Only when the fallback *also* fails does the handler fall back to today's existing behavior: log and return `500 "Invoice created in Stripe but failed to save locally."` — this final-failure path is unchanged from today.

---

### Task 1: Fallback insert in `POST /api/admin/invoices`

**Files:**
- Modify: `app/api/admin/invoices/route.ts`

**Interfaces:**
- Consumes: nothing new — this task only changes internal logic in the existing `POST` handler, no signature or route contract changes.
- Produces: no new exports. The route's request/response contract is unchanged from what's already documented in `docs/superpowers/plans/2026-09-15-invoice-session-details.md` (Task 2).

- [ ] **Step 1: Replace the file content**

Current file (read it first to confirm it still matches — it was last touched by the invoice-session-details feature, commit `fbe3ded`):

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
      (typeof b.sessionDateTime !== "string" || b.sessionDateTime.trim().length > 140)) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.trim().length > 32)) ||
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
      (typeof b.sessionDateTime !== "string" || b.sessionDateTime.trim().length > 140)) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.trim().length > 32)) ||
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
  }

  return Response.json({ invoice }, { status: 201 });
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Expected: all three pass cleanly (exit 0).

- [ ] **Step 3: Live-test the 401 path**

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices -d '{}'
```

Expected: `401` (no admin cookie). Stop the dev server when done (`kill %1` or equivalent).

`STRIPE_SECRET_KEY` may or may not be set in the environment this task runs in — if it isn't, the success path (and therefore both the full-row insert and the fallback-insert behavior) cannot be exercised locally; note this in your report rather than attempting to fake it. The fallback logic's correctness should instead be verified by careful reading: confirm `coreRow` contains exactly the eight fields listed in the Global Constraints (no `session_date_time`, nothing extra), confirm it reads its values from `fullRow` (not re-deriving them from `payload`/`created` separately, which would risk drifting out of sync if `fullRow` ever changes), and confirm `invoice`/`insertError` are declared with `let` (not `const`, since both are reassigned in the fallback branch) and correctly reflect the fallback result before the second `if (insertError)` check.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/invoices/route.ts
git commit -m "Add fallback insert for invoices when the full row fails to save locally"
```
