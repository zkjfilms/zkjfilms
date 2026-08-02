# Booking Deposits, Reschedule & Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe deposit collection to `/book`, and give each client a private `/manage/[token]` link to reschedule (free at 72+ hours' notice, $50 fee under that) or cancel (100%/50%/0% refund tiers by notice given) their own appointment.

**Architecture:** Stripe Checkout (redirect flow, no client-side Elements) collects the deposit at booking time and the reschedule fee when needed; a signature-verified webhook (`/api/webhooks/stripe`) is the only place that finalizes state changes on `booking_slots`, since payment confirmation is asynchronous. A `booking_token` column — distinct from the row's own `id` — is the private link's identity, and travels with the client across reschedules so the link never breaks. Cancellation calls Stripe's Refund API directly (no Checkout needed, nothing new to pay).

**Tech Stack:** Next.js App Router (existing), Supabase/Postgres (existing), Resend (existing), Stripe (`stripe` npm package, new).

## Global Constraints

- Reschedule: free at ≥72 hours' notice before the *current* appointment; a $50 (5000 cents) fee applies under 72 hours, charged via Stripe Checkout before the change takes effect.
- Reschedule only offered into another open slot of the **same `session_type`** — no cross-type reschedule, no price proration.
- Cancellation refund tiers, based on days until the current appointment: **≥7 days → 100%**, **≥3 but <7 days → 50%**, **<3 days → 0%** of `deposit_cents`.
- Cancellation **always** releases the slot, even if the Stripe refund call fails. A failed refund is flagged (`refund_status = 'failed'`) for manual follow-up, never blocks the client.
- Checkout Session / pending-slot hold window: **30 minutes** (Stripe's minimum allowed `expires_at`).
- Deposit amount is set by the admin **per slot** in `/admin/availability` (not a fixed price list).
- `/book` stays a single self-contained page for the whole pick-slot → pay-deposit → confirm flow, and is added to the main site nav.
- Spec source: `docs/superpowers/specs/2026-08-02-booking-deposits-reschedule-cancellation-design.md`.

---

## Task 1: Stripe SDK, client wrapper, and env var setup

**Files:**
- Modify: `package.json` (add `stripe` dependency)
- Create: `lib/stripe.ts`
- Modify: `.env.example` (add Stripe vars)
- Modify: `.env.local` (add real test-mode Stripe vars — not committed)

**Interfaces:**
- Produces: `getStripeClient(): Stripe` — every later Stripe-touching file uses this, mirroring `getSupabaseClient()` in `lib/supabase.ts`.

- [ ] **Step 1: Install the Stripe SDK**

Run: `cd /Users/zachjohnson/Projects/portfolio-site && npm install stripe@^22.4.0`

- [ ] **Step 2: Create `lib/stripe.ts`**

```ts
import Stripe from "stripe";

// Server-side Stripe client. Mirrors lib/supabase.ts's
// getSupabaseClient() — a fresh client per call, no shared module-level
// singleton, so nothing here can leak across requests.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function getStripeClient(): Stripe {
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"));
}
```

- [ ] **Step 3: Add Stripe vars to `.env.example`**

Append to the end of `.env.example`:

```
# Stripe — Developers > API keys for the secret key, Developers >
# Webhooks for the signing secret (see the Stripe CLI setup note in
# docs/superpowers/specs/2026-08-02-booking-deposits-reschedule-cancellation-design.md
# for local development).
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 4: Add real test-mode values to `.env.local`**

This step needs input from the site owner, not something to guess:

1. In the Stripe Dashboard (test mode), go to Developers > API keys and copy the **Secret key** (starts `sk_test_`).
2. Add both lines to `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=
   ```
   Leave `STRIPE_WEBHOOK_SECRET` blank for now — Step 5 fills it in.

- [ ] **Step 5: Install the Stripe CLI and get a local webhook secret**

Run: `brew install stripe/stripe-cli/stripe`

Run (in a separate terminal, kept running for the rest of local testing in this plan):
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`

This prints a webhook signing secret like `whsec_...` — copy it into `.env.local` as `STRIPE_WEBHOOK_SECRET`. Keep `stripe listen` running for every later task's testing steps; it forwards real Stripe test-mode events to your local dev server.

- [ ] **Step 6: Verify the client compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/stripe.ts .env.example
git commit -m "Add Stripe SDK and server-side client wrapper"
```

(`.env.local` is gitignored — nothing to commit there.)

---

## Task 2: Schema migration — deposits, tokens, refunds on `booking_slots`

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: new `booking_slots` columns every later task reads/writes —
  `deposit_cents integer`, `deposit_payment_intent_id text`,
  `booking_token uuid`, `pending_expires_at timestamptz`,
  `refund_status text`, `refund_amount_cents integer` — plus `status`
  extended to allow `'pending'`.

- [ ] **Step 1: Append the migration to `supabase/schema.sql`**

Add this block at the end of the file:

```sql
-- Deposits, private-link tokens, and refund tracking for the native
-- booking system (deposit collection, self-serve reschedule/cancel —
-- see docs/superpowers/specs/2026-08-02-booking-deposits-reschedule-cancellation-design.md).
--
-- booking_token is deliberately NOT the same as `id`: `id` belongs to
-- whichever row currently represents the appointment, but a reschedule
-- moves the client to a *different* row (a different admin-created open
-- slot). The token travels with the client across that move, generated
-- once when a deposit is confirmed and carried forward on every
-- reschedule, so their private link (/manage/[booking_token]) never
-- breaks. It's cleared (set to null) on cancellation and on release
-- back to 'open' generally — lookups always filter status = 'booked',
-- so a stale token on an 'open' row is inert either way.
alter table booking_slots
  add column if not exists deposit_cents integer not null default 0,
  add column if not exists deposit_payment_intent_id text,
  add column if not exists booking_token uuid,
  add column if not exists pending_expires_at timestamptz,
  add column if not exists refund_status text
    check (refund_status in ('refunded', 'partial_refund', 'no_refund', 'failed')),
  add column if not exists refund_amount_cents integer;

alter table booking_slots drop constraint if exists booking_slots_status_check;
alter table booking_slots add constraint booking_slots_status_check
  check (status in ('open', 'pending', 'booked'));

create index if not exists booking_slots_booking_token_idx
  on booking_slots (booking_token);
```

- [ ] **Step 2: Apply it in Supabase**

Copy the new block (Step 1's SQL) to the clipboard: run
`pbcopy < /dev/stdin` isn't needed — just open Supabase's SQL Editor
(Project > SQL Editor > New query), paste the block, and run it.

- [ ] **Step 3: Verify the columns exist**

Run this from the project root (loads `.env.local` automatically):

```bash
cat > scratch-verify-schema.mjs << 'EOF'
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase
  .from("booking_slots")
  .select("id, deposit_cents, deposit_payment_intent_id, booking_token, pending_expires_at, refund_status, refund_amount_cents")
  .limit(1);
console.log(JSON.stringify({ data, error }, null, 2));
EOF
node --env-file=.env.local scratch-verify-schema.mjs
rm scratch-verify-schema.mjs
```

Expected: `"error": null` (an empty `data: []` is fine if there are no
rows yet — the point is the columns are queryable without error).

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add deposit, booking-token, and refund columns to booking_slots"
```

---

## Task 3: Admin — deposit amount per slot

**Files:**
- Modify: `app/admin/availability/AddSlotForm.tsx`
- Modify: `app/api/admin/availability/route.ts`
- Modify: `app/admin/availability/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/availability` (existing route, extended)
- Produces: every newly-created `booking_slots` row now has a real
  `deposit_cents` value the deposit-checkout flow (Task 6) reads.

- [ ] **Step 1: Add a deposit field to `AddSlotForm.tsx`**

In `app/admin/availability/AddSlotForm.tsx`, change:

```ts
const EMPTY_FORM = { date: "", startTime: "", endTime: "", sessionType: "" };
```

to:

```ts
const EMPTY_FORM = {
  date: "",
  startTime: "",
  endTime: "",
  sessionType: "",
  depositDollars: "",
};
```

Then in `handleSubmit`, after the existing start/end time validation
block and before the `fetch` call, add:

```ts
const depositCents = Math.round(Number(form.depositDollars) * 100);
if (!Number.isFinite(depositCents) || depositCents <= 0) {
  setError("Enter a valid deposit amount.");
  setStatus("error");
  return;
}
```

Update the `fetch` body to include it:

```ts
body: JSON.stringify({
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
  sessionType: form.sessionType,
  depositCents,
}),
```

Add the input itself, right after the "Session type" `<select>` block
and before the `{error && ...}` line:

```tsx
<div>
  <label
    htmlFor="depositDollars"
    className="block text-xs uppercase tracking-[0.15em] text-muted"
  >
    Deposit ($)
  </label>
  <input
    id="depositDollars"
    name="depositDollars"
    type="number"
    min="0"
    step="0.01"
    required
    value={form.depositDollars}
    onChange={handleChange}
    className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
  />
</div>
```

- [ ] **Step 2: Accept `depositCents` in the API route**

In `app/api/admin/availability/route.ts`, change the `Payload` type and
`parsePayload`:

```ts
type Payload = {
  startTime: string;
  endTime: string;
  sessionType: string;
  depositCents: number;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { startTime, endTime, sessionType, depositCents } = body as Record<
    string,
    unknown
  >;

  if (
    typeof startTime !== "string" ||
    typeof endTime !== "string" ||
    typeof sessionType !== "string" ||
    typeof depositCents !== "number"
  ) {
    return null;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  const trimmedType = sessionType.trim();

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    !trimmedType ||
    !Number.isInteger(depositCents) ||
    depositCents <= 0
  ) {
    return null;
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    sessionType: trimmedType,
    depositCents,
  };
}
```

Update the error message and the insert call:

```ts
  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please provide a valid time range, session type, and deposit amount." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("booking_slots")
    .insert({
      start_time: payload.startTime,
      end_time: payload.endTime,
      session_type: payload.sessionType,
      deposit_cents: payload.depositCents,
    })
    .select()
    .single();
```

- [ ] **Step 3: Add a `formatCents` helper**

In `lib/format.ts`, add:

```ts
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
```

- [ ] **Step 4: Show deposit and status in the admin list**

In `app/admin/availability/page.tsx`, update the import and `SlotRow`
type:

```ts
import { formatTimeRange, formatCents } from "@/lib/format";
```

```ts
type SlotRow = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
  status: "open" | "pending" | "booked";
  client_name: string | null;
  client_email: string | null;
  deposit_cents: number;
  refund_status: "refunded" | "partial_refund" | "no_refund" | "failed" | null;
};
```

Update the `select` call:

```ts
  const { data: slots, error } = await supabase
    .from("booking_slots")
    .select(
      "id, start_time, end_time, session_type, status, client_name, client_email, deposit_cents, refund_status",
    )
    .order("start_time", { ascending: true });
```

Add a "Deposit" header cell right after "Session":

```tsx
<th className="py-3 pr-4 font-normal">Deposit</th>
```

Add the matching data cell right after the session-type `<td>`:

```tsx
<td className="py-3 pr-4 text-muted">{formatCents(slot.deposit_cents)}</td>
```

Update the status cell to cover `pending` and to flag a failed refund:

```tsx
<td className="py-3 pr-4">
  {slot.status === "booked" ? (
    <span className="text-accent">Booked</span>
  ) : slot.status === "pending" ? (
    <span className="text-muted">Pending checkout</span>
  ) : (
    <span className="text-muted">Open</span>
  )}
  {slot.refund_status === "failed" && (
    <span className="ml-2 text-red-700">— refund needs manual follow-up</span>
  )}
</td>
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 6: Manually verify slot creation with a deposit**

With the dev server running (`npm run dev`), authenticate as admin and
create a slot with a deposit, mirroring the pattern already used in
earlier testing sessions:

```bash
cd /Users/zachjohnson/Projects/portfolio-site
ADMIN_PW=$(grep '^ADMIN_PASSWORD=' .env.local | cut -d= -f2-)
COOKIE=$(curl -s -i -X POST http://localhost:3000/api/admin-access \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PW\"}" | grep -i '^set-cookie' | grep -v 'Max-Age=0' | sed -E 's/set-cookie: ([^;]+);.*/\1/I')

curl -s -X POST http://localhost:3000/api/admin/availability \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"startTime":"2026-08-10T18:00:00.000Z","endTime":"2026-08-10T19:00:00.000Z","sessionType":"Headshots","depositCents":7500}'
```

Expected: `{"ok":true,"slot":{... "deposit_cents":7500 ...}}`. Then load
`http://localhost:3000/admin/availability` in a browser (or
`curl -s http://localhost:3000/admin/availability -H "Cookie: $COOKIE" | grep -o '\$75\.00'`)
and confirm `$75.00` appears.

- [ ] **Step 7: Commit**

```bash
git add app/admin/availability/AddSlotForm.tsx app/api/admin/availability/route.ts app/admin/availability/page.tsx lib/format.ts
git commit -m "Let admins set a deposit amount per booking slot"
```

---

## Task 4: Booking policy constants and time-math helpers

**Files:**
- Create: `lib/booking.ts`

**Interfaces:**
- Produces: `RESCHEDULE_NOTICE_HOURS`, `RESCHEDULE_FEE_CENTS`,
  `PENDING_HOLD_MINUTES`, `hoursUntil(iso: string): number`,
  `daysUntil(iso: string): number`,
  `refundTierForCancellation(daysNotice: number): { percent: 100 | 50 | 0; label: string }`
  — used by Tasks 6, 7, 9, 10, 11.

- [ ] **Step 1: Create `lib/booking.ts`**

```ts
// Shared booking policy constants and time-math helpers. Used by the
// deposit checkout flow (app/api/book), the reschedule/cancellation API
// routes (app/api/manage/[token]/*), and their confirmation emails —
// kept in one place so the policy numbers can't drift out of sync.
//
// See docs/superpowers/specs/2026-08-02-booking-deposits-reschedule-cancellation-design.md.

export const RESCHEDULE_NOTICE_HOURS = 72;
export const RESCHEDULE_FEE_CENTS = 5000;
export const PENDING_HOLD_MINUTES = 30;

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

export function daysUntil(iso: string): number {
  return hoursUntil(iso) / 24;
}

export type RefundTier = { percent: 100 | 50 | 0; label: string };

// >=7 days out: full refund. >=3 days (72h): half. Under 3 days: none.
export function refundTierForCancellation(daysNotice: number): RefundTier {
  if (daysNotice >= 7) return { percent: 100, label: "full refund" };
  if (daysNotice >= 3) return { percent: 50, label: "50% refund" };
  return { percent: 0, label: "no refund" };
}
```

- [ ] **Step 2: Write a throwaway correctness check**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
cat > scratch-check-booking-lib.mjs << 'EOF'
import { refundTierForCancellation, hoursUntil } from "./lib/booking.ts";

const cases = [
  [7, 100], [7.5, 100], [6.99, 50], [3, 50], [2.99, 0], [0, 0],
];
for (const [days, expected] of cases) {
  const tier = refundTierForCancellation(days);
  console.log(days, "->", tier.percent, tier.percent === expected ? "OK" : "FAIL expected " + expected);
}

const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
console.log("hoursUntil(+3h) ~=", hoursUntil(future).toFixed(2), "(expect ~3.00)");
EOF
npx tsx scratch-check-booking-lib.mjs 2>&1 || node --experimental-strip-types scratch-check-booking-lib.mjs
rm scratch-check-booking-lib.mjs
```

Expected: every case prints `OK`, and `hoursUntil` prints a value close
to `3.00`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/booking.ts
git commit -m "Add shared reschedule/cancellation policy constants and time helpers"
```

---

## Task 5: Confirmation email templates

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Consumes: `formatTimeRange`, `formatDate`, `formatCents` from
  `lib/format.ts`; `SITE_URL`, `BUSINESS` from `lib/seo.ts`.
- Produces: `sendBookingConfirmedEmail(params)`,
  `sendRescheduleConfirmedEmail(slot)`,
  `sendCancellationConfirmedEmail(params)` — consumed by Task 7 (webhook
  handlers) and Task 11 (cancel route). Leaves the existing
  `sendSigningLinkEmail` untouched — it's still used by the admin manual
  resend action (`app/api/admin/contracts/[id]/send-email/route.ts`).

- [ ] **Step 1: Add the new imports**

At the top of `lib/email.ts`, change:

```ts
import { Resend } from "resend";
import { BUSINESS, SITE_URL } from "@/lib/seo";
```

to:

```ts
import { Resend } from "resend";
import { BUSINESS, SITE_URL } from "@/lib/seo";
import { formatTimeRange, formatDate, formatCents } from "@/lib/format";
```

- [ ] **Step 2: Add `sendBookingConfirmedEmail`**

Append after the existing `sendSigningLinkEmail` function:

```ts
// Sent once from the Stripe webhook after a booking's deposit is
// confirmed (see lib/bookingWebhooks.ts). Combines the contract-signing
// link and the client's private manage link (reschedule/cancel) into
// one email, since both exist by the time this fires.
export async function sendBookingConfirmedEmail(params: {
  contractId: string;
  clientName: string;
  clientEmail: string;
  bookingToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }

  const signingUrl = `${SITE_URL}/sign/${params.contractId}`;
  const manageUrl = `${SITE_URL}/manage/${params.bookingToken}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: "You're booked!",
      text: [
        `Hi ${params.clientName},`,
        "",
        "Thanks for booking and for your deposit — you're all set.",
        "",
        "Please sign your session agreement here:",
        signingUrl,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(params.clientName)},</p>
        <p>Thanks for booking and for your deposit — you're all set.</p>
        <p>Please sign your session agreement here:</p>
        <p><a href="${signingUrl}">${signingUrl}</a></p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Resend error." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}
```

- [ ] **Step 3: Add `sendRescheduleConfirmedEmail`**

```ts
// Sent after a reschedule (free or paid) actually swaps the client onto
// their new slot.
export async function sendRescheduleConfirmedEmail(slot: {
  client_name: string | null;
  client_email: string | null;
  session_type: string;
  start_time: string;
  end_time: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }
  if (!slot.client_email || !slot.client_name) {
    return { ok: false, error: "Missing client info on slot." };
  }

  const when = formatTimeRange(slot.start_time, slot.end_time);
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [slot.client_email],
      subject: "Your session has been rescheduled",
      text: [
        `Hi ${slot.client_name},`,
        "",
        `Your ${slot.session_type} session is now scheduled for ${when}.`,
        "",
        "See you then,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(slot.client_name)},</p>
        <p>Your ${escapeHtml(slot.session_type)} session is now scheduled for ${escapeHtml(when)}.</p>
        <p>See you then,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Resend error." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}
```

- [ ] **Step 4: Add `sendCancellationConfirmedEmail`**

```ts
// Sent after a cancellation, regardless of whether the Stripe refund
// call itself succeeded — refundStatus === "failed" still confirms the
// cancellation to the client, just without promising a refund amount.
export async function sendCancellationConfirmedEmail(params: {
  clientName: string;
  clientEmail: string;
  sessionType: string;
  startTime: string;
  refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";
  refundAmountCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }

  const when = formatDate(params.startTime);
  const refundLine =
    params.refundStatus === "refunded"
      ? `A full refund of ${formatCents(params.refundAmountCents)} has been issued.`
      : params.refundStatus === "partial_refund"
        ? `A partial refund of ${formatCents(params.refundAmountCents)} has been issued.`
        : params.refundStatus === "no_refund"
          ? "Per our cancellation policy, this booking wasn't eligible for a refund."
          : "We're processing your refund and will follow up shortly.";

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: "Your session has been cancelled",
      text: [
        `Hi ${params.clientName},`,
        "",
        `Your ${params.sessionType} session on ${when} has been cancelled.`,
        refundLine,
        "",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(params.clientName)},</p>
        <p>Your ${escapeHtml(params.sessionType)} session on ${escapeHtml(when)} has been cancelled.</p>
        <p>${escapeHtml(refundLine)}</p>
        <p>${escapeHtml(BUSINESS.name)}</p>
      `,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Resend error." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts
git commit -m "Add booking-confirmed, reschedule, and cancellation email templates"
```

---

## Task 6: Rework `/api/book` to hold the slot and start a deposit Checkout

**Files:**
- Modify: `lib/stripe.ts`
- Modify: `app/api/book/route.ts`
- Modify: `app/book/BookingFlow.tsx`
- Create: `app/book/confirmed/page.tsx`

**Interfaces:**
- Consumes: `getStripeClient()` (Task 1), `PENDING_HOLD_MINUTES` (Task 4).
- Produces: `createDepositCheckoutSession(params): Promise<Stripe.Checkout.Session>`
  in `lib/stripe.ts`, consumed by nothing else in this plan but documents
  the pattern Task 9 mirrors for the reschedule fee.
- `POST /api/book` now returns `{ ok: true, checkoutUrl: string }` instead
  of `{ ok: true, slot, contract }` — this is a breaking response-shape
  change, which is why `BookingFlow.tsx` is updated in the same task.

- [ ] **Step 1: Add `createDepositCheckoutSession` to `lib/stripe.ts`**

Append to `lib/stripe.ts`:

```ts
import { SITE_URL } from "@/lib/seo";

const HOLD_SECONDS = 30 * 60;

export async function createDepositCheckoutSession(params: {
  slotId: string;
  amountCents: number;
  sessionType: string;
  clientEmail: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: params.clientEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: { name: `${params.sessionType} session deposit` },
        },
        quantity: 1,
      },
    ],
    metadata: { purpose: "booking_deposit", slotId: params.slotId },
    success_url: `${SITE_URL}/book/confirmed`,
    cancel_url: `${SITE_URL}/book`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
  });
}
```

(The `import Stripe from "stripe";` already at the top of the file
covers the `Stripe.Checkout.Session` type reference here.)

- [ ] **Step 2: Rewrite `app/api/book/route.ts`**

Replace the whole file with:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { createDepositCheckoutSession } from "@/lib/stripe";
import { PENDING_HOLD_MINUTES } from "@/lib/booking";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  slotId: string;
  clientName: string;
  clientEmail: string;
  notes: string;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slotId, clientName, clientEmail, notes } = body as Record<
    string,
    unknown
  >;

  if (
    typeof slotId !== "string" ||
    typeof clientName !== "string" ||
    typeof clientEmail !== "string" ||
    typeof notes !== "string"
  ) {
    return null;
  }

  const trimmed = {
    slotId: slotId.trim(),
    clientName: clientName.trim(),
    clientEmail: clientEmail.trim(),
    notes: notes.trim(),
  };

  if (
    !trimmed.slotId ||
    !trimmed.clientName ||
    !EMAIL_REGEX.test(trimmed.clientEmail)
  ) {
    return null;
  }

  return trimmed;
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please fill out all required fields with a valid email address." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  // Race-safe hold: only succeeds if the slot is still open, so two
  // clients hitting the same slot at once can't both start checkout for
  // it.
  const { data: slot, error: holdError } = await supabase
    .from("booking_slots")
    .update({
      status: "pending",
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_notes: payload.notes || null,
      pending_expires_at: new Date(
        Date.now() + PENDING_HOLD_MINUTES * 60 * 1000,
      ).toISOString(),
    })
    .eq("id", payload.slotId)
    .eq("status", "open")
    .select("id, deposit_cents, session_type")
    .maybeSingle();

  if (holdError) {
    console.error("Failed to hold booking slot:", holdError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!slot) {
    return Response.json(
      { error: "That time is no longer available. Please pick another." },
      { status: 409 },
    );
  }

  try {
    const session = await createDepositCheckoutSession({
      slotId: slot.id,
      amountCents: slot.deposit_cents,
      sessionType: slot.session_type,
      clientEmail: payload.clientEmail,
    });

    return Response.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create deposit checkout session:", err);
    // Release the hold — no point leaving the slot stuck pending if we
    // couldn't even start checkout.
    await supabase
      .from("booking_slots")
      .update({
        status: "open",
        client_name: null,
        client_email: null,
        client_notes: null,
        pending_expires_at: null,
      })
      .eq("id", slot.id)
      .eq("status", "pending");

    return Response.json(
      { error: "Something went wrong starting checkout." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Update `BookingFlow.tsx` to redirect to Stripe**

In `app/book/BookingFlow.tsx`, remove the `confirmedSlot` state and its
rendering branch entirely (the confirmation now happens on a dedicated
page, since payment confirmation is asynchronous). Specifically:

Remove this line from the state declarations:

```ts
const [confirmedSlot, setConfirmedSlot] = useState<Slot | null>(null);
```

Remove this whole block (the `if (confirmedSlot) { ... }` early return):

```tsx
  if (confirmedSlot) {
    return (
      <div className="border border-accent/40 bg-surface p-6 text-center">
        ...
      </div>
    );
  }
```

Replace the body of `handleSubmit` with:

```ts
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSlot || status === "loading") return;

    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: selectedSlot.id, ...form }),
      });

      const data: { checkoutUrl?: string; error?: string } =
        await response.json();

      if (!response.ok || !data.checkoutUrl) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }
```

Update the submit button's label from "Confirm booking" to reflect that
it now leads to payment:

```tsx
{status === "loading" ? "Starting checkout…" : "Continue to payment"}
```

- [ ] **Step 4: Create the post-checkout confirmation page**

`app/book/confirmed/page.tsx`:

```tsx
import type { Metadata } from "next";

// Reached via Stripe Checkout's success_url. The booking itself is
// finalized asynchronously by the webhook (see lib/bookingWebhooks.ts),
// so this page doesn't query anything — it can't know the finalization
// has landed yet, and doesn't need to.
export function generateMetadata(): Metadata {
  return {
    title: "Booking Confirmed",
    robots: { index: false, follow: false },
  };
}

export default function BookingConfirmedPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Booked
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        You&rsquo;re all set.
      </h1>
      <p className="mt-4 text-muted">
        Check your email for your session agreement and your private
        booking link, where you can reschedule or cancel later if you
        need to.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/stripe.ts app/api/book/route.ts app/book/BookingFlow.tsx app/book/confirmed/page.tsx
git commit -m "Hold the slot and start a Stripe Checkout deposit on booking"
```

(No manual test here yet — the flow can't complete end-to-end until the
webhook handler exists. That's Task 7.)

---

## Task 7: Stripe webhook — finalize the deposit-paid booking

**Files:**
- Create: `lib/bookingWebhooks.ts`
- Create: `app/api/webhooks/stripe/route.ts`

**Interfaces:**
- Consumes: `getStripeClient()` (Task 1), `sendBookingConfirmedEmail`
  (Task 5), `fillTemplate` (existing `lib/contracts.ts`).
- Produces: `handleDepositCheckoutCompleted(session)`,
  `handleCheckoutExpired(session)` in `lib/bookingWebhooks.ts` — Task 10
  adds a third export, `handleRescheduleFeeCheckoutCompleted`, to this
  same file.

This task completes the first fully working vertical slice: a client can
book, pay a deposit, and get their confirmation email end-to-end.

- [ ] **Step 1: Create `lib/bookingWebhooks.ts`**

```ts
// Domain logic for Stripe webhook events touching booking_slots — kept
// out of app/api/webhooks/stripe/route.ts so that route stays a thin,
// signature-verified dispatcher (same split as lib/contracts.ts /
// lib/email.ts versus the routes that call them).

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendBookingConfirmedEmail } from "@/lib/email";

const DEFAULT_TEMPLATE_TYPE = "booking_agreement";

export async function handleDepositCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  const slotId = session.metadata?.slotId;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!slotId || !paymentIntentId) {
    console.error(
      "Deposit checkout completed with missing metadata:",
      session.id,
    );
    return;
  }

  const supabase = getSupabaseClient();

  // Idempotency: only finalize a slot that's still held for this
  // checkout. A duplicate webhook delivery finds status already
  // 'booked' and no-ops here.
  const { data: slot, error: claimError } = await supabase
    .from("booking_slots")
    .update({
      status: "booked",
      deposit_payment_intent_id: paymentIntentId,
      booking_token: crypto.randomUUID(),
      refund_status: null,
      refund_amount_cents: null,
      pending_expires_at: null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to finalize deposit booking:", claimError);
    return;
  }

  if (!slot) {
    console.log(
      "Deposit checkout completed but slot wasn't pending (likely a duplicate webhook delivery):",
      slotId,
    );
    return;
  }

  // Best-effort — the booking itself already succeeded above, so a lead
  // logging failure shouldn't fail the whole request.
  try {
    const { error: leadError } = await supabase.from("leads").insert({
      name: slot.client_name,
      email: slot.client_email,
      session_type: slot.session_type,
      message: slot.client_notes || `Booked via /book for ${slot.session_type}.`,
      source: "booking",
      status: "booked",
    });
    if (leadError) {
      console.error("Failed to record lead from booking:", leadError);
    }
  } catch (err) {
    console.error("Failed to record lead from booking:", err);
  }

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", DEFAULT_TEMPLATE_TYPE)
    .maybeSingle();

  if (templateError || !template) {
    console.error("Failed to load booking_agreement template:", templateError);
    return;
  }

  const sessionDate = new Date(slot.start_time).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contractText = fillTemplate(template.content, {
    clientName: slot.client_name!,
    clientEmail: slot.client_email!,
    sessionType: slot.session_type,
    sessionDate,
  });

  const { data: contract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      template_type: DEFAULT_TEMPLATE_TYPE,
      client_name: slot.client_name,
      client_email: slot.client_email,
      contract_text: contractText,
      appointment_id: slot.id,
      appointment_date: slot.start_time,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Failed to create contract for booking:", insertError);
    return;
  }

  const emailResult = await sendBookingConfirmedEmail({
    contractId: contract.id,
    clientName: slot.client_name!,
    clientEmail: slot.client_email!,
    bookingToken: slot.booking_token,
  });

  if (!emailResult.ok) {
    console.error("Failed to send booking-confirmed email:", emailResult.error);
  } else {
    const { error: updateError } = await supabase
      .from("contracts")
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (updateError) {
      console.error("Email sent but failed to record email_sent flag:", updateError);
    }
  }
}

export async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const purpose = session.metadata?.purpose;
  const slotId =
    purpose === "booking_deposit"
      ? session.metadata?.slotId
      : session.metadata?.targetSlotId;

  if (!slotId) {
    console.error("Checkout expired with no slot id in metadata:", session.id);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      pending_expires_at: null,
    })
    .eq("id", slotId)
    .eq("status", "pending");

  if (error) {
    console.error("Failed to release expired pending slot:", error);
  }
}
```

Note: `crypto.randomUUID()` uses Node's global Web Crypto API
(available without an import in Node 19+, which this project already
requires — see `package.json`'s `node_modules/next` engine floor).

- [ ] **Step 2: Create the webhook route**

`app/api/webhooks/stripe/route.ts`:

```ts
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import {
  handleDepositCheckoutCompleted,
  handleCheckoutExpired,
} from "@/lib/bookingWebhooks";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.purpose === "booking_deposit") {
      await handleDepositCheckoutCompleted(session);
    }
    // "reschedule_fee" purpose is handled starting in Task 10.
  } else if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }

  return Response.json({ received: true });
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 4: End-to-end manual test — deposit checkout completes**

With `npm run dev` and `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
both running (Task 1, Step 5):

1. Create a test slot with a deposit (same pattern as Task 3, Step 6),
   note its `id`.
2. Start a booking:
   ```bash
   curl -s -X POST http://localhost:3000/api/book -H "Content-Type: application/json" \
     -d '{"slotId":"<slot-id>","clientName":"Webhook Test","clientEmail":"zach@zkjfilms.com","notes":""}'
   ```
   Expected: `{"ok":true,"checkoutUrl":"https://checkout.stripe.com/..."}`.
3. Confirm the slot is now `pending`:
   ```bash
   curl -s http://localhost:3000/admin/availability -H "Cookie: $COOKIE" | grep -o "Pending checkout"
   ```
4. Open the `checkoutUrl` in a browser and pay with Stripe's test card
   `4242 4242 4242 4242`, any future expiry, any CVC.
5. Watch the `stripe listen` terminal — it should show
   `checkout.session.completed` forwarded with a `200` response.
6. Verify the slot is now `booked` and a contract/lead exist:
   ```bash
   cd /Users/zachjohnson/Projects/portfolio-site
   cat > scratch-verify-booking.mjs << 'EOF'
   import { createClient } from "@supabase/supabase-js";
   const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
   const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
   const { data: slot } = await supabase.from("booking_slots").select("*").eq("id", "<slot-id>").single();
   console.log("slot:", JSON.stringify(slot, null, 2));
   const { data: contract } = await supabase.from("contracts").select("id, client_name, appointment_id").eq("appointment_id", "<slot-id>").maybeSingle();
   console.log("contract:", JSON.stringify(contract, null, 2));
   EOF
   node --env-file=.env.local scratch-verify-booking.mjs
   rm scratch-verify-booking.mjs
   ```
   Expected: `slot.status` is `"booked"`, `slot.booking_token` is a UUID,
   `slot.deposit_payment_intent_id` starts with `pi_`, and `contract` is
   non-null.
7. Confirm the email arrived at zach@zkjfilms.com with both a `/sign/...`
   and a `/manage/...` link.
8. **Clean up test data** the same way as prior sessions — delete the
   contract, the lead (`source = 'booking'`, matching email/name), and
   the slot row, so nothing test-related lingers in production data.

- [ ] **Step 5: Manual test — abandoned checkout releases the slot**

1. Create another test slot, start a booking (`POST /api/book`) to get a
   fresh `checkoutUrl`, but don't complete payment.
2. Trigger the expiry event manually instead of waiting 30 minutes:
   `stripe trigger checkout.session.expired`
   (Note: this fires a *synthetic* test event with fabricated metadata,
   not tied to your real session — for a true test of the actual path,
   instead lower `HOLD_SECONDS` temporarily to e.g. `60` in
   `lib/stripe.ts`, wait a minute past creating the session, and confirm
   Stripe fires the real expiry. Revert the temporary change afterward.)
3. Verify the slot returns to `open` and its client fields are cleared.

- [ ] **Step 6: Commit**

```bash
git add lib/bookingWebhooks.ts app/api/webhooks/stripe/route.ts
git commit -m "Add Stripe webhook to finalize deposit-paid bookings"
```

---

## Task 8: Add `/book` to the main nav and lock down `/manage` in robots.ts

**Files:**
- Modify: `components/Navbar.tsx`
- Modify: `app/robots.ts`

**Interfaces:** none (leaf UI/config change).

- [ ] **Step 1: Add the nav link**

In `components/Navbar.tsx`, change:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];
```

to:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];
```

- [ ] **Step 2: Disallow the private manage links and the transient confirmation page**

In `app/robots.ts`, change:

```ts
disallow: ["/gated", "/gallery", "/admin", "/sign"],
```

to:

```ts
disallow: ["/gated", "/gallery", "/admin", "/sign", "/manage", "/book/confirmed"],
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 4: Verify**

```bash
curl -s http://localhost:3000/ | grep -o 'href="/book"[^<]*<[^>]*>[A-Za-z]*'
curl -s http://localhost:3000/robots.txt | grep -i manage
```

Expected: the nav link markup appears, and `Disallow: /manage` (or
equivalent) is in `robots.txt`.

- [ ] **Step 5: Commit**

```bash
git add components/Navbar.tsx app/robots.ts
git commit -m "Add /book to the main nav; disallow /manage and /book/confirmed"
```

---

## Task 9: `/manage/[token]` page — view current booking + reschedule options

**Files:**
- Create: `app/manage/[token]/page.tsx`
- Create: `app/manage/[token]/ManageBooking.tsx`

**Interfaces:**
- Produces: `ManageBooking` client component, props
  `{ token: string; booking: Booking; otherSlots: Slot[] }` where
  `Booking = { id: string; start_time: string; end_time: string; session_type: string; client_name: string | null; client_email: string | null }`
  and `Slot = { id: string; start_time: string; end_time: string; session_type: string }`
  — read-only in this task; Task 10 wires the reschedule button to a real
  API call, and Task 12 wires the cancel button.

This task is read-only (no mutations yet) so it's independently
verifiable before the reschedule/cancel API routes exist.

- [ ] **Step 1: Create the page**

`app/manage/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ManageBooking from "./ManageBooking";

// Private links — never indexed, disallowed in robots.ts too.
export function generateMetadata(): Metadata {
  return {
    title: "Manage Your Booking",
    robots: { index: false, follow: false },
  };
}

function BookingNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Booking
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Not found
      </h1>
      <p className="mt-4 text-muted">
        This link doesn&rsquo;t match an active booking. It may already
        have been rescheduled or cancelled — contact us if you need help.
      </p>
    </div>
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("booking_slots")
    .select("id, start_time, end_time, session_type, client_name, client_email")
    .eq("booking_token", token)
    .eq("status", "booked")
    .maybeSingle();

  if (error) {
    console.error("Supabase booking lookup by token failed:", error);
  }

  if (!booking) {
    return <BookingNotFound />;
  }

  const { data: otherSlots, error: slotsError } = await supabase
    .from("booking_slots")
    .select("id, start_time, end_time, session_type")
    .eq("status", "open")
    .eq("session_type", booking.session_type)
    .gte("start_time", nowIso())
    .order("start_time", { ascending: true });

  if (slotsError) {
    console.error("Supabase open-slots lookup failed:", slotsError);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Manage Booking
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Your <span className="text-accent">session</span>.
        </h1>
      </header>

      <ManageBooking token={token} booking={booking} otherSlots={otherSlots ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client component**

`app/manage/[token]/ManageBooking.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatTimeRange } from "@/lib/format";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
};

type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
  client_name: string | null;
  client_email: string | null;
};

type View = "idle" | "rescheduling" | "cancelling";

export default function ManageBooking({
  token,
  booking,
  otherSlots,
}: {
  token: string;
  booking: Booking;
  otherSlots: Slot[];
}) {
  const [view, setView] = useState<View>("idle");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleReschedule() {
    if (!selectedSlotId || pending) return;
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/manage/${token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSlotId: selectedSlotId }),
      });

      const data: {
        error?: string;
        freeSwap?: boolean;
        checkoutUrl?: string;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }

      if (data.freeSwap) {
        window.location.reload();
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setError("Something went wrong. Please try again.");
      setPending(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-10">
      <div className="border border-border p-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Current appointment
        </p>
        <p className="mt-2 text-lg text-foreground">
          {booking.session_type} —{" "}
          {formatTimeRange(booking.start_time, booking.end_time)}
        </p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {view === "idle" && (
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => setView("rescheduling")}
            className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={() => setView("cancelling")}
            className="border border-border px-6 py-3 text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:border-red-700 hover:text-red-700"
          >
            Cancel
          </button>
        </div>
      )}

      {view === "rescheduling" && (
        <div>
          <p className="mb-4 text-xs uppercase tracking-[0.15em] text-muted">
            Choose a new time
          </p>
          {otherSlots.length === 0 ? (
            <p className="text-muted">
              No other open times right now for {booking.session_type} —
              check back soon.
            </p>
          ) : (
            <div className="space-y-2">
              {otherSlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`block w-full border px-4 py-3 text-left transition-colors ${
                    selectedSlotId === slot.id
                      ? "border-accent"
                      : "border-border hover:border-accent"
                  }`}
                >
                  {formatTimeRange(slot.start_time, slot.end_time)}
                </button>
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-muted">
            Rescheduling less than 72 hours before your current
            appointment incurs a $50 fee, charged before the change takes
            effect. 72 hours or more out, it&rsquo;s free.
          </p>

          <div className="mt-6 flex gap-4">
            <button
              type="button"
              onClick={handleReschedule}
              disabled={!selectedSlotId || pending}
              className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Working…" : "Confirm reschedule"}
            </button>
            <button
              type="button"
              onClick={() => {
                setView("idle");
                setSelectedSlotId(null);
                setError("");
              }}
              disabled={pending}
              className="text-xs uppercase tracking-[0.15em] text-muted hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {view === "cancelling" && (
        <div>
          <p className="text-sm text-foreground">
            Cancellation refunds your deposit based on notice given: full
            refund at 7+ days out, 50% at 3–7 days, and no refund inside
            3 days.
          </p>
          <div className="mt-6 flex gap-4">
            <button
              type="button"
              disabled={pending}
              className="border border-red-700 px-6 py-3 text-xs uppercase tracking-[0.2em] text-red-700 transition-colors hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm cancellation
            </button>
            <button
              type="button"
              onClick={() => {
                setView("idle");
                setError("");
              }}
              disabled={pending}
              className="text-xs uppercase tracking-[0.15em] text-muted hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

(The cancel button is inert until Task 12 wires it up — this task is
scoped to viewing + reschedule UI only.)

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 4: Manual test — page renders for a real booking**

Reuse the booking created in Task 7 Step 4 before you cleaned it up, or
create + pay a fresh one the same way. Then:

```bash
curl -s http://localhost:3000/manage/<booking_token> | grep -o "Current appointment"
curl -s http://localhost:3000/manage/not-a-real-token | grep -o "Not found"
```

Expected: first command finds the match, second finds "Not found".
Clean up test data afterward as in prior tasks.

- [ ] **Step 5: Commit**

```bash
git add app/manage
git commit -m "Add /manage/[token] page showing the current booking and reschedule options"
```

---

## Task 10: Reschedule API — free path and paid (<72h) path

**Files:**
- Modify: `lib/stripe.ts`
- Modify: `lib/bookingWebhooks.ts`
- Modify: `app/api/webhooks/stripe/route.ts`
- Create: `app/api/manage/[token]/reschedule/route.ts`

**Interfaces:**
- Consumes: `hoursUntil`, `RESCHEDULE_NOTICE_HOURS`, `RESCHEDULE_FEE_CENTS`,
  `PENDING_HOLD_MINUTES` (Task 4); `sendRescheduleConfirmedEmail` (Task 5).
- Produces: `createRescheduleFeeCheckoutSession(params)` in
  `lib/stripe.ts`; `handleRescheduleFeeCheckoutCompleted(session)` in
  `lib/bookingWebhooks.ts`, wired into the webhook route's dispatch.

- [ ] **Step 1: Add `createRescheduleFeeCheckoutSession` to `lib/stripe.ts`**

Append:

```ts
export async function createRescheduleFeeCheckoutSession(params: {
  bookingToken: string;
  currentSlotId: string;
  targetSlotId: string;
  clientEmail: string;
  amountCents: number;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: params.clientEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: { name: "Short-notice reschedule fee" },
        },
        quantity: 1,
      },
    ],
    metadata: {
      purpose: "reschedule_fee",
      bookingToken: params.bookingToken,
      currentSlotId: params.currentSlotId,
      targetSlotId: params.targetSlotId,
    },
    success_url: `${SITE_URL}/manage/${params.bookingToken}?paid=1`,
    cancel_url: `${SITE_URL}/manage/${params.bookingToken}`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
  });
}
```

- [ ] **Step 2: Add `handleRescheduleFeeCheckoutCompleted` to `lib/bookingWebhooks.ts`**

Add this import at the top (alongside the existing ones):

```ts
import { sendRescheduleConfirmedEmail } from "@/lib/email";
```

(Combine into the existing `import { sendBookingConfirmedEmail } from "@/lib/email";`
line as `import { sendBookingConfirmedEmail, sendRescheduleConfirmedEmail } from "@/lib/email";`.)

Append the new function:

```ts
export async function handleRescheduleFeeCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  const bookingToken = session.metadata?.bookingToken;
  const currentSlotId = session.metadata?.currentSlotId;
  const targetSlotId = session.metadata?.targetSlotId;

  if (!bookingToken || !currentSlotId || !targetSlotId) {
    console.error(
      "Reschedule-fee checkout completed with missing metadata:",
      session.id,
    );
    return;
  }

  const supabase = getSupabaseClient();

  const { data: current, error: currentError } = await supabase
    .from("booking_slots")
    .select("id, client_name, client_email, client_notes, deposit_payment_intent_id")
    .eq("id", currentSlotId)
    .eq("status", "booked")
    .maybeSingle();

  if (currentError) {
    console.error("Failed to load current slot for reschedule swap:", currentError);
    return;
  }

  if (!current) {
    console.error(
      "Reschedule-fee checkout completed but current slot is no longer booked:",
      currentSlotId,
    );
    return;
  }

  // Idempotency: only claim a target that's still held for this
  // checkout. A duplicate webhook delivery finds status already
  // 'booked' and no-ops here.
  const { data: claimed, error: claimError } = await supabase
    .from("booking_slots")
    .update({
      status: "booked",
      client_name: current.client_name,
      client_email: current.client_email,
      client_notes: current.client_notes,
      booking_token: bookingToken,
      deposit_payment_intent_id: current.deposit_payment_intent_id,
      refund_status: null,
      refund_amount_cents: null,
      pending_expires_at: null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", targetSlotId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to claim target slot for paid reschedule:", claimError);
    return;
  }

  if (!claimed) {
    console.log(
      "Reschedule-fee checkout completed but target slot wasn't pending (likely a duplicate webhook delivery):",
      targetSlotId,
    );
    return;
  }

  const { error: releaseError } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      booked_at: null,
      booking_token: null,
      deposit_payment_intent_id: null,
    })
    .eq("id", current.id);

  if (releaseError) {
    console.error("Failed to release original slot after paid reschedule:", releaseError);
  }

  const emailResult = await sendRescheduleConfirmedEmail(claimed);
  if (!emailResult.ok) {
    console.error("Failed to send reschedule confirmation email:", emailResult.error);
  }
}
```

- [ ] **Step 3: Wire the new handler into the webhook route**

In `app/api/webhooks/stripe/route.ts`, change:

```ts
import {
  handleDepositCheckoutCompleted,
  handleCheckoutExpired,
} from "@/lib/bookingWebhooks";
```

to:

```ts
import {
  handleDepositCheckoutCompleted,
  handleRescheduleFeeCheckoutCompleted,
  handleCheckoutExpired,
} from "@/lib/bookingWebhooks";
```

And change:

```ts
    if (session.metadata?.purpose === "booking_deposit") {
      await handleDepositCheckoutCompleted(session);
    }
    // "reschedule_fee" purpose is handled starting in Task 10.
```

to:

```ts
    if (session.metadata?.purpose === "booking_deposit") {
      await handleDepositCheckoutCompleted(session);
    } else if (session.metadata?.purpose === "reschedule_fee") {
      await handleRescheduleFeeCheckoutCompleted(session);
    }
```

- [ ] **Step 4: Create the reschedule API route**

`app/api/manage/[token]/reschedule/route.ts`:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { createRescheduleFeeCheckoutSession } from "@/lib/stripe";
import {
  hoursUntil,
  RESCHEDULE_NOTICE_HOURS,
  RESCHEDULE_FEE_CENTS,
  PENDING_HOLD_MINUTES,
} from "@/lib/booking";
import { sendRescheduleConfirmedEmail } from "@/lib/email";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const targetSlotId =
    typeof rawBody === "object" &&
    rawBody !== null &&
    "targetSlotId" in rawBody
      ? (rawBody as { targetSlotId: unknown }).targetSlotId
      : null;

  if (typeof targetSlotId !== "string" || !targetSlotId) {
    return Response.json(
      { error: "A target slot is required." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  const { data: current, error: currentError } = await supabase
    .from("booking_slots")
    .select(
      "id, start_time, session_type, client_name, client_email, client_notes, deposit_payment_intent_id",
    )
    .eq("booking_token", token)
    .eq("status", "booked")
    .maybeSingle();

  if (currentError) {
    console.error("Supabase current-booking lookup failed:", currentError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!current) {
    return Response.json(
      { error: "This link doesn't match an active booking." },
      { status: 404 },
    );
  }

  const { data: target, error: targetError } = await supabase
    .from("booking_slots")
    .select("id, session_type")
    .eq("id", targetSlotId)
    .eq("status", "open")
    .maybeSingle();

  if (targetError) {
    console.error("Supabase target-slot lookup failed:", targetError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!target) {
    return Response.json(
      { error: "That time is no longer available." },
      { status: 409 },
    );
  }

  if (target.session_type !== current.session_type) {
    return Response.json(
      {
        error: `You can only reschedule into another ${current.session_type} slot.`,
      },
      { status: 400 },
    );
  }

  const hoursNotice = hoursUntil(current.start_time);

  if (hoursNotice >= RESCHEDULE_NOTICE_HOURS) {
    // Free path — swap immediately, race-safe on the target slot's
    // claim (same guard pattern as /api/book's original claim).
    const { data: claimed, error: claimError } = await supabase
      .from("booking_slots")
      .update({
        status: "booked",
        client_name: current.client_name,
        client_email: current.client_email,
        client_notes: current.client_notes,
        booking_token: token,
        deposit_payment_intent_id: current.deposit_payment_intent_id,
        refund_status: null,
        refund_amount_cents: null,
        booked_at: new Date().toISOString(),
      })
      .eq("id", target.id)
      .eq("status", "open")
      .select()
      .maybeSingle();

    if (claimError) {
      console.error("Failed to claim target slot for reschedule:", claimError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }

    if (!claimed) {
      return Response.json(
        { error: "That time is no longer available." },
        { status: 409 },
      );
    }

    const { error: releaseError } = await supabase
      .from("booking_slots")
      .update({
        status: "open",
        client_name: null,
        client_email: null,
        client_notes: null,
        booked_at: null,
        booking_token: null,
        deposit_payment_intent_id: null,
      })
      .eq("id", current.id);

    if (releaseError) {
      console.error("Failed to release original slot after reschedule:", releaseError);
    }

    const emailResult = await sendRescheduleConfirmedEmail(claimed);
    if (!emailResult.ok) {
      console.error("Failed to send reschedule confirmation email:", emailResult.error);
    }

    return Response.json({ ok: true, freeSwap: true, slot: claimed });
  }

  // <72h — hold the target slot and charge the $50 fee via Stripe
  // Checkout before the swap takes effect (finished by the webhook).
  const { data: held, error: holdError } = await supabase
    .from("booking_slots")
    .update({
      status: "pending",
      pending_expires_at: new Date(
        Date.now() + PENDING_HOLD_MINUTES * 60 * 1000,
      ).toISOString(),
    })
    .eq("id", target.id)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (holdError) {
    console.error("Failed to hold target slot for reschedule fee checkout:", holdError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!held) {
    return Response.json(
      { error: "That time is no longer available." },
      { status: 409 },
    );
  }

  try {
    const session = await createRescheduleFeeCheckoutSession({
      bookingToken: token,
      currentSlotId: current.id,
      targetSlotId: target.id,
      clientEmail: current.client_email!,
      amountCents: RESCHEDULE_FEE_CENTS,
    });

    return Response.json({ ok: true, freeSwap: false, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create reschedule-fee checkout session:", err);
    await supabase
      .from("booking_slots")
      .update({ status: "open", pending_expires_at: null })
      .eq("id", target.id)
      .eq("status", "pending");
    return Response.json(
      { error: "Something went wrong starting checkout." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 6: Manual test — free reschedule (≥72h notice)**

1. Book and pay a deposit for a slot at least 4 days out (same flow as
   Task 7 Step 4), note its `booking_token`.
2. Create a second open slot of the **same session type**, at least 4
   days out, note its `id`.
3. Call the reschedule route directly:
   ```bash
   curl -s -X POST http://localhost:3000/api/manage/<booking_token>/reschedule \
     -H "Content-Type: application/json" \
     -d '{"targetSlotId":"<second-slot-id>"}'
   ```
   Expected: `{"ok":true,"freeSwap":true,"slot":{...}}` immediately, no
   Stripe redirect.
4. Confirm `/manage/<booking_token>` still resolves and now shows the
   new time; confirm the original slot is back to `open`.
5. Confirm the reschedule confirmation email arrived.
6. Clean up test data.

- [ ] **Step 7: Manual test — paid reschedule (<72h notice)**

1. Book and pay a deposit for a slot **less than 72 hours** out (e.g. 12
   hours from now), note its `booking_token`.
2. Create a second open slot of the same session type, also within the
   next few days, note its `id`.
3. Call the reschedule route:
   ```bash
   curl -s -X POST http://localhost:3000/api/manage/<booking_token>/reschedule \
     -H "Content-Type: application/json" \
     -d '{"targetSlotId":"<second-slot-id>"}'
   ```
   Expected: `{"ok":true,"freeSwap":false,"checkoutUrl":"https://checkout.stripe.com/..."}`.
4. Confirm the target slot is now `pending` in `/admin/availability`,
   and the *original* slot is still `booked` (unchanged until payment
   completes).
5. Open the `checkoutUrl`, pay with the Stripe test card.
6. Confirm (via the same Supabase check pattern as Task 7 Step 4) that
   the target slot is now `booked` with the same `booking_token`, and
   the original slot is back to `open`.
7. Confirm the reschedule confirmation email arrived.
8. Clean up test data.

- [ ] **Step 8: Commit**

```bash
git add lib/stripe.ts lib/bookingWebhooks.ts app/api/webhooks/stripe/route.ts app/api/manage
git commit -m "Add reschedule API: free swap at 72h+ notice, paid Checkout under that"
```

---

## Task 11: Cancellation API — tiered refund

**Files:**
- Create: `app/api/manage/[token]/cancel/route.ts`

**Interfaces:**
- Consumes: `daysUntil`, `refundTierForCancellation` (Task 4);
  `getStripeClient()` (Task 1); `sendCancellationConfirmedEmail` (Task 5).
- Produces: `POST /api/manage/[token]/cancel` →
  `{ ok: true, refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed", refundAmountCents: number }`,
  consumed by Task 12's UI wiring.

- [ ] **Step 1: Create the cancellation route**

`app/api/manage/[token]/cancel/route.ts`:

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { daysUntil, refundTierForCancellation } from "@/lib/booking";
import { sendCancellationConfirmedEmail } from "@/lib/email";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("booking_slots")
    .select(
      "id, start_time, session_type, deposit_cents, deposit_payment_intent_id, client_name, client_email",
    )
    .eq("booking_token", token)
    .eq("status", "booked")
    .maybeSingle();

  if (error) {
    console.error("Supabase booking lookup for cancellation failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!booking) {
    return Response.json(
      { error: "This link doesn't match an active booking." },
      { status: 404 },
    );
  }

  const tier = refundTierForCancellation(daysUntil(booking.start_time));
  const refundAmountCents = Math.round(
    (booking.deposit_cents * tier.percent) / 100,
  );

  let refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";

  if (tier.percent === 0 || refundAmountCents === 0) {
    refundStatus = "no_refund";
  } else if (!booking.deposit_payment_intent_id) {
    console.error(
      "Cancellation owed a refund but no deposit_payment_intent_id on file:",
      booking.id,
    );
    refundStatus = "failed";
  } else {
    try {
      const stripe = getStripeClient();
      await stripe.refunds.create({
        payment_intent: booking.deposit_payment_intent_id,
        amount: refundAmountCents,
      });
      refundStatus = tier.percent === 100 ? "refunded" : "partial_refund";
    } catch (err) {
      console.error("Stripe refund failed during cancellation:", err);
      refundStatus = "failed";
    }
  }

  // Cancellation always goes through, even if the refund above failed —
  // a Stripe hiccup shouldn't trap a client in a booking they no longer
  // want. refund_status = 'failed' is what flags this row in
  // /admin/availability for manual follow-up (note: that flag only
  // stays visible while this exact row remains 'open' — if it gets
  // rebooked before you notice, the flag clears with it. Stripe's own
  // dashboard is the durable fallback record of the failed attempt).
  const { error: releaseError } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      booked_at: null,
      booking_token: null,
      deposit_payment_intent_id: null,
      refund_status: refundStatus,
      refund_amount_cents: refundStatus === "failed" ? 0 : refundAmountCents,
    })
    .eq("id", booking.id);

  if (releaseError) {
    console.error("Failed to release slot after cancellation:", releaseError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  const emailResult = await sendCancellationConfirmedEmail({
    clientName: booking.client_name!,
    clientEmail: booking.client_email!,
    sessionType: booking.session_type,
    startTime: booking.start_time,
    refundStatus,
    refundAmountCents,
  });
  if (!emailResult.ok) {
    console.error("Failed to send cancellation confirmation email:", emailResult.error);
  }

  return Response.json({ ok: true, refundStatus, refundAmountCents });
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 3: Manual test — each refund tier**

Repeat this three times with appointment times 8 days, 5 days, and 1 day
out (booking + paying a deposit each time as in Task 7 Step 4):

```bash
curl -s -X POST http://localhost:3000/api/manage/<booking_token>/cancel
```

Expected:
- 8 days out → `{"ok":true,"refundStatus":"refunded","refundAmountCents":<full deposit>}`
- 5 days out → `{"ok":true,"refundStatus":"partial_refund","refundAmountCents":<half deposit>}`
- 1 day out → `{"ok":true,"refundStatus":"no_refund","refundAmountCents":0}`

For each: confirm in the Stripe Dashboard (test mode > Payments) that a
matching refund was issued for the `refunded`/`partial_refund` cases and
none for `no_refund`; confirm the slot is back to `open` with
`refund_status` set accordingly (check via `/admin/availability` or a
direct Supabase query); confirm the cancellation email arrived. Clean up
test data after each run.

- [ ] **Step 4: Manual test — refund failure still cancels**

1. Book and pay a deposit for a slot 8+ days out.
2. Before cancelling, manually corrupt the payment intent reference so
   the refund call fails:
   ```bash
   cd /Users/zachjohnson/Projects/portfolio-site
   cat > scratch-corrupt-pi.mjs << 'EOF'
   import { createClient } from "@supabase/supabase-js";
   const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
   const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
   const { error } = await supabase
     .from("booking_slots")
     .update({ deposit_payment_intent_id: "pi_does_not_exist" })
     .eq("id", "<slot-id>");
   console.log(error ?? "ok");
   EOF
   node --env-file=.env.local scratch-corrupt-pi.mjs
   rm scratch-corrupt-pi.mjs
   ```
3. Cancel it: `curl -s -X POST http://localhost:3000/api/manage/<booking_token>/cancel`
   Expected: `{"ok":true,"refundStatus":"failed","refundAmountCents":0}` —
   the request still succeeds.
4. Confirm the slot is `open` and shows the "refund needs manual
   follow-up" flag in `/admin/availability`.
5. Clean up test data.

- [ ] **Step 5: Commit**

```bash
git add app/api/manage
git commit -m "Add cancellation API with tiered refunds that never block on Stripe failure"
```

---

## Task 12: Wire the cancel button into `ManageBooking.tsx`

**Files:**
- Modify: `app/manage/[token]/ManageBooking.tsx`

**Interfaces:**
- Consumes: `POST /api/manage/[token]/cancel` (Task 11).

- [ ] **Step 1: Add cancellation state and handler**

In `app/manage/[token]/ManageBooking.tsx`, add a `formatCents` import:

```ts
import { formatTimeRange, formatCents } from "@/lib/format";
```

Add a `cancelResult` state and extend `View` to include `"cancelled"`:

```ts
type View = "idle" | "rescheduling" | "cancelling" | "cancelled";
```

```ts
const [cancelResult, setCancelResult] = useState<{
  refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";
  refundAmountCents: number;
} | null>(null);
```

Add the handler, right after `handleReschedule`:

```ts
  async function handleCancel() {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/manage/${token}/cancel`, {
        method: "POST",
      });

      const data: {
        error?: string;
        refundStatus?: "refunded" | "partial_refund" | "no_refund" | "failed";
        refundAmountCents?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }

      setCancelResult({
        refundStatus: data.refundStatus ?? "no_refund",
        refundAmountCents: data.refundAmountCents ?? 0,
      });
      setView("cancelled");
      setPending(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }
```

- [ ] **Step 2: Wire the button and add the cancelled view**

Change the inert cancel button:

```tsx
<button
  type="button"
  disabled={pending}
  className="border border-red-700 px-6 py-3 text-xs uppercase tracking-[0.2em] text-red-700 transition-colors hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
>
  Confirm cancellation
</button>
```

to:

```tsx
<button
  type="button"
  onClick={handleCancel}
  disabled={pending}
  className="border border-red-700 px-6 py-3 text-xs uppercase tracking-[0.2em] text-red-700 transition-colors hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
>
  {pending ? "Working…" : "Confirm cancellation"}
</button>
```

Add a `view === "cancelled"` branch, right before the final `return (`
that renders the main `<div className="space-y-10">`:

```tsx
  if (view === "cancelled" && cancelResult) {
    const refundLine =
      cancelResult.refundStatus === "refunded"
        ? `A full refund of ${formatCents(cancelResult.refundAmountCents)} is on its way.`
        : cancelResult.refundStatus === "partial_refund"
          ? `A partial refund of ${formatCents(cancelResult.refundAmountCents)} is on its way.`
          : cancelResult.refundStatus === "no_refund"
            ? "Per our cancellation policy, this booking wasn't eligible for a refund."
            : "We're processing your refund and will follow up shortly.";

    return (
      <div className="border border-accent/40 bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Cancelled
        </p>
        <h2 className="mt-2 font-serif text-2xl italic text-foreground">
          Your session has been cancelled.
        </h2>
        <p className="mt-4 text-sm text-muted">{refundLine}</p>
      </div>
    );
  }
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 4: Manual test — cancel through the UI**

1. Book and pay a deposit for a slot 8+ days out.
2. Load `http://localhost:3000/manage/<booking_token>` in a browser,
   click "Cancel", then "Confirm cancellation".
3. Expected: the page shows "Your session has been cancelled." with the
   full-refund message.
4. Confirm the slot is `open` in `/admin/availability` and the
   cancellation email arrived.
5. Clean up test data.

- [ ] **Step 5: Commit**

```bash
git add app/manage/\[token\]/ManageBooking.tsx
git commit -m "Wire the cancel button into the manage-booking UI"
```

---

## Task 13: Safety-net CLI for stuck pending holds

**Files:**
- Create: `scripts/bookings.mjs`
- Modify: `package.json` (add `bookings:sweep-pending` script)

**Interfaces:** none (operational tooling, no app code depends on it).

Webhooks (`checkout.session.expired`) are the primary way a held slot
gets released if a client abandons checkout. This is the safety net in
case a webhook delivery is ever missed — mirrors the existing
`scripts/gallery.mjs` pattern for one-off admin/ops tasks.

- [ ] **Step 1: Create `scripts/bookings.mjs`**

```js
// Safety net for booking_slots stuck in 'pending' past their hold
// window — normally released by the checkout.session.expired webhook
// (see lib/bookingWebhooks.ts), this covers the case where that webhook
// delivery was ever missed.
//
// Usage (via the npm script — already loads .env.local):
//   npm run bookings:sweep-pending

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Run via the npm script (bookings:sweep-pending), which loads .env.local automatically.`,
    );
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv("SUPABASE_URL").replace(/\/rest\/v1\/?$/, ""),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function sweepPending() {
  const { data, error } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      pending_expires_at: null,
    })
    .eq("status", "pending")
    .lt("pending_expires_at", new Date().toISOString())
    .select("id, session_type, start_time");

  if (error) {
    console.error("Failed to sweep pending slots:", error.message);
    process.exit(1);
  }

  if (!data.length) {
    console.log("No stuck pending slots found.");
    return;
  }

  for (const slot of data) {
    console.log(`Released ${slot.id} (${slot.session_type}, ${slot.start_time})`);
  }
  console.log(`Released ${data.length} slot(s).`);
}

const [, , command] = process.argv;

if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage:\n  npm run bookings:sweep-pending");
  process.exit(1);
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (alongside the existing
`gallery:*` entries):

```json
"bookings:sweep-pending": "node --env-file=.env.local scripts/bookings.mjs sweep-pending",
```

- [ ] **Step 3: Manual test**

1. Create a slot and hold it via `/api/book` (Task 6), but don't pay.
2. Manually backdate its `pending_expires_at` so the sweep finds it:
   ```bash
   cd /Users/zachjohnson/Projects/portfolio-site
   cat > scratch-backdate.mjs << 'EOF'
   import { createClient } from "@supabase/supabase-js";
   const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, "");
   const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
   const { error } = await supabase
     .from("booking_slots")
     .update({ pending_expires_at: new Date(Date.now() - 60000).toISOString() })
     .eq("id", "<slot-id>");
   console.log(error ?? "ok");
   EOF
   node --env-file=.env.local scratch-backdate.mjs
   rm scratch-backdate.mjs
   ```
3. Run: `npm run bookings:sweep-pending`
   Expected: prints `Released <slot-id> (...)` and `Released 1 slot(s).`
4. Confirm the slot is back to `open`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bookings.mjs package.json
git commit -m "Add bookings:sweep-pending CLI as a safety net for stuck holds"
```

---

## Task 14: Full regression pass, then ship

**Files:** none (verification only).

- [ ] **Step 1: Typecheck and lint the whole project**

Run: `npx tsc --noEmit && npx eslint app lib components`
Expected: no errors.

- [ ] **Step 2: Re-run the original booking-system regression checks**

Confirm nothing in this plan broke the existing flows verified in the
prior session: race-safety on `/api/book` (two concurrent holds on one
slot — same test as before, now expect one `200` with a `checkoutUrl`
and one `409`), admin cancel/delete on `/admin/availability`, and that
`/contact` + the footer still point at `/book`.

- [ ] **Step 3: Confirm all Stripe test-mode scenarios from Tasks 7, 10, 11 still pass**

Re-run, in order, against a clean set of test slots: deposit checkout
completes; checkout abandoned/expires; free reschedule; paid reschedule;
cancellation at all three refund tiers; forced refund failure. Clean up
test data after each.

- [ ] **Step 4: Add Stripe env vars to Vercel**

```bash
npx vercel env add STRIPE_SECRET_KEY production
npx vercel env add STRIPE_WEBHOOK_SECRET production
```

For `STRIPE_SECRET_KEY`, use the same test-mode key as `.env.local` for
now (switch to a live key later, once ready to accept real payments).
For `STRIPE_WEBHOOK_SECRET`, this needs a **production** webhook
endpoint, not the `stripe listen` one used for local dev:

1. In the Stripe Dashboard, go to Developers > Webhooks > Add endpoint.
2. Endpoint URL: `https://zkjfilms.com/api/webhooks/stripe`
3. Events to send: `checkout.session.completed`, `checkout.session.expired`.
4. Copy the resulting signing secret into the `vercel env add` prompt
   above.

- [ ] **Step 5: Push and deploy**

```bash
git push origin main
npx vercel ls
```

Poll (same pattern as prior deploys) until the new deployment shows
`Ready`, then verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zkjfilms.com/book
curl -s https://zkjfilms.com/ | grep -o 'href="/book"'
curl -s -o /dev/null -w "%{http_code}\n" https://zkjfilms.com/api/webhooks/stripe
```

Expected: `/book` returns `200`, the nav link is present, and the
webhook route responds (a `400` for a request with no valid Stripe
signature is correct and expected here — it confirms the route exists
and is verifying signatures rather than accepting anything).

- [ ] **Step 6: One real production test-mode booking**

With the production Stripe webhook endpoint now live, do one full
booking → deposit → confirmation email cycle against
`https://zkjfilms.com/book` using a Stripe test card, to confirm the
production webhook (not just the local `stripe listen` one) is wired
correctly. Clean up the resulting test data from production Supabase
afterward.
