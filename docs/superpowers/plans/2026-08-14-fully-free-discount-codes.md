# Fully-Free Discount Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a discount code fully covers an appointment type's price (a 100% code, or a fixed-amount code ≥ the price), the booking confirms immediately and Stripe is skipped entirely — replacing the current stopgap of capping percentage codes at 99% and always charging at least 50 cents.

**Architecture:** A two-tier floor in `computeDiscountedAmountCents` (`lib/discountCodes.ts`): a discount that fully covers the price returns `0`; a discount that leaves a small positive remainder still floors to Stripe's 50-cent minimum. `app/api/bookings/route.ts`'s existing branch on `type.requires_payment` widens to also treat `finalAmountCents === 0` as "confirm immediately, no Stripe" — reusing the exact same confirmation steps (Google Calendar push, realtime broadcast, response shape) already used for `requires_payment: false` appointment types, plus the redemption-count increment and payment-confirmation email that were previously only reachable from the Stripe webhook.

**Tech Stack:** Same as the existing booking system — no new dependencies.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-14-fully-free-discount-codes-design.md`. Read it before starting.
- A discount is "fully free" when `computeDiscountedAmountCents` returns exactly `0` — never a negative number, never treated as free when it's actually a small positive amount (that case still floors to 50 cents and still goes through Stripe, unchanged from today).
- `discount_codes.redemption_count` must still increment exactly once per genuinely confirmed, discounted booking — for the fully-free path that means incrementing immediately in `app/api/bookings/route.ts` (there is no webhook delivery to do it later, since no Stripe session is ever created).
- The confirmation email for a fully-free discounted booking is `sendBookingPaymentConfirmedEmail` (not `sendFreeBookingConfirmedEmail`) — its existing logic already produces the right copy with zero changes (`amount_paid_cents: null` → "You're all set."; existing discount line shows the code and amount waived).
- No test framework exists in this codebase (confirmed: no vitest/jest, no `.test.ts` files). Verification is `npx tsc --noEmit && npx eslint app lib components`, plus live curl/direct-Supabase-query checks against the real (only) Supabase project — this worktree's `.env.local` has real credentials. Unlike the original discount-codes plan, the fully-free path needs no `STRIPE_SECRET_KEY` at all, so it can be verified live end-to-end, including the redemption-count increment.
- **A fully-free test booking must be deleted (not just canceled) after verification.** Unlike a canceled test booking, a `confirmed` one would show up in the real `/admin/clients` directory and occupy a real slot. Delete the row directly via a Supabase query — do not use the `/api/manage/[token]/cancel` endpoint (it triggers Stripe refund logic that doesn't apply here, since no payment ever happened).
- `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are not configured in this environment (confirmed absent from `.env.local`), so `pushBookingToGoogleCalendar` will no-op or fail gracefully during live verification rather than create a real calendar event — this is expected, not a bug to chase.

---

## Task 1: Discount math and admin form cap

**Files:**
- Modify: `lib/discountCodes.ts`
- Modify: `app/admin/discount-codes/DiscountCodeForm.tsx`

**Interfaces:**
- Produces: `computeDiscountedAmountCents(priceCents, discount): number` now returns exactly `0` when the discount fully covers the price (previously always floored to 50). `isValidDiscountValue("percentage", 100)` now returns `true` (previously capped at 99). Task 2 depends on the `=== 0` return value to decide whether to skip Stripe.

- [ ] **Step 1: Two-tier floor and reverted percentage cap**

In `lib/discountCodes.ts`, find:

```ts
// Stripe rejects card charges below $0.50 USD at Checkout Session
// creation — a fixed-amount code larger than the price would otherwise
// produce an amount Stripe can't charge.
export const STRIPE_MIN_CHARGE_CENTS = 50;

export function isValidDiscountValue(type: DiscountCodeType, value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  // Capped at 99, not 100 — the STRIPE_MIN_CHARGE_CENTS floor means a
  // "100% off" code would still charge 50 cents, which contradicts what
  // the client is told. A genuinely free booking should use a
  // requires_payment: false appointment type instead of a discount code.
  if (type === "percentage") return value <= 99;
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
```

