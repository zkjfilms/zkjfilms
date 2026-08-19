# Same-Day SMS Reminder — Design

**Goal:** Cut no-shows with a same-day text reminder, layered on top of — not replacing — the existing 2-day-out email reminder. Email carries prep info clients read when they have time; SMS is the "you're on today" nudge that actually gets seen in the hour it matters.

## Why this shape

This is built as a fully parallel structure to the existing email reminder feature (`lib/sessionReminders.ts` / `app/api/cron/send-session-reminders` / `send-session-reminders.yml`), not a modification of it. New files throughout: `lib/sms.ts`, `lib/smsReminders.ts`, `app/api/cron/send-sms-reminders/route.ts`, `.github/workflows/send-sms-reminders.yml`. The email reminder is already shipped and reviewed (including a real timezone bug caught and fixed in its final review) — touching it to bolt on SMS would put working, verified code at risk for no reason. The two features share nothing except the pattern they're built in (cron → lib batch function → Resend/Twilio send → dedup column), the same way `gallery_ready` and the email reminder already share a pattern without sharing code.

**Provider:** Direct Twilio SDK integration, not a Vercel Marketplace-provisioned service — checked via `vercel integration discover --category messaging` and the only marketplace product is Resend (email, already in use). This actually matches how Resend itself is wired into this codebase already: a plain SDK + `RESEND_API_KEY` env var, not a marketplace-installed integration. Twilio needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` env vars — the account and phone number are an external signup step for the project owner, the same way Resend/Supabase/Stripe were already configured before any of this session's work began.

## Data model

Two additions to `bookings`, both nullable/defaulted so no backfill is needed:

```sql
alter table bookings add column if not exists sms_consent boolean not null default false;
alter table bookings add column if not exists sms_reminder_sent_at timestamptz;
```

- `sms_consent` — set only when the client explicitly checks the new consent checkbox at booking time (see below). Independent of whether `client_phone` is present — `client_phone` is already a required field on every booking (confirmed in `app/api/bookings/route.ts`'s existing validation), but having a phone number does not imply consent to receive automated texts. No consent, no SMS, full stop — even if a booking gets updated later, there's no path in this design that ever sends SMS to a booking with `sms_consent = false`.
- `sms_reminder_sent_at` — dedup bookkeeping, same role and same send-then-log ordering as the email reminder's `reminder_sent_at` (pure bookkeeping, no functional consequence if the write itself fails after a successful send).

## Booking form: consent checkbox

`app/book/BookingForm.tsx` gets one new field, `smsConsent: boolean`, defaulted to `false` (unchecked — opt-in, not opt-out), added as a checkbox directly below the existing required Phone field:

> ☐ Text me a reminder the day of my session

`app/api/bookings/route.ts`'s payload parsing accepts `smsConsent: boolean` (defaulting to `false` if omitted/malformed, never erroring the whole booking over it — this field is never load-bearing for whether a booking succeeds) and passes it through to the `bookings` insert as `sms_consent`.

## Trigger logic — timezone handled at the query level, not in JS

"Morning of, fixed local time" means comparing the session's *calendar date* in `America/Chicago` against today's date in that same zone, and checking whether it's currently past a fixed local clock time (8:00 AM). Given the email reminder's final review caught a real bug from hand-rolling timezone logic in JavaScript, this does the date/time comparison directly in Postgres via `AT TIME ZONE`, which has correct, DST-aware conversion built in — no manual offset math anywhere in this feature:

```sql
select ... from bookings
where status = 'confirmed'
  and sms_consent = true
  and sms_reminder_sent_at is null
  and (start_time at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date
  and (now() at time zone 'America/Chicago')::time >= time '08:00'
```

Like the email reminder's 2-day threshold, this is a **threshold within the day, not a narrow window** — any hourly run after 8:00 AM local on the session's actual day catches it, so a cron delay, a missed run, or even several hours of GitHub Actions downtime doesn't cause a booking to silently go unreminded; the next run after 8:00 AM still catches it as long as it's still the same calendar day. `sms_reminder_sent_at is null` is the only dedup mechanism, applied at query time (not as an after-the-fetch application-level filter), same reasoning the email reminder's final review specifically verified as race-safe.

Same hourly GitHub Actions cadence as the email reminder (`0 * * * *` plus `workflow_dispatch`), same `concurrency` guard to prevent overlapping runs from double-texting a client.

## Sending

For each due booking: format the session time via `toLocaleString` with `timeZone: BUSINESS_TIME_ZONE` (imported from `lib/scheduling.ts` — the exact fix applied to the email reminder's own formatter, applied here from the start rather than as a follow-up fix), build a short message, and send via a new `sendSessionReminderSMS` in `lib/sms.ts`:

```ts
export async function sendSessionReminderSMS(params: {
  clientPhone: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }>
```

Same `{ ok: true } | { ok: false; error: string }` return convention as every `send*` function in `lib/email.ts`, same "check required env vars, try/catch around the provider call, never throw" shape — just backed by the Twilio SDK's `client.messages.create({ body, from, to })` instead of Resend.

**Message content is hardcoded, not admin-editable via the `templates` table** — the one deliberate departure from this codebase's usual "everything is an editable template" pattern (contracts, `gallery_ready`, the email reminder). SMS has a hard per-segment length limit (~160 characters for plain GSM-7 text); free-form admin editing risks silently doubling message cost (crossing into a second segment) or looking broken on some carriers. A short, fixed message is more predictable and safer for a channel with real per-message cost:

```
Hi {client_name}, reminder: your session today is at {time} at {studio_address}. — Zach K. Johnson
```

`{studio_address}` uses the street address only (`BUSINESS.address.streetAddress` from `lib/seo.ts`, e.g. "2101 W Broadway Ave, Suite 208") rather than the full city/state/zip, to keep the message tight — the client already knows what city they're in.

On send success, `sms_reminder_sent_at` is set **after** the send, not before (same reasoning as the email reminder: pure bookkeeping, no security-sensitive artifact to protect, so send-then-log). Each booking processed in its own try/catch, one failure doesn't abort the batch.

## Compliance

Twilio handles STOP/START/HELP keyword opt-out automatically at the carrier/platform level for standard number types — no inbound webhook or reply-parsing code needed anywhere in this feature (confirmed as part of scoping this as one-way-only). What this design is still responsible for: genuine opt-in consent captured at the point of collection (the booking form checkbox, unchecked by default), which is what `sms_consent` exists to gate on.

## Out of scope

- **No two-way SMS.** No inbound webhook, no reply parsing, no "reply C to confirm" flow — a one-way notification is the entire scope. A confirm/cancel-by-reply system would be a separate, meaningfully larger project layered on top of this one, not a part of it.
- **No admin-editable SMS template.** Hardcoded content, per the length-safety reasoning above. If this needs to change later, it's a code change, not an `/admin/templates` edit.
- **No change to the existing email reminder feature.** `lib/sessionReminders.ts`, its route, and its workflow are untouched by this plan.
- **No SMS for the 2-day-out prep-info reminder.** That stays email-only, as originally designed — this feature only adds the same-day no-show-prevention touchpoint.
- **No retroactive consent collection for existing bookings.** `sms_consent` defaults to `false`; only bookings made through the booking form after this ships can opt in. No backfill, no re-contacting past clients to ask.

## Testing

No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run build`, and a manual end-to-end run against a real test booking with `sms_consent = true` and a real phone number, hitting the cron route directly with the correct bearer token — same pattern as the email reminder's Task 5. Given the query's timezone-sensitivity is the one thing worth extra scrutiny here (per the lesson from the email reminder's final review), the implementation plan should include an explicit check that a booking scheduled for *today* only becomes due once the current business-local time is actually past 8:00 AM (not before), verified by checking the query's behavior at a time before 8:00 AM local and again after, rather than assuming the SQL is correct because it looks right.
