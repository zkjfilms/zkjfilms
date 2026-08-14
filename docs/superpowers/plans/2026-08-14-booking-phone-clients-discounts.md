# Booking: Mandatory Phone, Client Directory, Discount Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make phone required on the booking form, add an admin directory of clients derived from confirmed bookings, and let admins create percentage/fixed-amount discount codes that clients redeem on the booking form — applied by lowering the Stripe Checkout amount directly, not via Stripe's own coupon objects.

**Architecture:** Everything follows the existing self-hosted booking system's conventions exactly: Supabase Postgres via the service-role `@supabase-js` client, admin routes gated by the existing HMAC cookie (`requireAdmin()`), admin CRUD pages mirroring `app/admin/appointment-types`, and `supabase/schema.sql` as the single append-only migration log applied manually via the Supabase SQL Editor. Discount codes are validated and applied entirely server-side in `POST /api/bookings` — Stripe only ever sees the final, already-discounted line-item amount.

**Tech Stack:** Next.js App Router, Supabase/Postgres, Stripe Checkout, Resend — all existing, no new dependencies.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-14-booking-phone-clients-discounts-design.md`. Read it before starting.
- Business logic lives entirely in this Next.js app; `supabase/schema.sql` is append-only — never edit or reorder existing statements, only add new ones at the end, exactly as every prior schema change in this file has done.
- Discount codes apply only to appointment types with `requires_payment = true`. A code submitted against a free type is silently ignored, never an error.
- A fixed-amount discount is floored at **50 cents** (`STRIPE_MIN_CHARGE_CENTS`), Stripe's minimum card-payment amount, so a code can never produce a Checkout session Stripe would reject at creation.
- `discount_codes.redemption_count` increments only when a booking's Stripe Checkout session actually completes (the pending → confirmed transition in the webhook) — never at checkout-session creation — so an abandoned or expired checkout never consumes a limited-use code.
- Discount validation returns one generic error message to the client (`"That discount code is invalid or no longer available."`) regardless of which specific rule failed (expired, inactive, wrong appointment type, redemption limit reached) — never leak which.
- No test framework exists in this codebase (confirmed: no vitest/jest, no `.test.ts`/`.test.tsx` files anywhere). Every task's verification is `npx tsc --noEmit && npx eslint app lib components`, plus a manual pass (curl for API-only checks, the browser for UI, direct SQL via the Supabase SQL Editor for DB state) — matching the pattern used throughout this codebase's prior plans.
- Every admin route/page in this codebase is gated by the same `requireAdmin()` check (`ADMIN_ACCESS_COOKIE` via `lib/adminAccess.ts`) — copy that exact pattern into every new admin route, don't invent a new one.

---

## Task 1: Schema migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: table `discount_codes` (columns: `id, code, type, value, active, expires_at, max_redemptions, redemption_count, appointment_type_ids, created_at`); new columns `bookings.discount_code text` and `bookings.discount_cents integer`; Postgres function `increment_discount_code_redemption(p_code text) returns void`. Every later task's queries reference these exact names.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql
-- Discount codes: admin-managed percentage or fixed-amount codes clients
-- enter on the booking form before checkout (see app/api/bookings/route.ts
-- and app/admin/discount-codes). Applied server-side by lowering the
-- Stripe Checkout line-item amount directly — Stripe itself never sees a
-- "discount," just a smaller total. RLS enabled with no policies,
-- matching every other admin-managed table in this schema.
create table discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null check (type in ('percentage', 'fixed_amount')),
  value integer not null check (value > 0),
  active boolean not null default true,
  expires_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0,
  appointment_type_ids uuid[],
  created_at timestamptz not null default now(),
  check (type <> 'percentage' or value <= 100)
);

alter table discount_codes enable row level security;

alter table bookings add column if not exists discount_code text;
alter table bookings add column if not exists discount_cents integer;

-- reschedule_booking (defined when the booking system was first built)
-- must also carry discount_code/discount_cents forward, same as every
-- other payment-related column it already copies (payment_intent_id,
-- amount_paid_cents) — otherwise a reschedule silently drops which code,
-- if any, was applied to the original booking. CREATE OR REPLACE
-- preserves the existing revoke below (Postgres keeps a function's ACL
-- across a replace as long as the owner is unchanged).
create or replace function reschedule_booking(
  p_booking_token uuid,
  p_new_start timestamptz,
  p_new_end timestamptz
) returns bookings
language plpgsql
as $$
declare
  v_old bookings;
  v_new bookings;
begin
  select * into v_old from bookings
    where booking_token = p_booking_token and status = 'confirmed'
    for update;

  if not found then
    raise exception 'booking_not_found_or_not_confirmed';
  end if;

  update bookings set status = 'canceled' where id = v_old.id;

  insert into bookings (
    appointment_type_id, client_name, client_email, client_phone,
    start_time, end_time, status, notes, booking_token,
    payment_intent_id, amount_paid_cents, discount_code, discount_cents
  ) values (
    v_old.appointment_type_id, v_old.client_name, v_old.client_email, v_old.client_phone,
    p_new_start, p_new_end, 'confirmed', v_old.notes, v_old.booking_token,
    v_old.payment_intent_id, v_old.amount_paid_cents, v_old.discount_code, v_old.discount_cents
  ) returning * into v_new;

  return v_new;
end;
$$;

-- Atomic redemption increment: called from the booking-confirmed webhook
-- (lib/bookingsWebhook.ts) so two nearly-simultaneous checkouts for the
-- same capped code can't both push redemption_count past
-- max_redemptions. A plain supabase-js `.update()` can't express
-- `redemption_count = redemption_count + 1` as a relative expression, so
-- this needs to be a function.
create or replace function increment_discount_code_redemption(p_code text)
returns void
language sql
as $$
  update discount_codes
  set redemption_count = redemption_count + 1
  where code = p_code
    and (max_redemptions is null or redemption_count < max_redemptions);
$$;

-- Same reasoning as reschedule_booking's existing revoke: Postgres grants
-- execute on new functions to PUBLIC by default, and Supabase exposes
-- every public-schema function at POST /rest/v1/rpc/<name>. Leaving this
-- callable by anon would let anyone increment a code's redemption count
-- directly, exhausting a limited-use code without ever booking anything.
-- The webhook's own call path uses the service-role key and is
-- unaffected by this revoke.
revoke execute on function increment_discount_code_redemption(text)
  from public, anon, authenticated;
```