Replace with:

```ts
// Stripe rejects card charges below $0.50 USD at Checkout Session
// creation. computeDiscountedAmountCents below treats this as two
// tiers: a discount that fully covers the price (raw <= 0) produces a
// genuinely free booking (see app/api/bookings/route.ts, which skips
// Stripe entirely in that case); a discount that leaves a small but
// positive amount still floors up to this minimum, since that booking
// still goes through a real Stripe charge.
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
  if (raw <= 0) return 0;
  return Math.max(raw, STRIPE_MIN_CHARGE_CENTS);
}
```

- [ ] **Step 2: Match the admin form's validation and label to the new cap**

In `app/admin/discount-codes/DiscountCodeForm.tsx`, find:

```tsx
    // Capped at 99, not 100 — matches isValidDiscountValue in
    // lib/discountCodes.ts (100% off would still charge $0.50 due to the
    // Stripe minimum-charge floor, so the server rejects it).
    if (form.type === "percentage" && rawValue > 99) {
      setError("Percentage must be 99 or less.");
      setStatus("error");
      return;
    }
```

Replace with:

```tsx
    if (form.type === "percentage" && rawValue > 100) {
      setError("Percentage must be 100 or less.");
      setStatus("error");
      return;
    }
```

Then find:

```tsx
            {form.type === "percentage" ? "Percent (1-99)" : "Amount ($)"}
```

Replace with:

```tsx
            {form.type === "percentage" ? "Percent (1-100)" : "Amount ($)"}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors (2 pre-existing `components/Navbar.tsx` errors, unrelated to this codebase's booking system, are known baseline noise — not something this task introduces or needs to fix).

Verify the math with an isolated `node -e` check (reimplement the tiny function inline — no TS runtime needed):

```bash
node -e '
function computeDiscountedAmountCents(priceCents, discount) {
  const raw = discount.type === "percentage"
    ? Math.round((priceCents * (100 - discount.value)) / 100)
    : priceCents - discount.value;
  if (raw <= 0) return 0;
  return Math.max(raw, 50);
}
console.log("100% off $150:", computeDiscountedAmountCents(15000, {type:"percentage", value:100})); // expect 0
console.log("99% off $150:", computeDiscountedAmountCents(15000, {type:"percentage", value:99}));   // expect 150
console.log("fixed $200 off $150:", computeDiscountedAmountCents(15000, {type:"fixed_amount", value:20000})); // expect 0
console.log("fixed $149.90 off $150:", computeDiscountedAmountCents(15000, {type:"fixed_amount", value:14990})); // expect 50 (floored)
'
```

Expected output: `0`, `150`, `0`, `50` in order.

- [ ] **Step 4: Commit**

```bash
git add lib/discountCodes.ts app/admin/discount-codes/DiscountCodeForm.tsx
git commit -m "Allow discount codes to fully cover a booking's price"
```

---

## Task 2: Skip Stripe and confirm immediately when a discount is fully covering

**Files:**
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `computeDiscountedAmountCents` returning `0` (Task 1) as the signal to skip Stripe; `sendBookingPaymentConfirmedEmail` and `sendFreeBookingConfirmedEmail` from `lib/email.ts` (both already exist, unchanged); `increment_discount_code_redemption` RPC (already exists in the live database, unchanged).

- [ ] **Step 1: Replace the full file**

Replace the full file `app/api/bookings/route.ts` with:

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
    const { data: discount, error: discountError } = await supabase
      .from("discount_codes")
      .select("*")
      .eq("code", payload.discountCode)
      .maybeSingle();

    if (discountError) {
      console.error("discount code lookup failed:", discountError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }

    if (!discount || !isDiscountCodeApplicable(discount, type.id)) {
      return Response.json(
        { error: "That discount code is invalid or no longer available." },
        { status: 400 },
      );
    }
    appliedDiscount = discount;
    finalAmountCents = computeDiscountedAmountCents(type.price_cents, discount);
  }

  // A discount that fully covers the price (finalAmountCents === 0) skips
  // Stripe entirely and confirms immediately, same as a free appointment
  // type — there's nothing for Stripe to charge.
  const skipsStripe = !type.requires_payment || finalAmountCents === 0;

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

  const status = skipsStripe ? "confirmed" : "pending";
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
      pending_expires_at: skipsStripe ? null : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
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

  if (skipsStripe) {
    // Only count a redemption once the booking is actually confirmed. For
    // every other discounted booking that goes through Stripe, this same
    // RPC is called from the webhook (lib/bookingsWebhook.ts) once
    // payment completes — here there's no payment to wait for, so the
    // increment happens immediately instead.
    if (appliedDiscount) {
      const { error: redemptionError } = await supabase.rpc("increment_discount_code_redemption", {
        p_code: appliedDiscount.code,
      });
      if (redemptionError) {
        console.error("Failed to increment discount code redemption:", redemptionError);
      }
    }

    try {
      if (appliedDiscount) {
        await sendBookingPaymentConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
      } else {
        await sendFreeBookingConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
      }
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
Expected: no errors (2 pre-existing `components/Navbar.tsx` errors are known baseline noise).

Live verification against the real Supabase project — this path needs no Stripe key, so it can be fully exercised end-to-end:

1. Start `npm run dev`.
2. Compute the admin cookie the same way as prior discount-code work (HMAC-SHA256 of `"granted"` keyed by `ADMIN_PASSWORD` from `.env.local`).
3. Find a real, currently-active appointment type with `requires_payment = true` via `curl -s http://localhost:3000/api/availability/appointment-types`. Note its `id` and `price_cents`.
4. Find a genuinely open slot for that type far in the future (read `app/book/SlotList.tsx` for the exact endpoint/params it uses to fetch open slots for a date).
5. Create a test 100%-off discount code: `POST /api/admin/discount-codes` with `{"code":"FREEVERIFY","type":"percentage","value":100,"active":true,"expiresAt":null,"maxRedemptions":null,"appointmentTypeIds":null}` — confirm this succeeds now (it would have been rejected before Task 1).
6. `POST /api/bookings` with that appointment type, the open slot, a plausible client name/email/phone, `discountCode: "freeverify"` (lowercase, confirming case-insensitivity still works), and a valid `turnstileToken` (check how earlier discount-code verification in this codebase's history handled Turnstile in dev — look for a bypass/test path in `lib/turnstile.ts` or `.env.local`; if none exists, report that specific blocker rather than guessing).
7. Expect the response to be `{"ok":true,"checkoutUrl":null,"bookingToken":"..."}` — **not** a 500 and **not** a Stripe URL. This is different from (and a stronger result than) the original discount-codes plan's verification, which always hit the missing-Stripe-key 500.
8. Query the resulting booking row directly via Supabase (Node script with `@supabase/supabase-js`, same pattern as prior tasks) and confirm: `status: "confirmed"`, `amount_paid_cents: null`, `discount_code: "FREEVERIFY"`, `discount_cents` equal to the appointment type's full `price_cents`.
9. Confirm the redemption count incremented immediately (no webhook involved): `GET /api/admin/discount-codes` with the admin cookie, find `FREEVERIFY`, confirm `redemption_count: 1`.
10. **Clean up, in order:** delete the test booking row directly via Supabase (not the cancel endpoint — see Global Constraints), then delete the test discount code via `DELETE /api/admin/discount-codes/<id>`.
11. Also confirm the non-100%, still-charged path is unaffected: repeat steps 5-6 with a fresh code at `"value": 50` (50% off) — expect a normal Stripe-path response this time. Since `STRIPE_SECRET_KEY` isn't configured in this environment, expect this one to fail at the Stripe call with the existing `500 "Something went wrong starting checkout."` (exactly as it did before this plan, since a 50%-off code doesn't hit the new zero-floor branch) — confirming the existing paid-discount path's control flow is genuinely untouched by this change. Clean up this booking row and code too.
12. Stop the dev server when done.

- [ ] **Step 3: Commit**

```bash
git add app/api/bookings/route.ts
git commit -m "Skip Stripe and confirm immediately when a discount fully covers the price"
```
