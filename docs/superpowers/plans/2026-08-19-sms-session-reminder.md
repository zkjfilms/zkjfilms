# Same-Day SMS Session Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text clients a same-day reminder to cut no-shows, fully independent of the existing 2-day-out email reminder, gated on explicit opt-in consent captured at booking time.

**Architecture:** A parallel structure to the existing email reminder feature — new `lib/sms.ts` (Twilio SDK), new `lib/smsReminders.ts` (batch query/send/dedup logic, using Postgres's `AT TIME ZONE` for correct business-local date/time comparison rather than hand-rolled JS timezone math), a new authenticated cron route, and a new hourly GitHub Actions workflow. Nothing in the existing email reminder feature is touched.

**Tech Stack:** Next.js API routes, Supabase (schema + queries), Twilio (new dependency), GitHub Actions.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-19-sms-session-reminder-design.md`.
- No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run build`, and manual end-to-end runs against real test data — same pattern as every prior plan here.
- Schema changes must be applied manually by the project owner via Supabase's SQL Editor (no direct Postgres connection is available). Do not attempt to run migrations yourself via any CLI or script.
- `sms_consent` gates every send — there is no code path anywhere in this feature that sends an SMS to a booking with `sms_consent = false`, regardless of whether `client_phone` is present.
- The trigger query's date/time comparison must be done via Postgres `AT TIME ZONE`, not JavaScript `Date` math — this is a deliberate response to a real timezone bug caught in the (separate, already-shipped) email reminder feature's final review. Do not "simplify" this into JS-side comparison.
- SMS content is a hardcoded string, not routed through the admin-editable `templates` table — deliberate, given SMS's hard per-segment length limit. Do not add a template-table lookup for this.
- No two-way SMS anywhere in this plan — no inbound webhook, no reply parsing. One-way sends only.
- `git checkout -- AGENTS.md` after any `npm run dev`/`npm run build` if it gets regenerated — discard before staging/committing.
- **Requires real Twilio credentials** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) in `.env.local` before Task 5's live end-to-end test can run. If these aren't present when Task 5 needs them, stop and report NEEDS_CONTEXT rather than guessing or fabricating values.

---

## Task 1: Schema migration

**Files:**
- Modify: `supabase/schema.sql` (append migration)

**Interfaces:**
- Produces: `bookings.sms_consent` (boolean, default false), `bookings.sms_reminder_sent_at` (nullable timestamptz) — consumed by Tasks 2, 4, and 5.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor (Project → SQL Editor → New query) against the live database:

```sql
alter table bookings add column if not exists sms_consent boolean not null default false;
alter table bookings add column if not exists sms_reminder_sent_at timestamptz;
```

Then append the exact same statements (with the comment below) to the end of `supabase/schema.sql`, after the file's current final block (the `session_reminder_boudoir` template insert), so the file stays the source of truth for a fresh provision:

```sql

-- Same-day SMS no-show-prevention reminder, independent of the 2-day
-- email reminder above. sms_consent is a genuine opt-in captured on the
-- booking form (unchecked by default) — having client_phone on file
-- never implies consent to receive automated texts on its own.
-- sms_reminder_sent_at is the dedup mechanism, same role as
-- reminder_sent_at above (set after a successful send, not before —
-- pure bookkeeping, no functional consequence if the write itself ever
-- failed).
alter table bookings add column if not exists sms_consent boolean not null default false;
alter table bookings add column if not exists sms_reminder_sent_at timestamptz;
```

Do not attempt to run this migration yourself — there is no direct Postgres connection available. If Step 2 below fails with a missing-column error, the migration hasn't been applied yet — stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Verify the migration**

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const b = await supabase.from('bookings').select('sms_consent, sms_reminder_sent_at').limit(1);
  console.log(JSON.stringify({ columnsOk: !b.error, error: b.error }, null, 2));
});
"
```

Expected: `columnsOk: true`, `error: null`.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add sms_consent and sms_reminder_sent_at columns"
```

---

## Task 2: Booking form SMS consent checkbox

**Files:**
- Modify: `app/book/BookingForm.tsx`
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- Produces: `POST /api/bookings` accepts an optional `smsConsent: boolean` in its payload, stored as `bookings.sms_consent` — consumed by Task 4's `lib/smsReminders.ts` query (which only selects bookings where this is `true`).

- [ ] **Step 1: Add the checkbox to `BookingForm.tsx`**

Read the current file first. It has a `form` state object (currently `{ clientName, clientEmail, clientPhone, notes, discountCode, honeypot }`), a `handleSubmit` that spreads `...form` directly into the POST body (so adding a new key to `form` state is automatically included with no other changes needed), and a required Phone field.