- [ ] **Step 2: Apply the migration**

Paste the SQL above into the Supabase SQL Editor (Project > SQL Editor > New query) and run it.

- [ ] **Step 3: Verify**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'discount_codes';

select column_name from information_schema.columns
where table_name = 'bookings' and column_name in ('discount_code', 'discount_cents')
order by column_name;

select proname from pg_proc
where proname in ('reschedule_booking', 'increment_discount_code_redemption')
order by proname;
```

Expect: `discount_codes` listed; both `bookings` columns listed; both function names returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add schema for discount codes and booking discount tracking"
```

---

## Task 2: Mandatory phone number

**Files:**
- Modify: `app/book/BookingForm.tsx`
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- None — self-contained, no other task depends on this one specifically (later full-file rewrites of these same two files in Tasks 5 and 6 build on top of this change).

- [ ] **Step 1: Require phone client-side**

In `app/book/BookingForm.tsx`, find:

```tsx
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Phone (optional)</label>
        <input
          value={form.clientPhone}
          onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
```

Replace with:

```tsx
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Phone</label>
        <input
          required
          value={form.clientPhone}
          onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
```

- [ ] **Step 2: Require phone server-side**

In `app/api/bookings/route.ts`, find (inside `parsePayload`):

```ts
    typeof b.clientPhone !== "string" ||
    typeof b.notes !== "string" ||
```

Replace with:

```ts
    typeof b.clientPhone !== "string" ||
    !b.clientPhone.trim() ||
    typeof b.notes !== "string" ||
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

Start the dev server (`npm run dev`), go through `/book` up to the booking form, and confirm the browser blocks submission (native "please fill out this field") when Phone is left blank.

Then confirm the API rejects it directly even if the client-side check is bypassed:

```bash
curl -s -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"appointmentTypeId":"00000000-0000-0000-0000-000000000000","date":"2026-09-01","startTime":"10:00","clientName":"Test","clientEmail":"test@example.com","clientPhone":"","notes":"","honeypot":"","turnstileToken":""}'
```

Expected: `400` with `{"error":"Please fill out all required fields with a valid email address."}` (the shared generic message for any `parsePayload` failure — this request fails on `clientPhone`, not the appointment type, since payload parsing runs before any DB lookup).

- [ ] **Step 4: Commit**

```bash
git add app/book/BookingForm.tsx app/api/bookings/route.ts
git commit -m "Make phone number required on the booking form"
```

---

## Task 3: Discount code math + admin API

**Files:**
- Create: `lib/discountCodes.ts`
- Create: `app/api/admin/discount-codes/route.ts`
- Create: `app/api/admin/discount-codes/[id]/route.ts`

**Interfaces:**
- Produces:
  - `type DiscountCodeType = "percentage" | "fixed_amount"`, `DISCOUNT_CODE_TYPES: DiscountCodeType[]`
  - `type DiscountCode = { id: string; code: string; type: DiscountCodeType; value: number; active: boolean; expires_at: string | null; max_redemptions: number | null; redemption_count: number; appointment_type_ids: string[] | null; created_at: string }`
  - `STRIPE_MIN_CHARGE_CENTS = 50`
  - `isValidDiscountValue(type: DiscountCodeType, value: number): boolean`
  - `computeDiscountedAmountCents(priceCents: number, discount: { type: DiscountCodeType; value: number }): number`
  - `isDiscountCodeApplicable(discount: DiscountCode, appointmentTypeId: string, now?: Date): boolean`
  - `GET /api/admin/discount-codes`, `POST /api/admin/discount-codes`, `PATCH /api/admin/discount-codes/[id]`, `DELETE /api/admin/discount-codes/[id]` — all admin-gated.
- Consumes: `ADMIN_ACCESS_COOKIE`, `isValidAccessToken` from `lib/adminAccess.ts`; `getSupabaseClient` from `lib/supabase.ts` (both existing).

- [ ] **Step 1: Shared discount-code types and math**

Create `lib/discountCodes.ts`:

```ts
// Shared discount-code types and math — used by the admin CRUD routes
// (app/api/admin/discount-codes) and the booking checkout flow
// (app/api/bookings/route.ts) so the percentage/fixed-amount rules and
// the Stripe minimum-charge floor are defined in exactly one place.

export type DiscountCodeType = "percentage" | "fixed_amount";

export const DISCOUNT_CODE_TYPES: DiscountCodeType[] = ["percentage", "fixed_amount"];

export type DiscountCode = {
  id: string;
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  appointment_type_ids: string[] | null;
  created_at: string;
};

// Stripe rejects card charges below $0.50 USD at Checkout Session
// creation — a fixed-amount code larger than the price would otherwise
// produce an amount Stripe can't charge.
export const STRIPE_MIN_CHARGE_CENTS = 50;

export function isValidDiscountValue(type: DiscountCodeType, value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  if (type === "percentage") return value <= 100;
  return true;
}

export function computeDiscountedAmountCents(
  priceCents: number,
  discount: { type: DiscountCodeType; value: number },
): number {
  const raw =
    discount.type === "percentage"
      ? Math.round((priceCents * (100 - discount.value)) / 100)
      : priceCents - discount.value;
  return Math.max(raw, STRIPE_MIN_CHARGE_CENTS);
}

