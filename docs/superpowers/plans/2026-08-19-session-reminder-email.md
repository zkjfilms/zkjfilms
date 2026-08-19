# Pre-Session Reminder Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically email a client 2 days before their confirmed session with prep info, with genuinely different content for boudoir sessions, entirely on autopilot via a scheduled cron job.

**Architecture:** Two new columns (`bookings.reminder_sent_at` for dedup, `appointment_types.uses_boudoir_reminder` for template selection), two new admin-editable `templates` rows, and a batch-processing lib function (`lib/sessionReminders.ts`) invoked by a thin authenticated cron route on an hourly GitHub Actions schedule — the same shape as the existing Google Calendar sync cron. Reuses the existing `fillTemplate` token-fill function from `lib/contracts.ts` rather than building a new one.

**Tech Stack:** Next.js API routes, Supabase (schema + queries), Resend (existing `lib/email.ts`), GitHub Actions.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-19-session-reminder-email-design.md`.
- No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run build`, and manual end-to-end runs against real test data — same pattern as every prior plan here.
- Schema changes must be applied manually by the project owner via Supabase's SQL Editor (no direct Postgres connection is available, only the REST-based service-role key, which can't run DDL). Do not attempt to run migrations yourself via any CLI or script. If a verification step fails because a column/row doesn't exist yet, stop and report NEEDS_CONTEXT.
- The reminder query is a **threshold check** (`start_time <= now() + interval '2 days'`), not a narrow time window — do not "optimize" this into an exact-window check, it would reintroduce the exact bug the threshold design avoids (a booking silently never getting reminded because it fell between two cron runs).
- `reminder_sent_at` is written **after** a successful send, not before — the reverse of `galleries.credentials_sent_at`'s ordering in the gallery-ready-email feature. This is deliberate (see the spec's "Sending" section for the reasoning); do not "fix" it to match that other feature.
- `uses_boudoir_reminder` is an explicit admin-set boolean column — never derive template selection from matching on the appointment type's `name` string.
- `git checkout -- AGENTS.md` after any `npm run dev`/`npm run build` if it gets regenerated (a known Next.js tooling side-effect unrelated to this work) — discard before staging/committing.

---

## Task 1: Schema migration

**Files:**
- Modify: `supabase/schema.sql` (append migration)

**Interfaces:**
- Produces: `bookings.reminder_sent_at` (nullable timestamptz), `appointment_types.uses_boudoir_reminder` (boolean, default false), and two seeded `templates` rows (`session_reminder`, `session_reminder_boudoir`) — consumed by Tasks 2 and 4.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor (Project → SQL Editor → New query) against the live database:

```sql
alter table bookings add column if not exists reminder_sent_at timestamptz;
alter table appointment_types add column if not exists uses_boudoir_reminder boolean not null default false;

insert into templates (template_type, content) values (
  'session_reminder',
  'Hi {{client_name}},

Just a reminder that your {{session_type}} session is coming up on {{session_date}}!

A few things to keep in mind:
- Arrive a few minutes early so we can start on time.
- Wear something you feel comfortable and confident in.
- If anything comes up and you need to reschedule, just reply to this email.

Looking forward to it,
Zach K. Johnson'
) on conflict (template_type) do nothing;

insert into templates (template_type, content) values (
  'session_reminder_boudoir',
  'Hi {{client_name}},

Just a reminder that your {{session_type}} session is coming up on {{session_date}}!

A few things to keep in mind:
- The studio is a private, judgment-free space — it''s just us.
- Bring a couple of outfit options if you''re unsure what you want to shoot in.
- If you''re planning hair, nails, or waxing, most people prefer to have that done a day or two ahead rather than the same day.
- If anything comes up and you need to reschedule, just reply to this email.

Looking forward to it,
Zach K. Johnson'
) on conflict (template_type) do nothing;
```