1. Add `smsConsent: false` to the initial `useState` object:

```ts
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    smsConsent: false,
    notes: "",
    discountCode: "",
    honeypot: "",
  });
```

2. Add a new checkbox directly after the existing Phone field's closing `</div>`, before the Notes field:

```tsx
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="smsConsent"
          checked={form.smsConsent}
          onChange={(e) => setForm((p) => ({ ...p, smsConsent: e.target.checked }))}
          className="h-4 w-4 border-border accent-accent"
        />
        <label htmlFor="smsConsent" className="text-sm text-foreground">
          Text me a reminder the day of my session
        </label>
      </div>
```

Note this checkbox uses `checked`/`e.target.checked`, not `value`/`e.target.value` like every other field in this form — booleans, not strings.

- [ ] **Step 2: Accept the field in `POST /api/bookings`**

In `app/api/bookings/route.ts`, the current `Payload` type and `parsePayload` function need a new `smsConsent: boolean` field. This field is never load-bearing for whether a booking succeeds — if it's missing or malformed, default to `false` rather than rejecting the whole booking (unlike every other field in this validator, which returns `null` — i.e., rejects — on a bad value).

Update `Payload`:

```ts
type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  smsConsent: boolean;
  notes: string;
  honeypot: string;
  turnstileToken: string;
  discountCode: string;
};
```

Update `parsePayload`'s return statement only (no new entries in the validation `if` block — this field is intentionally never validated/rejected, only defaulted):

```ts
  return {
    appointmentTypeId: b.appointmentTypeId,
    date: b.date,
    startTime: b.startTime,
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    clientPhone: b.clientPhone.trim(),
    smsConsent: b.smsConsent === true,
    notes: b.notes.trim(),
    honeypot: b.honeypot,
    turnstileToken: b.turnstileToken === undefined ? "" : (b.turnstileToken as string),
    discountCode: typeof b.discountCode === "string" ? b.discountCode.trim().toUpperCase() : "",
  };
```

(`b.smsConsent === true` — not `Boolean(b.smsConsent)` — so only a literal `true` counts; any other value, including truthy strings/numbers, defaults to `false` rather than being coerced.)

Then find the `.insert({...})` call that creates the booking (currently includes `client_phone: payload.clientPhone || null,`) and add one line directly after it:

```ts
      sms_consent: payload.smsConsent,
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual verification**

Start the dev server, go through the `/book` flow for any appointment type that doesn't require payment (so the booking completes without needing a real Stripe checkout — check `/admin/appointment-types` for one, or use one that does require payment and stop short of actually paying if that's simpler, whichever completes fastest). Submit once WITH the new checkbox checked, and once WITHOUT (two separate bookings). After each, query the resulting booking directly:

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabase.from('bookings').select('client_name, sms_consent').order('created_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 2));
});
"
```

Expected: the checked-checkbox booking has `sms_consent: true`, the unchecked one has `sms_consent: false`. Delete both test bookings afterward:

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.from('bookings').delete().in('client_name', ['<name you used for test 1>', '<name you used for test 2>']);
  console.log(JSON.stringify({ error }, null, 2));
});
"
```

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/book/BookingForm.tsx app/api/bookings/route.ts
git commit -m "Add SMS consent checkbox to the booking form"
```

---

## Task 3: `lib/sms.ts` — Twilio send function

**Files:**
- Create: `lib/sms.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Produces: `sendSessionReminderSMS(params: { clientPhone: string; bodyText: string }): Promise<{ ok: true } | { ok: false; error: string }>`, consumed by Task 4's `lib/smsReminders.ts`.

- [ ] **Step 1: Install the Twilio SDK**

```bash
npm install twilio
```

- [ ] **Step 2: Create the file**

```ts
import twilio from "twilio";