export function isDiscountCodeApplicable(
  discount: DiscountCode,
  appointmentTypeId: string,
  now: Date = new Date(),
): boolean {
  if (!discount.active) return false;
  if (discount.expires_at && new Date(discount.expires_at) <= now) return false;
  if (discount.max_redemptions !== null && discount.redemption_count >= discount.max_redemptions) {
    return false;
  }
  if (
    discount.appointment_type_ids &&
    discount.appointment_type_ids.length > 0 &&
    !discount.appointment_type_ids.includes(appointmentTypeId)
  ) {
    return false;
  }
  return true;
}
```

- [ ] **Step 2: List + create route**

Create `app/api/admin/discount-codes/route.ts`:

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { DISCOUNT_CODE_TYPES, isValidDiscountValue, type DiscountCodeType } from "@/lib/discountCodes";

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
    .from("discount_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("discount_codes list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ discountCodes: data });
}

type CreatePayload = {
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  appointmentTypeIds: string[] | null;
};

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.code !== "string" ||
    !b.code.trim() ||
    typeof b.type !== "string" ||
    !DISCOUNT_CODE_TYPES.includes(b.type as DiscountCodeType) ||
    typeof b.value !== "number" ||
    !isValidDiscountValue(b.type as DiscountCodeType, b.value) ||
    typeof b.active !== "boolean" ||
    (b.expiresAt !== null && typeof b.expiresAt !== "string") ||
    (b.maxRedemptions !== null &&
      (typeof b.maxRedemptions !== "number" || !Number.isInteger(b.maxRedemptions) || b.maxRedemptions <= 0)) ||
    (b.appointmentTypeIds !== null &&
      !(Array.isArray(b.appointmentTypeIds) && b.appointmentTypeIds.every((id) => typeof id === "string")))
  ) {
    return null;
  }
  return {
    code: b.code.trim().toUpperCase(),
    type: b.type as DiscountCodeType,
    value: b.value,
    active: b.active,
    expiresAt: b.expiresAt as string | null,
    maxRedemptions: b.maxRedemptions as number | null,
    appointmentTypeIds:
      Array.isArray(b.appointmentTypeIds) && b.appointmentTypeIds.length > 0
        ? (b.appointmentTypeIds as string[])
        : null,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid discount code." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .insert({
      code: payload.code,
      type: payload.type,
      value: payload.value,
      active: payload.active,
      expires_at: payload.expiresAt,
      max_redemptions: payload.maxRedemptions,
      appointment_type_ids: payload.appointmentTypeIds,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That code already exists." }, { status: 409 });
    }
    console.error("discount_codes insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ discountCode: data }, { status: 201 });
}
```

- [ ] **Step 3: Update + delete route**

Create `app/api/admin/discount-codes/[id]/route.ts`:

```ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { DISCOUNT_CODE_TYPES, isValidDiscountValue, type DiscountCodeType } from "@/lib/discountCodes";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

type UpdatePayload = Partial<{
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  appointmentTypeIds: string[] | null;
}>;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as UpdatePayload | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.code !== undefined) {
    if (typeof body.code !== "string" || !body.code.trim()) {
      return Response.json({ error: "Invalid code." }, { status: 400 });
    }
    update.code = body.code.trim().toUpperCase();
  }
  if (body.type !== undefined) {
    if (!DISCOUNT_CODE_TYPES.includes(body.type)) {
      return Response.json({ error: "Invalid type." }, { status: 400 });
    }
    update.type = body.type;
  }
  if (body.value !== undefined) {
    if (body.type === undefined || !isValidDiscountValue(body.type, body.value)) {
      return Response.json({ error: "Invalid value." }, { status: 400 });
    }
    update.value = body.value;
  }
  if (body.active !== undefined) update.active = body.active;
  if (body.expiresAt !== undefined) update.expires_at = body.expiresAt;
  if (body.maxRedemptions !== undefined) update.max_redemptions = body.maxRedemptions;
  if (body.appointmentTypeIds !== undefined) {
    update.appointment_type_ids =
      body.appointmentTypeIds && body.appointmentTypeIds.length > 0 ? body.appointmentTypeIds : null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That code already exists." }, { status: 409 });
    }
    console.error("discount_codes update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ discountCode: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("discount_codes").delete().eq("id", id);
  if (error) {
    console.error("discount_codes delete failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

Log into `/admin` in the browser (this sets the `admin_access` cookie), open browser devtools, copy that cookie's value, then:

```bash
curl -s http://localhost:3000/api/admin/discount-codes --cookie "admin_access=<paste value>"
```

Expected: `{"discountCodes":[]}`.

```bash
curl -s -X POST http://localhost:3000/api/admin/discount-codes \
  --cookie "admin_access=<paste value>" \
  -H "Content-Type: application/json" \
  -d '{"code":"test10","type":"percentage","value":10,"active":true,"expiresAt":null,"maxRedemptions":null,"appointmentTypeIds":null}'
```

Expected: `201` with a `discountCode` object whose `code` is `"TEST10"` (uppercased). Re-running the same command should now fail with `409` and `{"error":"That code already exists."}`. Clean up: `DELETE` it via `curl -X DELETE ... /api/admin/discount-codes/<id>` with the same cookie, or delete the row directly in the Supabase SQL Editor.

- [ ] **Step 5: Commit**

```bash
git add lib/discountCodes.ts app/api/admin/discount-codes
git commit -m "Add discount-code math and admin CRUD API"
```

---

## Task 4: Admin discount-codes UI

**Files:**
- Create: `app/admin/discount-codes/page.tsx`
- Create: `app/admin/discount-codes/DiscountCodeList.tsx`
- Create: `app/admin/discount-codes/DiscountCodeForm.tsx`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `DiscountCode`, `DiscountCodeType` from `lib/discountCodes.ts` (Task 3); `AppointmentType` from `app/admin/appointment-types/AppointmentTypeList.tsx` (existing); the four `/api/admin/discount-codes[...]` routes (Task 3).

- [ ] **Step 1: List page**

Create `app/admin/discount-codes/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import DiscountCodeList from "./DiscountCodeList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Discount Codes" };
}