Then append the exact same statements (with the comments below) to the end of `supabase/schema.sql`, after the file's current final block (the `gallery_ready` template insert), so the file stays the source of truth for a fresh provision:

```sql

-- Pre-session reminder emails, sent 2 days before a confirmed booking's
-- start_time by the send-session-reminders cron (see
-- app/api/cron/send-session-reminders/route.ts). reminder_sent_at is the
-- only dedup mechanism — set after a successful send, not before, since
-- unlike gallery credentials this is pure bookkeeping with no
-- functional consequence if the write itself ever failed.
alter table bookings add column if not exists reminder_sent_at timestamptz;

-- Explicit admin-set flag (checkbox in /admin/appointment-types), not a
-- name match on "Boudoir" — so renaming an appointment type later can't
-- silently change which reminder template it gets.
alter table appointment_types add column if not exists uses_boudoir_reminder boolean not null default false;

-- Seed placeholder content — replace via /admin/templates before real use.
insert into templates (template_type, content) values (
  'session_reminder',
  'Hi {{client_name}},

Just a reminder that your {{session_type}} session is coming up on {{session_date}}!

A few things to keep in mind:
- Arrive a few minutes early so we can start on time.
- Wear something you feel comfortable and confident in.
- If anything comes up and you need to reschedule, just reply to this email.

Looking forward to it,
Zach K. Johnson'
) on conflict (template_type) do nothing;

insert into templates (template_type, content) values (
  'session_reminder_boudoir',
  'Hi {{client_name}},

Just a reminder that your {{session_type}} session is coming up on {{session_date}}!

A few things to keep in mind:
- The studio is a private, judgment-free space — it''s just us.
- Bring a couple of outfit options if you''re unsure what you want to shoot in.
- If you''re planning hair, nails, or waxing, most people prefer to have that done a day or two ahead rather than the same day.
- If anything comes up and you need to reschedule, just reply to this email.

Looking forward to it,
Zach K. Johnson'
) on conflict (template_type) do nothing;
```

Do not attempt to run this migration yourself — there is no direct Postgres connection available. If Step 2 below fails with a missing-column or missing-row error, the migration hasn't been applied yet — stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Verify the migration**

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const b = await supabase.from('bookings').select('reminder_sent_at').limit(1);
  const a = await supabase.from('appointment_types').select('uses_boudoir_reminder').limit(1);
  const t1 = await supabase.from('templates').select('template_type').eq('template_type', 'session_reminder').maybeSingle();
  const t2 = await supabase.from('templates').select('template_type').eq('template_type', 'session_reminder_boudoir').maybeSingle();
  console.log(JSON.stringify({
    bookingsColumnOk: !b.error, bookingsError: b.error,
    appointmentTypesColumnOk: !a.error, appointmentTypesError: a.error,
    sessionReminderTemplate: t1.data, sessionReminderBoudoirTemplate: t2.data,
  }, null, 2));
});
"
```

Expected: `bookingsColumnOk: true`, `bookingsError: null`, `appointmentTypesColumnOk: true`, `appointmentTypesError: null`, both template rows non-null.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add reminder_sent_at, uses_boudoir_reminder, and session reminder templates"
```

---

## Task 2: Boudoir-reminder flag on appointment types

**Files:**
- Modify: `app/admin/appointment-types/AppointmentTypeList.tsx`
- Modify: `app/admin/appointment-types/AppointmentTypeForm.tsx`
- Modify: `app/api/admin/appointment-types/route.ts`
- Modify: `app/api/admin/appointment-types/[id]/route.ts`

**Interfaces:**
- Produces: `AppointmentType.uses_boudoir_reminder: boolean` (in `AppointmentTypeList.tsx`), settable via the admin form and both API routes — consumed by Task 4's `lib/sessionReminders.ts`.

- [ ] **Step 1: Add the field to the `AppointmentType` type**

In `app/admin/appointment-types/AppointmentTypeList.tsx`, find the existing `AppointmentType` type:

```ts
export type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  color: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};
```

Add the new field, keeping every other field exactly as-is:

```ts
export type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  uses_boudoir_reminder: boolean;
  color: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};
```

- [ ] **Step 2: Add the checkbox to `AppointmentTypeForm.tsx`**

Read the current file first — it has a `toFormState` function, a `handleChange` handler already wired for checkboxes (see `requiresPayment`'s handling via `type === "checkbox" ? checked : value`), a submit `body` object, and an existing "Requires payment at booking" checkbox in the JSX. Make three changes:

1. In `toFormState`, add `usesBoudoirReminder` alongside `requiresPayment` in both branches:

```ts
function toFormState(appointmentType: AppointmentType | null) {
  if (!appointmentType) {
    return {
      name: "",
      durationMinutes: "30",
      bufferBeforeMinutes: "0",
      bufferAfterMinutes: "0",
      priceDollars: "",
      requiresPayment: false,
      usesBoudoirReminder: false,
      color: DEFAULT_COLOR,
    };
  }
  return {
    name: appointmentType.name,
    durationMinutes: String(appointmentType.duration_minutes),
    bufferBeforeMinutes: String(appointmentType.buffer_before_minutes),
    bufferAfterMinutes: String(appointmentType.buffer_after_minutes),
    priceDollars: (appointmentType.price_cents / 100).toString(),
    requiresPayment: appointmentType.requires_payment,
    usesBoudoirReminder: appointmentType.uses_boudoir_reminder,
    color: appointmentType.color,
  };
}
```

2. In `handleSubmit`, add `usesBoudoirReminder` to the `body` object sent to the API:

```ts
    const body = {
      name: form.name.trim(),
      durationMinutes,
      bufferBeforeMinutes,
      bufferAfterMinutes,
      priceCents,
      requiresPayment: form.requiresPayment,
      usesBoudoirReminder: form.usesBoudoirReminder,
      color: form.color,
    };
```

3. In the JSX, add a second checkbox directly after the existing "Requires payment at booking" one:

```tsx
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="requiresPayment"
          checked={form.requiresPayment}
          onChange={handleChange}
          className="h-4 w-4 border-border accent-accent"
        />
        Requires payment at booking
      </label>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="usesBoudoirReminder"
          checked={form.usesBoudoirReminder}
          onChange={handleChange}
          className="h-4 w-4 border-border accent-accent"
        />
        Use boudoir-specific pre-session reminder email
      </label>
```

- [ ] **Step 3: Accept the field in `POST /api/admin/appointment-types`**

In `app/api/admin/appointment-types/route.ts`, the current `CreatePayload` type, `parseCreatePayload`, and the insert call all need the new field. Update `CreatePayload`:

```ts
type CreatePayload = {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  usesBoudoirReminder: boolean;
  color: string;
};
```

Update `parseCreatePayload`'s validation and return:

```ts
function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.name !== "string" ||
    !b.name.trim() ||
    typeof b.durationMinutes !== "number" ||
    b.durationMinutes <= 0 ||
    typeof b.bufferBeforeMinutes !== "number" ||
    b.bufferBeforeMinutes < 0 ||
    typeof b.bufferAfterMinutes !== "number" ||
    b.bufferAfterMinutes < 0 ||
    typeof b.priceCents !== "number" ||
    b.priceCents < 0 ||
    typeof b.requiresPayment !== "boolean" ||
    typeof b.usesBoudoirReminder !== "boolean" ||
    typeof b.color !== "string"
  ) {
    return null;
  }
  return {
    name: b.name.trim(),
    durationMinutes: b.durationMinutes,
    bufferBeforeMinutes: b.bufferBeforeMinutes,
    bufferAfterMinutes: b.bufferAfterMinutes,
    priceCents: b.priceCents,
    requiresPayment: b.requiresPayment,
    usesBoudoirReminder: b.usesBoudoirReminder,
    color: b.color,
  };
}
```

Update the `.insert({...})` call in `POST` to include `uses_boudoir_reminder: payload.usesBoudoirReminder,` alongside the existing `requires_payment: payload.requiresPayment,` line.

- [ ] **Step 4: Accept the field in `PATCH /api/admin/appointment-types/[id]`**

In `app/api/admin/appointment-types/[id]/route.ts`, update `UpdatePayload`:

```ts
type UpdatePayload = Partial<{
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  usesBoudoirReminder: boolean;
  color: string;
  active: boolean;
  sortOrder: number;
}>;
```

Add one line to the `update` object construction, alongside the existing `requiresPayment` line:

```ts
  if (body.usesBoudoirReminder !== undefined) update.uses_boudoir_reminder = body.usesBoudoirReminder;
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Manual verification**

Start the dev server, log into `/admin`, go to `/admin/appointment-types`. Create a new appointment type (or edit an existing one, e.g. "Boudoir" if one exists) and check the new "Use boudoir-specific pre-session reminder email" checkbox, save. Reload the page and re-open that type for editing — confirm the checkbox is still checked (proves the round-trip through the API and database works). Uncheck it, save, reload, confirm it's unchecked. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/admin/appointment-types/AppointmentTypeList.tsx app/admin/appointment-types/AppointmentTypeForm.tsx app/api/admin/appointment-types/route.ts app/api/admin/appointment-types/\[id\]/route.ts
git commit -m "Add uses_boudoir_reminder flag to appointment types"
```

---

## Task 3: `sendSessionReminderEmail` in `lib/email.ts`

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Produces: `sendSessionReminderEmail(params: { clientEmail: string; sessionType: string; bodyText: string }): Promise<{ ok: true } | { ok: false; error: string }>`, consumed by Task 4's `lib/sessionReminders.ts`.

- [ ] **Step 1: Append the new function**

`lib/email.ts` currently ends with `sendGalleryReadyEmail`'s closing brace. Append this new function after it, at the end of the file:

```ts

// Sent by the send-session-reminders cron
// (app/api/cron/send-session-reminders/route.ts) 2 days before a
// confirmed booking. Same shape as sendGalleryReadyEmail: the caller
// fills the template before calling this, plain-text body rendered into
// a <pre> block rather than a richer HTML layout, since this template
// is short and the admin edits it as plain text in /admin/templates.
export async function sendSessionReminderEmail(params: {
  clientEmail: string;
  sessionType: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: `Your ${params.sessionType} session is coming up`,
      text: params.bodyText,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(params.bodyText)}</pre>`,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (`Resend`, `FROM_ADDRESS`, and `escapeHtml` are all already imported/defined earlier in this file.)

- [ ] **Step 3: Commit**

```bash
git add lib/email.ts
git commit -m "Add sendSessionReminderEmail"
```

---

## Task 4: `lib/sessionReminders.ts` — batch send logic

**Files:**
- Create: `lib/sessionReminders.ts`

**Interfaces:**
- Consumes: `fillTemplate`/`TemplateValues` from `lib/contracts.ts` (existing), `sendSessionReminderEmail` from `lib/email.ts` (Task 3), `getSupabaseClient` from `lib/supabase.ts` (existing).
- Produces: `sendDueSessionReminders(): Promise<{ sent: number; failed: number }>`, consumed by Task 5's cron route.

- [ ] **Step 1: Create the file**

```ts
import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendSessionReminderEmail } from "@/lib/email";

type DueBooking = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  appointment_types: { name: string; uses_boudoir_reminder: boolean } | null;
};

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Called by the send-session-reminders cron
// (app/api/cron/send-session-reminders/route.ts) — see that route for
// auth. Threshold query, not a narrow window: any run that crosses the
// 2-day-before mark catches a booking, so hourly cron granularity is
// safely sufficient and a booking can never fall between two runs
// unreminded. reminder_sent_at is the only dedup mechanism; canceled
// bookings are excluded by status = 'confirmed', and rescheduled
// bookings are handled for free because reschedule_booking (see
// supabase/schema.sql) cancels the old row and inserts a brand-new one
// with reminder_sent_at unset.
export async function sendDueSessionReminders(): Promise<{ sent: number; failed: number }> {
  const supabase = getSupabaseClient();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, client_name, client_email, start_time, appointment_types(name, uses_boudoir_reminder)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("start_time", new Date().toISOString())
    .lte("start_time", new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error("Failed to query due session reminders:", error);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const booking of (bookings ?? []) as DueBooking[]) {
    try {
      const sessionType = booking.appointment_types?.name ?? "photography";
      const templateType = booking.appointment_types?.uses_boudoir_reminder
        ? "session_reminder_boudoir"
        : "session_reminder";

      const { data: template, error: templateError } = await supabase
        .from("templates")
        .select("content")
        .eq("template_type", templateType)
        .maybeSingle();

      if (templateError || !template) {
        console.error(`Failed to load ${templateType} template:`, templateError);
        failed += 1;
        continue;
      }

      const bodyText = fillTemplate(template.content, {
        clientName: booking.client_name,
        clientEmail: booking.client_email,
        sessionType,
        sessionDate: formatSessionDate(booking.start_time),
      });

      const result = await sendSessionReminderEmail({
        clientEmail: booking.client_email,
        sessionType,
        bodyText,
      });

      if (!result.ok) {
        console.error(`Failed to send session reminder for booking ${booking.id}:`, result.error);
        failed += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", booking.id);

      if (updateError) {
        // Send already succeeded — this is pure bookkeeping. Log and
        // move on rather than treating the whole booking as failed.
        console.error(`Sent reminder but failed to mark booking ${booking.id} as reminded:`, updateError);
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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

This function has no standalone runtime test in this task — the `@/` import alias only resolves inside Next.js's own build/dev process, not a bare `node -e`, so exercising it directly here would mean either bypassing the path alias awkwardly or duplicating Task 5's route as a throwaway harness. Task 5 wires this function into a real route and is where the actual runtime/end-to-end verification happens (test booking creation, template selection, token-fill correctness, dedup, cleanup — all in one place, against the one real integration point). This task's gate is `tsc --noEmit` plus a careful read of the code above against the Interfaces block.

- [ ] **Step 3: Commit**

```bash
git add lib/sessionReminders.ts
git commit -m "Add sendDueSessionReminders batch send logic"
```

---

## Task 5: Cron route and GitHub Actions workflow

**Files:**
- Create: `app/api/cron/send-session-reminders/route.ts`
- Create: `.github/workflows/send-session-reminders.yml`

**Interfaces:**
- Consumes: `sendDueSessionReminders` from `lib/sessionReminders.ts` (Task 4).
- No new interfaces produced — this is the plan's final consumer.

- [ ] **Step 1: Create the route**

```ts
import { sendDueSessionReminders } from "@/lib/sessionReminders";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  try {
    const result = await sendDueSessionReminders();
    return Response.json(result);
  } catch (err) {
    console.error("Session reminder cron failed:", err);
    return Response.json({ error: "Failed." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the GitHub Actions workflow**

```yaml
name: Send Session Reminders

# Same authenticated-endpoint pattern as sync-google-calendar.yml, at a
# much coarser cadence: the reminder query is a 2-day threshold check
# (see lib/sessionReminders.ts), so hourly is far more than enough to
# never miss a booking crossing that mark, unlike the calendar sync's
# every-5-minutes need for near-real-time availability.
on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch: {}

jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - name: Call reminder endpoint
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          if ! status=$(curl -s -o /tmp/response.txt -w "%{http_code}" \
            -H "Authorization: Bearer $CRON_SECRET" \
            https://zkjfilms.com/api/cron/send-session-reminders); then
            echo "curl failed to reach the endpoint (network/DNS/TLS error)."
            exit 1
          fi
          echo "HTTP status: $status"
          cat /tmp/response.txt
          if [ "$status" -ge 400 ]; then
            echo "Reminder endpoint returned an error status."
            exit 1
          fi
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Create two test fixture bookings**

There's no CLI command for creating a booking directly (bookings are normally created through the `/book` flow, which involves live availability/payment). Insert two directly against the live database instead — one against a non-boudoir appointment type, one against a boudoir-flagged one (`uses_boudoir_reminder = true`), so this run proves template selection actually branches correctly. If no boudoir-flagged appointment type exists yet, create one first via `/admin/appointment-types` (Task 2's checkbox) or temporarily flip an existing type's flag.

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: types } = await supabase.from('appointment_types').select('id, name, uses_boudoir_reminder').eq('active', true);
  const nonBoudoir = types.find((t) => !t.uses_boudoir_reminder);
  const boudoir = types.find((t) => t.uses_boudoir_reminder);
  if (!nonBoudoir || !boudoir) { console.error('Need at least one active appointment type with uses_boudoir_reminder=false and one with =true.'); process.exit(1); }
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day out — inside the 2-day window
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const rows = [
    { appointment_type_id: nonBoudoir.id, client_name: 'Reminder Test Client Generic', client_email: 'you+reminder-test-generic@example.com', start_time: start.toISOString(), end_time: end.toISOString(), status: 'confirmed' },
    { appointment_type_id: boudoir.id, client_name: 'Reminder Test Client Boudoir', client_email: 'you+reminder-test-boudoir@example.com', start_time: start.toISOString(), end_time: end.toISOString(), status: 'confirmed' },
  ];
  const { data, error } = await supabase.from('bookings').insert(rows).select('id, client_name');
  console.log(JSON.stringify({ inserted: data, error }, null, 2));
});
"
```

Use real inboxes you control instead of the `you+...@example.com` addresses if you want to see the actual email content — this repo's Resend setup sends real email, there's no sandbox mode.

- [ ] **Step 5: Manual end-to-end verification**

Start the dev server (`npm run dev`, likely in the background). Send the cron request using the real `CRON_SECRET` value from `.env.local`:

```bash
curl -s -X GET http://localhost:3000/api/cron/send-session-reminders \
  -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" | python3 -m json.tool
```

Expected: `{"sent": 2, "failed": 0}` (or more, if other real due bookings exist — that's fine, just confirm at least both test bookings' reminders went out). Confirm both emails arrived (if you used real inboxes) with `{{client_name}}`, `{{session_type}}`, and `{{session_date}}` all correctly filled — and confirm the generic-type booking's email matches the `session_reminder` template's content while the boudoir-type booking's email matches `session_reminder_boudoir`'s (proves template selection genuinely branches on the flag, not just on some other field). Query both bookings afterward and confirm `reminder_sent_at` is now set on each. Re-run the same curl command — expect `{"sent": 0, "failed": 0}` this time, proving dedup works end-to-end through the full route.

Confirm the 401 path: retry the same curl without the `Authorization` header (or with a wrong value) — expect `401`.

Stop the dev server. Delete both test bookings:

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.from('bookings').delete().in('client_name', ['Reminder Test Client Generic', 'Reminder Test Client Boudoir']);
  console.log(JSON.stringify({ error }, null, 2));
});
"
```

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/send-session-reminders/route.ts .github/workflows/send-session-reminders.yml
git commit -m "Add send-session-reminders cron route and hourly GitHub Actions workflow"
```

Note for whoever merges this to `main`: GitHub Actions workflow files only start running once they exist on the repository's default branch, and the `CRON_SECRET` repository secret must already be configured (it already is, since `sync-google-calendar.yml` depends on the same secret) — no additional setup needed beyond the merge itself.