// Sent by the send-sms-reminders cron
// (app/api/cron/send-sms-reminders/route.ts) the morning of a confirmed
// booking, for clients who explicitly opted in (bookings.sms_consent).
// Same { ok, error } convention as every send* function in lib/email.ts —
// check required config, try/catch around the provider call, never throw.
export async function sendSessionReminderSMS(params: {
  clientPhone: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, error: "Twilio is not configured (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER)." };
  }

  const client = twilio(accountSid, authToken);

  try {
    await client.messages.create({
      body: params.bodyText,
      from: fromNumber,
      to: params.clientPhone,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/sms.ts
git commit -m "Add sendSessionReminderSMS via Twilio"
```

---

## Task 4: `lib/smsReminders.ts` — batch send logic

**Files:**
- Create: `lib/smsReminders.ts`

**Interfaces:**
- Consumes: `sendSessionReminderSMS` from `lib/sms.ts` (Task 3), `getSupabaseClient` from `lib/supabase.ts` (existing), `BUSINESS_TIME_ZONE`/`businessDayUtcBounds`/`utcIsoToBusinessDate` from `lib/scheduling.ts` (existing — `businessDayUtcBounds(date: string): { startUtc: string; endUtc: string }` already exists specifically for "bound a business-local calendar day as UTC instants for filtering a timestamptz column," and `utcIsoToBusinessDate(utcIso: string): string` converts a UTC instant to its business-local `"YYYY-MM-DD"` date — both are pre-existing, already used elsewhere in this codebase for exactly this class of problem, not new for this task), `BUSINESS` from `lib/seo.ts` (existing, for the studio street address).
- Produces: `sendDueSmsReminders(): Promise<{ sent: number; failed: number }>`, consumed by Task 5's cron route.

This task has no standalone runtime test — same reasoning as the email reminder feature's equivalent task: the `@/` import alias only resolves inside Next.js's build/dev process, not a bare `node -e` script, and Task 5's route is the real integration point this gets exercised through. This task's gate is `tsc --noEmit` plus a careful read of the code against this brief's Interfaces block — do not attempt to hack together a standalone test harness.

- [ ] **Step 1: Create the file**

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { sendSessionReminderSMS } from "@/lib/sms";
import { BUSINESS_TIME_ZONE, businessDayUtcBounds, utcIsoToBusinessDate } from "@/lib/scheduling";
import { BUSINESS } from "@/lib/seo";

type DueBooking = {
  id: string;
  client_name: string;
  client_phone: string;
  start_time: string;
};

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// Called by the send-sms-reminders cron
// (app/api/cron/send-sms-reminders/route.ts) — see that route for auth.
// "Morning of, fixed local time" is done with businessDayUtcBounds /
// utcIsoToBusinessDate (lib/scheduling.ts), not hand-rolled JS date
// math — the (separate) email reminder feature's final review caught a
// real bug from formatting a booking time without an explicit
// timeZone, so this feature reuses the existing, already-correct
// business-local-day-boundary helpers rather than reinventing that
// conversion. Like the email reminder's 2-day threshold, the local-hour
// check below is a threshold WITHIN the day (>= 8am local), not a
// narrow window — any hourly run after 8am local on the session's
// actual business-local calendar day still catches it, so a missed or
// delayed cron run catches up correctly later the same day.
// sms_reminder_sent_at is the only dedup mechanism, applied at query
// time. sms_consent = true is required — no code path here ever sends
// to a booking that didn't explicitly opt in.
export async function sendDueSmsReminders(): Promise<{ sent: number; failed: number }> {
  const nowLocalHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", hour12: false }).format(new Date()),
  );
  if (nowLocalHour < 8) {
    return { sent: 0, failed: 0 };
  }

  const todayBusinessDate = utcIsoToBusinessDate(new Date().toISOString());
  const { startUtc, endUtc } = businessDayUtcBounds(todayBusinessDate);

  const supabase = getSupabaseClient();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, client_name, client_phone, start_time")
    .eq("status", "confirmed")
    .eq("sms_consent", true)
    .is("sms_reminder_sent_at", null)
    .gte("start_time", startUtc)
    .lt("start_time", endUtc);

  if (error) {
    console.error("Failed to query due SMS reminders:", error);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const booking of (bookings ?? []) as DueBooking[]) {
    try {
      const bodyText = `Hi ${booking.client_name}, reminder: your session today is at ${formatSessionTime(booking.start_time)} at ${BUSINESS.address.streetAddress}. — Zach K. Johnson`;

      const result = await sendSessionReminderSMS({
        clientPhone: booking.client_phone,
        bodyText,
      });

      if (!result.ok) {
        console.error(`Failed to send SMS reminder for booking ${booking.id}:`, result.error);
        failed += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({ sms_reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);

      if (updateError) {
        console.error(`Sent SMS but failed to mark booking ${booking.id} as reminded:`, updateError);
      }

      sent += 1;
    } catch (err) {
      console.error(`Unexpected error processing booking ${booking.id}:`, err);
      failed += 1;
    }
  }

  return { sent, failed };
}
```

Note the local-hour check runs before the query, not after — if it's not yet 8am business-local, there's no need to query at all. `businessDayUtcBounds`/`utcIsoToBusinessDate` are both already documented in `lib/scheduling.ts` as the required pattern for filtering a `timestamptz` column by "this business-local calendar day" — do not substitute `${date}T00:00:00Z`/`${date}T23:59:59Z` string literals, which that file's own comment explicitly warns produces the wrong window whenever the business timezone isn't UTC.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/smsReminders.ts
git commit -m "Add sendDueSmsReminders batch send logic"
```

---

## Task 5: Cron route and GitHub Actions workflow

**Files:**
- Create: `app/api/cron/send-sms-reminders/route.ts`
- Create: `.github/workflows/send-sms-reminders.yml`

**Interfaces:**
- Consumes: `sendDueSmsReminders` from `lib/smsReminders.ts` (Task 4).
- No new interfaces produced — this is the plan's final consumer.

**This task requires real Twilio credentials** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) in `.env.local` to run its live verification. If they're not present, stop and report NEEDS_CONTEXT rather than fabricating values or skipping verification.

- [ ] **Step 1: Create the route**

```ts
import { sendDueSmsReminders } from "@/lib/smsReminders";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  try {
    const result = await sendDueSmsReminders();
    return Response.json(result);
  } catch (err) {
    console.error("SMS reminder cron failed:", err);
    return Response.json({ error: "Failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the GitHub Actions workflow**

```yaml
name: Send SMS Reminders

# Same authenticated-endpoint pattern as sync-google-calendar.yml and
# send-session-reminders.yml. Hourly is enough for a "morning of, past
# 8am local" threshold check (see lib/smsReminders.ts) — any run after
# 8am business-local on the session's day catches it.
on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch: {}

concurrency:
  group: send-sms-reminders
  cancel-in-progress: false

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Call SMS reminder endpoint
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          if ! status=$(curl -s -o /tmp/response.txt -w "%{http_code}" \
            -H "Authorization: Bearer $CRON_SECRET" \
            https://zkjfilms.com/api/cron/send-sms-reminders); then
            echo "curl failed to reach the endpoint (network/DNS/TLS error)."
            exit 1
          fi
          echo "HTTP status: $status"
          if [ "$status" -ge 400 ]; then
            echo "SMS reminder endpoint returned an error status:"
            cat /tmp/response.txt
            exit 1
          fi
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Create a test fixture booking scheduled for later today, with SMS consent**

There's no CLI command for creating a booking directly. Insert one against the live database with `start_time` later today (business-local) and `sms_consent: true`, using a real phone number you can check for the actual text:

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: type } = await supabase.from('appointment_types').select('id, name').eq('active', true).limit(1).maybeSingle();
  const start = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const { data, error } = await supabase.from('bookings').insert({
    appointment_type_id: type.id,
    client_name: 'SMS Reminder Test Client',
    client_email: 'you+sms-reminder-test@example.com',
    client_phone: '<a real phone number you can check, e.g. +15551234567>',
    sms_consent: true,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'confirmed',
  }).select('id').single();
  console.log(JSON.stringify({ bookingId: data?.id, error }, null, 2));
});
"
```

If the current business-local time is before 8am, either wait until after 8am to run the verification below, or (for testing purposes only) temporarily lower the `nowLocalHour < 8` threshold in `lib/smsReminders.ts` to something already past, run the test, then revert that temporary change before committing — do not ship a lowered threshold.

- [ ] **Step 5: Manual end-to-end verification**

Start the dev server (`npm run dev`, likely in the background). Send the cron request using the real `CRON_SECRET` value from `.env.local`:

```bash
curl -s -X GET http://localhost:3000/api/cron/send-sms-reminders \
  -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" | python3 -m json.tool
```

Expected: `{"sent": 1, "failed": 0}` (or more, if other real due-and-consented bookings exist). Confirm the text message actually arrived at the phone number you used, with a correctly-formatted local time (compare against the booking's actual `start_time`, converted to `America/Chicago`) and the correct studio street address. Query the test booking afterward and confirm `sms_reminder_sent_at` is set. Re-run the same curl command — expect `{"sent": 0, "failed": 0}`, proving dedup works end-to-end.

Confirm the 401 path: retry without the `Authorization` header — expect `401`.

Stop the dev server. Delete the test booking:

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.from('bookings').delete().eq('client_name', 'SMS Reminder Test Client');
  console.log(JSON.stringify({ error }, null, 2));
});
"
```

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/send-sms-reminders/route.ts .github/workflows/send-sms-reminders.yml
git commit -m "Add send-sms-reminders cron route and hourly GitHub Actions workflow"
```

Note for whoever merges this to `main`: this workflow only starts running once merged to the default branch, and needs `CRON_SECRET` (already configured — shared with the other two cron workflows) plus `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` set as real environment variables in the Vercel production environment (not just `.env.local`) before it can actually send anything in production.