export default async function DiscountCodesPage() {
  const supabase = getSupabaseClient();
  const [
    { data: discountCodes, error: discountCodesError },
    { data: appointmentTypes, error: appointmentTypesError },
  ] = await Promise.all([
    supabase.from("discount_codes").select("*").order("created_at", { ascending: false }),
    supabase.from("appointment_types").select("*").order("sort_order", { ascending: true }),
  ]);

  if (discountCodesError) {
    console.error("discount_codes list failed:", discountCodesError);
  }
  if (appointmentTypesError) {
    console.error("appointment_types list failed:", appointmentTypesError);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Discount Codes</h1>
      </div>
      <DiscountCodeList
        initialCodes={discountCodes ?? []}
        appointmentTypes={appointmentTypes ?? []}
      />
    </div>
  );
}
```

- [ ] **Step 2: List component**

Create `app/admin/discount-codes/DiscountCodeList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/format";
import type { DiscountCode } from "@/lib/discountCodes";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import DiscountCodeForm from "./DiscountCodeForm";

function formatValue(discountCode: DiscountCode): string {
  return discountCode.type === "percentage"
    ? `${discountCode.value}% off`
    : `${formatCents(discountCode.value)} off`;
}

function formatApplicability(discountCode: DiscountCode, appointmentTypes: AppointmentType[]): string {
  if (!discountCode.appointment_type_ids || discountCode.appointment_type_ids.length === 0) {
    return "All appointment types";
  }
  const names = discountCode.appointment_type_ids
    .map((id) => appointmentTypes.find((t) => t.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : "All appointment types";
}

function ActiveToggle({ discountCode }: { discountCode: DiscountCode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/discount-codes/${discountCode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !discountCode.active }),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "Working…" : discountCode.active ? "Deactivate" : "Activate"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/discount-codes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete.");
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to delete.");
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
          onClick={handleDelete}
          disabled={pending}
          className="text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Confirm delete"}
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
      Delete
    </button>
  );
}

export default function DiscountCodeList({
  initialCodes,
  appointmentTypes,
}: {
  initialCodes: DiscountCode[];
  appointmentTypes: AppointmentType[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      {creating ? (
        <DiscountCodeForm
          appointmentTypes={appointmentTypes}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New code
        </button>
      )}

      {initialCodes.length === 0 ? (
        <p className="text-muted">No discount codes yet.</p>
      ) : (
        <div className="border-t border-border">
          {initialCodes.map((discountCode) =>
            editingId === discountCode.id ? (
              <div key={discountCode.id} className="border-b border-border/60 py-6">
                <DiscountCodeForm
                  discountCode={discountCode}
                  appointmentTypes={appointmentTypes}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div
                key={discountCode.id}
                className={`flex items-center justify-between gap-4 border-b border-border/60 py-4 ${
                  discountCode.active ? "" : "opacity-50"
                }`}
              >
                <div>
                  <p className="text-foreground">
                    {discountCode.code}
                    {!discountCode.active && (
                      <span className="ml-2 text-xs uppercase tracking-[0.15em] text-muted">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {formatValue(discountCode)} · {formatApplicability(discountCode, appointmentTypes)}
                    {discountCode.expires_at
                      ? ` · expires ${new Date(discountCode.expires_at).toLocaleDateString("en-US")}`
                      : ""}
                    {discountCode.max_redemptions
                      ? ` · ${discountCode.redemption_count}/${discountCode.max_redemptions} used`
                      : ` · ${discountCode.redemption_count} used`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setEditingId(discountCode.id)}
                    className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Edit
                  </button>
                  <ActiveToggle discountCode={discountCode} />
                  <DeleteButton id={discountCode.id} />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Form component**

Create `app/admin/discount-codes/DiscountCodeForm.tsx`:

```tsx
"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import type { DiscountCode, DiscountCodeType } from "@/lib/discountCodes";

type Status = "idle" | "loading" | "error";

function toFormState(discountCode: DiscountCode | null) {
  if (!discountCode) {
    return {
      code: "",
      type: "percentage" as DiscountCodeType,
      value: "",
      active: true,
      expiresAt: "",
      maxRedemptions: "",
      appointmentTypeIds: [] as string[],
    };
  }
  return {
    code: discountCode.code,
    type: discountCode.type,
    value:
      discountCode.type === "percentage"
        ? String(discountCode.value)
        : (discountCode.value / 100).toString(),
    active: discountCode.active,
    expiresAt: discountCode.expires_at ? discountCode.expires_at.slice(0, 10) : "",
    maxRedemptions: discountCode.max_redemptions ? String(discountCode.max_redemptions) : "",
    appointmentTypeIds: discountCode.appointment_type_ids ?? [],
  };
}

export default function DiscountCodeForm({
  discountCode = null,
  appointmentTypes,
  onDone,
  onCancel,
}: {
  discountCode?: DiscountCode | null;
  appointmentTypes: AppointmentType[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(discountCode));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const isEditing = discountCode !== null;

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function toggleAppointmentType(id: string) {
    setForm((prev) => ({
      ...prev,
      appointmentTypeIds: prev.appointmentTypeIds.includes(id)
        ? prev.appointmentTypeIds.filter((existing) => existing !== id)
        : [...prev.appointmentTypeIds, id],
    }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    if (!form.code.trim()) {
      setError("Enter a code.");
      setStatus("error");
      return;
    }

    const rawValue = Number(form.value);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      setError("Enter a valid value.");
      setStatus("error");
      return;
    }
    if (form.type === "percentage" && rawValue > 100) {
      setError("Percentage must be 100 or less.");
      setStatus("error");
      return;
    }
    const value = form.type === "percentage" ? Math.round(rawValue) : Math.round(rawValue * 100);

    let maxRedemptions: number | null = null;
    if (form.maxRedemptions.trim()) {
      const parsed = Number(form.maxRedemptions);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("Enter a valid usage limit.");
        setStatus("error");
        return;
      }
      maxRedemptions = parsed;
    }

    const body = {
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value,
      active: form.active,
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      maxRedemptions,
      appointmentTypeIds: form.appointmentTypeIds.length > 0 ? form.appointmentTypeIds : null,
    };

    try {
      const response = await fetch(
        isEditing ? `/api/admin/discount-codes/${discountCode.id}` : "/api/admin/discount-codes",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

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
        <label htmlFor="code" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          value={form.code}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="type" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Type
          </label>
          <select
            id="type"
            name="type"
            value={form.type}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          >
            <option value="percentage">Percentage off</option>
            <option value="fixed_amount">Amount off ($)</option>
          </select>
        </div>
        <div>
          <label htmlFor="value" className="block text-xs uppercase tracking-[0.15em] text-muted">
            {form.type === "percentage" ? "Percent (1-100)" : "Amount ($)"}
          </label>
          <input
            id="value"
            name="value"
            type="number"
            min="0"
            step={form.type === "percentage" ? "1" : "0.01"}
            required
            value={form.value}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="expiresAt" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Expires (optional)
          </label>
          <input
            id="expiresAt"
            name="expiresAt"
            type="date"
            value={form.expiresAt}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="maxRedemptions" className="block text-xs uppercase tracking-[0.15em] text-muted">
            Usage limit (optional)
          </label>
          <input
            id="maxRedemptions"
            name="maxRedemptions"
            type="number"
            min="1"
            step="1"
            value={form.maxRedemptions}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">
          Applies to (none checked = all types)
        </p>
        <div className="space-y-2">
          {appointmentTypes.map((appointmentType) => (
            <label key={appointmentType.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.appointmentTypeIds.includes(appointmentType.id)}
                onChange={() => toggleAppointmentType(appointmentType.id)}
                className="h-4 w-4 border-border accent-accent"
              />
              {appointmentType.name}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="active"
          checked={form.active}
          onChange={handleChange}
          className="h-4 w-4 border-border accent-accent"
        />
        Active
      </label>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "loading"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Saving…" : isEditing ? "Save changes" : "Create code"}
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

- [ ] **Step 4: Nav link**

In `app/admin/layout.tsx`, find:

```tsx
const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
];
```

Replace with:

```tsx
const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/discount-codes", label: "Discount Codes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
];
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

In the browser, log into `/admin`, click "Discount Codes" in the nav, click "New code," create a 15%-off code with no expiration/limit/type restriction, confirm it appears in the list with "All appointment types" and "0 used." Click "Deactivate," confirm it grays out and the button now reads "Activate." Click "Edit," change the value, save, confirm the list updates. Click "Delete" → "Confirm delete," confirm it disappears. Also create one fixed-amount code restricted to a single appointment type and confirm the list shows that type's name instead of "All appointment types."

- [ ] **Step 6: Commit**

```bash
git add app/admin/discount-codes app/admin/layout.tsx
git commit -m "Add admin UI for managing discount codes"
```

---

## Task 5: Discount code field on the booking form

**Files:**
- Modify: `app/book/BookingFlow.tsx`
- Modify: `app/book/BookingForm.tsx`

**Interfaces:**
- Produces: `BookingForm` now accepts a `requiresPayment: boolean` prop and posts `discountCode: string` (always present, empty string when unused) to `POST /api/bookings` — Task 6 reads this field.

- [ ] **Step 1: Pass `requiresPayment` down from `BookingFlow`**

In `app/book/BookingFlow.tsx`, find:

```tsx
          <BookingForm
            appointmentTypeId={appointmentType.id}
            date={date}
            startTime={slot.startTime}
            onBack={changeSlot}
          />
```

Replace with:

```tsx
          <BookingForm
            appointmentTypeId={appointmentType.id}
            date={date}
            startTime={slot.startTime}
            requiresPayment={appointmentType.requires_payment}
            onBack={changeSlot}
          />
```

- [ ] **Step 2: Add the discount code field**

Replace the full file `app/book/BookingForm.tsx` with:

```tsx
"use client";

import { useRef, useState, type FormEvent } from "react";
import TurnstileWidget, {
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";

type Props = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  requiresPayment: boolean;
  onBack: () => void;
};

function redirectTo(url: string) {
  window.location.href = url;
}

export default function BookingForm({ appointmentTypeId, date, startTime, requiresPayment, onBack }: Props) {
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    notes: "",
    discountCode: "",
    honeypot: "",
  });
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentTypeId, date, startTime, ...form, turnstileToken }),
      });
      const data: { checkoutUrl?: string | null; error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        turnstileRef.current?.reset();
        setStatus("idle");
        return;
      }
      if (data.checkoutUrl) {
        redirectTo(data.checkoutUrl);
        return;
      }
      redirectTo("/book/confirmed");
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <button type="button" onClick={onBack} className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
        Choose a different time
      </button>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Name</label>
        <input
          required
          value={form.clientName}
          onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Email</label>
        <input
          required
          type="email"
          value={form.clientEmail}
          onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Phone</label>
        <input
          required
          value={form.clientPhone}
          onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          rows={3}
          className="w-full border border-border bg-transparent p-3 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      {requiresPayment && (
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Discount code (optional)</label>
          <input
            value={form.discountCode}
            onChange={(e) => setForm((p) => ({ ...p, discountCode: e.target.value }))}
            className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
          />
        </div>
      )}
      {/* Honeypot — hidden from real visitors via CSS, not `type="hidden"`
          (some bots skip hidden inputs but still fill visible-but-offscreen ones). */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Leave this field blank
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.honeypot}
            onChange={(e) => setForm((p) => ({ ...p, honeypot: e.target.value }))}
          />
        </label>
      </div>
      <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading" || !turnstileToken}
        className="w-full border border-foreground py-3 text-xs uppercase tracking-[0.3em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
      >
        {status === "loading" ? "Please wait…" : "Confirm Booking"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

In the browser, go through `/book`, pick an appointment type with `requires_payment = true`, confirm the "Discount code (optional)" field appears on the final step. Go back and pick a free appointment type, confirm the field does **not** appear.

- [ ] **Step 4: Commit**

```bash
git add app/book/BookingFlow.tsx app/book/BookingForm.tsx
git commit -m "Add discount code field to the booking form"
```

---

## Task 6: Apply discount codes in the booking API

**Files:**
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `computeDiscountedAmountCents`, `isDiscountCodeApplicable`, `type DiscountCode` from `lib/discountCodes.ts` (Task 3); `discountCode: string` field posted by `BookingForm` (Task 5).
- Produces: `bookings.discount_code` / `bookings.discount_cents` populated on insert; `createFullPaymentCheckoutSession` now receives the discounted amount — Task 7 (webhook redemption count) and Task 8 (confirmation email) both read the resulting booking row's `discount_code`/`discount_cents`.

- [ ] **Step 1: Replace the full file**

Replace the full file `app/api/bookings/route.ts` with:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createFullPaymentCheckoutSession } from "@/lib/stripe";
import { sendFreeBookingConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { turnstileFailureResponse, verifyTurnstileToken } from "@/lib/turnstile";
import { computeDiscountedAmountCents, isDiscountCodeApplicable, type DiscountCode } from "@/lib/discountCodes";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
  honeypot: string;
  turnstileToken: string;
  discountCode: string;
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
    !b.clientPhone.trim() ||
    typeof b.notes !== "string" ||
    typeof b.honeypot !== "string" ||
    (typeof b.turnstileToken !== "string" && b.turnstileToken !== undefined) ||
    (typeof b.discountCode !== "string" && b.discountCode !== undefined)
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
    honeypot: b.honeypot,
    turnstileToken: b.turnstileToken === undefined ? "" : (b.turnstileToken as string),
    discountCode: typeof b.discountCode === "string" ? b.discountCode.trim().toUpperCase() : "",
  };
}

export async function POST(request: Request) {
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Please fill out all required fields with a valid email address." }, { status: 400 });
  }

  // Honeypot: a real client never fills this hidden field. Silently
  // pretend success so a bot doesn't learn its submission was rejected.
  if (payload.honeypot) {
    return Response.json({ ok: true, checkoutUrl: null });
  }

  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({ ip, endpoint: "bookings", maxHits: 5, windowMinutes: 10 });
  if (!allowed) {
    return Response.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  if (!payload.turnstileToken) {
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const verification = await verifyTurnstileToken(payload.turnstileToken, ip);
  if (!verification.ok) {
    return turnstileFailureResponse(verification);
  }

  const supabase = getSupabaseClient();
  const { data: type, error: typeError } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("id", payload.appointmentTypeId)
    .eq("active", true)
    .maybeSingle();

  if (typeError || !type) {
    return Response.json({ error: "That appointment type is no longer available." }, { status: 404 });
  }

  // Discount codes only mean anything for a paid appointment type — a
  // code submitted alongside a free type is silently ignored rather than
  // rejected, since BookingForm only ever shows the field when
  // requiresPayment is true.
  let finalAmountCents = type.price_cents;
  let appliedDiscount: DiscountCode | null = null;
  if (type.requires_payment && payload.discountCode) {
    const { data: discount } = await supabase
      .from("discount_codes")
      .select("*")
      .eq("code", payload.discountCode)
      .maybeSingle();

    if (!discount || !isDiscountCodeApplicable(discount, type.id)) {
      return Response.json(
        { error: "That discount code is invalid or no longer available." },
        { status: 400 },
      );
    }
    appliedDiscount = discount;
    finalAmountCents = computeDiscountedAmountCents(type.price_cents, discount);
  }

  // Re-validate against current availability at submit time — the
  // client's list may be stale by the time they submit.
  const openSlots = await fetchOpenSlotsForDate({ date: payload.date, appointmentType: type });
  if (!openSlots.some((s) => s.startTime === payload.startTime)) {
    return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  // A pending hold whose 30-minute window has already expired but was
  // never swept (e.g. a missed checkout.session.expired webhook) is
  // already excluded from fetchOpenSlotsForDate's visibility check
  // above, but the exclusion constraint below doesn't know about
  // pending_expires_at — it would still 409 this insert forever without
  // this. Clearing it here means a genuinely-open slot stays bookable
  // even if the scheduled sweep never runs.
  await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("pending_expires_at", new Date().toISOString())
    .lt("start_time", endIso)
    .gt("end_time", startIso);

  const status = type.requires_payment ? "pending" : "confirmed";
  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_phone: payload.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status,
      notes: payload.notes || null,
      pending_expires_at: type.requires_payment ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
      discount_code: appliedDiscount?.code ?? null,
      discount_cents: appliedDiscount ? type.price_cents - finalAmountCents : null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres exclusion-violation error code — someone else claimed this
    // exact time between our slot-list check above and this insert.
    if (insertError.code === "23P01") {
      return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
    }
    console.error("bookings insert failed:", insertError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!type.requires_payment) {
    try {
      await sendFreeBookingConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
    } catch (err) {
      console.error("Confirmation email failed (booking still confirmed):", err);
    }

    try {
      const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
      if (eventId) {
        await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
      }
    } catch (err) {
      console.error("Google Calendar push failed (booking still confirmed):", err);
    }

    await broadcastBookingChange({ date: payload.date });
    return Response.json({ ok: true, checkoutUrl: null, bookingToken: booking.booking_token });
  }

  try {
    const session = await createFullPaymentCheckoutSession({
      bookingId: booking.id,
      amountCents: finalAmountCents,
      appointmentTypeName: type.name,
      clientEmail: payload.clientEmail,
    });
    // A `pending` row already removes this slot from other clients' view,
    // same as a confirmed booking would.
    await broadcastBookingChange({ date: payload.date });
    return Response.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create booking checkout session:", err);
    await supabase.from("bookings").update({ status: "canceled" }).eq("id", booking.id);
    return Response.json({ error: "Something went wrong starting checkout." }, { status: 500 });
  }
}

function businessLocalToUtcIso(date: string, time: string): string {
  // Anchored with "Z" so this parses as a UTC instant regardless of the
  // host process's own timezone (mirrors businessDayUtcBounds/
  // formatSlotForDisplay in lib/scheduling.ts, which use the same
  // technique). Without the "Z", `new Date(...)` parses the string as
  // local time in the *host's* timezone, which happens to produce the
  // right answer when the process's TZ is UTC (true on Vercel/Lambda by
  // default) but silently shifts every booking's stored time by the
  // business-timezone offset — doubled — whenever the host isn't UTC
  // (e.g. `next dev` on a laptop set to America/Chicago).
  const naive = new Date(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(naive).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

In the Supabase SQL Editor, create a test code directly (or use the admin UI from Task 4):

```sql
insert into discount_codes (code, type, value)
values ('VERIFY20', 'percentage', 20);
```

In the browser, go through `/book`, pick a paid appointment type, enter `verify20` (lowercase, to confirm case-insensitivity) in the Discount code field, submit, and confirm the Stripe Checkout page shows the discounted total (80% of the appointment type's price). Then check the row:

```sql
select discount_code, discount_cents from bookings order by created_at desc limit 1;
```

Expected: `discount_code = 'VERIFY20'`, `discount_cents` equal to 20% of the appointment type's `price_cents`.

Then confirm an invalid code is rejected: submit again with `discountCode: "NOPE"` — expect the form to show `"That discount code is invalid or no longer available."` and no new `pending` row left behind (check `bookings` — Stripe checkout creation never got called since validation fails before the availability re-check and insert).

Clean up the test code: `delete from discount_codes where code = 'VERIFY20';`

- [ ] **Step 3: Commit**

```bash
git add app/api/bookings/route.ts
git commit -m "Validate and apply discount codes when creating a booking"
```

---

## Task 7: Redemption counting in the payment webhook

**Files:**
- Modify: `lib/bookingsWebhook.ts`

**Interfaces:**
- Consumes: `increment_discount_code_redemption` RPC (Task 1); `booking.discount_code` populated by Task 6.

- [ ] **Step 1: Increment on payment confirmation**

In `lib/bookingsWebhook.ts`, find:

```ts
  if (!booking) {
    // Already confirmed (duplicate delivery) or the row is gone — either
    // way, nothing left to do.
    return { retry: false };
  }

  try {
    await sendBookingPaymentConfirmedEmail(booking);
```

Replace with:

```ts
  if (!booking) {
    // Already confirmed (duplicate delivery) or the row is gone — either
    // way, nothing left to do.
    return { retry: false };
  }

  // Only count a redemption once the payment has actually gone through —
  // an abandoned or expired checkout (handleBookingCheckoutExpired below)
  // never reaches this point, so it never consumes a limited-use code.
  if (booking.discount_code) {
    const { error: redemptionError } = await supabase.rpc("increment_discount_code_redemption", {
      p_code: booking.discount_code,
    });
    if (redemptionError) {
      console.error("Failed to increment discount code redemption:", redemptionError);
    }
  }

  try {
    await sendBookingPaymentConfirmedEmail(booking);
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

Create a test code with a usage limit and complete a real (test-mode) paid booking against it end to end — via `/book` with Stripe test card `4242 4242 4242 4242`:

```sql
insert into discount_codes (code, type, value, max_redemptions)
values ('LIMITED1', 'fixed_amount', 500, 1);
```

After the Checkout session completes and the webhook fires, confirm:

```sql
select redemption_count, max_redemptions from discount_codes where code = 'LIMITED1';
```

Expected: `redemption_count = 1`. Attempting to book again with `LIMITED1` should now be rejected by Task 6's validation (`isDiscountCodeApplicable` sees `redemption_count >= max_redemptions`).

Clean up: `delete from discount_codes where code = 'LIMITED1';` and cancel/clean up the test booking row if desired.

- [ ] **Step 3: Commit**

```bash
git add lib/bookingsWebhook.ts
git commit -m "Increment discount code redemption count on payment confirmation"
```

---

## Task 8: Show the discount on the confirmation email

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Consumes: `booking.discount_code` / `booking.discount_cents`, already present on the row passed in from `lib/bookingsWebhook.ts` (that call already does `.select("*, appointment_types(name)")`, so no query change is needed there).

- [ ] **Step 1: Add the discount line**

In `lib/email.ts`, find:

```ts
export async function sendBookingPaymentConfirmedEmail(
  booking: BookingForEmail & { amount_paid_cents: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const paidLine = booking.amount_paid_cents
    ? `Payment of ${formatCents(booking.amount_paid_cents)} received — you're all set.`
    : "You're all set.";
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        paidLine,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>${escapeHtml(paidLine)}</p>
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
```

Replace with:

```ts
export async function sendBookingPaymentConfirmedEmail(
  booking: BookingForEmail & {
    amount_paid_cents: number | null;
    discount_code: string | null;
    discount_cents: number | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const paidLine = booking.amount_paid_cents
    ? `Payment of ${formatCents(booking.amount_paid_cents)} received — you're all set.`
    : "You're all set.";
  const discountLine =
    booking.discount_code && booking.discount_cents
      ? `Discount applied: ${booking.discount_code} (-${formatCents(booking.discount_cents)}).`
      : null;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        paidLine,
        ...(discountLine ? [discountLine] : []),
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>${escapeHtml(paidLine)}</p>
        ${discountLine ? `<p>${escapeHtml(discountLine)}</p>` : ""}
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
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

Repeat the test-mode paid booking from Task 6's or 7's verification with a discount code applied, and confirm the received confirmation email includes a "Discount applied: CODE (-$X.XX)" line. Book once more with no discount code and confirm that line is absent.

- [ ] **Step 3: Commit**

```bash
git add lib/email.ts
git commit -m "Show applied discount code on the booking confirmation email"
```

---

## Task 9: Admin client directory

**Files:**
- Create: `app/admin/clients/page.tsx`
- Create: `app/admin/clients/ClientDirectoryList.tsx`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- None consumed from other tasks in this plan (only reads existing `bookings`/`appointment_types` columns). Independent of Tasks 3–8.

- [ ] **Step 1: Page — fetch and aggregate confirmed bookings by email**

Create `app/admin/clients/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ClientDirectoryList, { type ClientBookingRow } from "./ClientDirectoryList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Clients" };
}

type BookingRow = {
  client_name: string;
  client_email: string;
  client_phone: string | null;
  start_time: string;
  amount_paid_cents: number | null;
  appointment_types: { name: string } | { name: string }[] | null;
};

function typeName(row: BookingRow): string {
  const rel = row.appointment_types;
  if (!rel) return "Appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "Appointment") : rel.name;
}

export default async function AdminClientsPage() {
  const supabase = getSupabaseClient();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("client_name, client_email, client_phone, start_time, amount_paid_cents, appointment_types(name)")
    .eq("status", "confirmed")
    .order("start_time", { ascending: false });

  if (error) {
    console.error("bookings list for client directory failed:", error);
  }

  const clientsByEmail = new Map<string, ClientBookingRow>();
  for (const row of (bookings ?? []) as BookingRow[]) {
    const booking = {
      typeName: typeName(row),
      startTime: row.start_time,
      amountPaidCents: row.amount_paid_cents,
    };
    const existing = clientsByEmail.get(row.client_email);
    if (!existing) {
      clientsByEmail.set(row.client_email, {
        email: row.client_email,
        name: row.client_name,
        phone: row.client_phone,
        bookingCount: 1,
        firstBooking: row.start_time,
        lastBooking: row.start_time,
        totalPaidCents: row.amount_paid_cents ?? 0,
        bookings: [booking],
      });
      continue;
    }
    existing.bookingCount += 1;
    existing.totalPaidCents += row.amount_paid_cents ?? 0;
    existing.bookings.push(booking);
    // Rows are already ordered newest-first, so the first time we see a
    // given email is its most recent booking — keep that name/phone.
    if (row.start_time < existing.firstBooking) {
      existing.firstBooking = row.start_time;
    }
  }
  const clients = Array.from(clientsByEmail.values()).sort(
    (a, b) => new Date(b.lastBooking).getTime() - new Date(a.lastBooking).getTime(),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Clients</h1>
      </div>
      {clients.length === 0 ? (
        <p className="text-muted">{error ? "Couldn't load clients." : "No completed bookings yet."}</p>
      ) : (
        <ClientDirectoryList clients={clients} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: List component with per-client booking history**

Create `app/admin/clients/ClientDirectoryList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatDate, formatCents } from "@/lib/format";

export type ClientBooking = {
  typeName: string;
  startTime: string;
  amountPaidCents: number | null;
};

export type ClientBookingRow = {
  email: string;
  name: string;
  phone: string | null;
  bookingCount: number;
  firstBooking: string;
  lastBooking: string;
  totalPaidCents: number;
  bookings: ClientBooking[];
};

function ClientRow({ client }: { client: ClientBookingRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="py-3 pr-4 text-foreground">{client.name}</td>
        <td className="py-3 pr-4 text-muted">
          <a href={`mailto:${client.email}`} className="hover:text-foreground hover:underline">
            {client.email}
          </a>
        </td>
        <td className="py-3 pr-4 text-muted">{client.phone ?? "—"}</td>
        <td className="py-3 pr-4 text-muted">{client.bookingCount}</td>
        <td className="whitespace-nowrap py-3 pr-4 text-muted">{formatDate(client.lastBooking)}</td>
        <td className="py-3 pr-4 text-muted">{formatCents(client.totalPaidCents)}</td>
        <td className="py-3">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {expanded ? "Hide" : "View bookings"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-border/10">
          <td colSpan={7} className="py-3 pr-4">
            <ul className="space-y-1 text-xs text-muted">
              {client.bookings
                .slice()
                .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                .map((booking, i) => (
                  <li key={i}>
                    {booking.typeName} · {formatDate(booking.startTime)}
                    {booking.amountPaidCents ? ` · ${formatCents(booking.amountPaidCents)}` : ""}
                  </li>
                ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClientDirectoryList({ clients }: { clients: ClientBookingRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-[0.15em] text-muted">
            <th className="py-3 pr-4 font-normal">Name</th>
            <th className="py-3 pr-4 font-normal">Email</th>
            <th className="py-3 pr-4 font-normal">Phone</th>
            <th className="py-3 pr-4 font-normal"># Bookings</th>
            <th className="py-3 pr-4 font-normal">Last Booking</th>
            <th className="py-3 pr-4 font-normal">Total Paid</th>
            <th className="py-3 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientRow key={client.email} client={client} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Nav link**

In `app/admin/layout.tsx`, find:

```tsx
const NAV_LINKS = [
  { href: "/admin/dashboard", label: "Contracts" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/appointment-types", label: "Appointment Types" },
  { href: "/admin/discount-codes", label: "Discount Codes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/galleries", label: "Galleries" },
  { href: "/admin/leads", label: "Leads" },
];
```

Replace with:

```tsx
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

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

In the browser, log into `/admin`, click "Clients" in the nav. With at least one confirmed booking in the database (from earlier tasks' manual testing, or any pre-existing confirmed booking), confirm the client appears with correct name/email/phone/booking count/total paid. Click "View bookings" and confirm it expands to show that client's individual booking(s). If the same email has multiple confirmed bookings, confirm the count and total reflect all of them, not just one.

- [ ] **Step 5: Commit**

```bash
git add app/admin/clients app/admin/layout.tsx
git commit -m "Add admin client directory derived from confirmed bookings"
```
