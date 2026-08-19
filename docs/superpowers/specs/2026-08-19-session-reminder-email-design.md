# Pre-Session Reminder Email — Design

**Goal:** Automatically email a client 2 days before their confirmed session with prep info (what to bring, what to expect), without the photographer having to remember to send anything manually. Boudoir sessions get genuinely different content from every other session type; everything else shares one template.

## Why this shape

The site already has an automated, admin-editable-template, cron-triggered email pattern in two places: `gallery_ready` (send-on-demand from an admin action) and the existing Google Calendar sync cron (send-on-schedule from GitHub Actions). This feature is the schedule-triggered shape, and it reuses more existing infrastructure than either of those did:

- **Token-fill:** `lib/contracts.ts` already exports `fillTemplate`/`TemplateValues` with exactly the tokens this needs (`client_name`, `session_type`, `session_date`) — no new token-fill function, unlike `gallery_ready`, which needed genuinely different tokens (password/PIN/URL).
- **Templates storage:** the existing generic `templates` table (`template_type` free text, edited via `/admin/templates`) — two new rows, no schema change to that table.
- **Cron mechanism:** the existing GitHub-Actions-hits-an-authenticated-`/api/cron/*`-route pattern (see `.github/workflows/sync-google-calendar.yml` / `app/api/cron/sync-google-calendar/route.ts`) — a new workflow + route in the same shape, at a coarser (hourly, not every-5-minutes) cadence since a 2-day lead time doesn't need minute-level precision.

What's actually new: a dedup column on `bookings`, a template-selection flag on `appointment_types`, and the batch-processing logic itself (loop over due bookings, isolate per-booking failures).

## Data model

Two additions, both nullable/defaulted so no backfill is needed:

```sql
alter table bookings add column if not exists reminder_sent_at timestamptz;
alter table appointment_types add column if not exists uses_boudoir_reminder boolean not null default false;
```

- `bookings.reminder_sent_at` — pure bookkeeping (drives the "already sent" dedup check and nothing else), same role as `galleries.credentials_sent_at`.
- `appointment_types.uses_boudoir_reminder` — an explicit admin-controlled flag (not a name match on "Boudoir"), surfaced as a new checkbox on the existing `/admin/appointment-types` form, right below the existing "Requires payment at booking" checkbox.

Two new `templates` rows, seeded with placeholder content the photographer customizes via `/admin/templates` (same pattern as `gallery_ready`'s seed):

```sql
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

## Trigger & idempotency

New route `GET /api/cron/send-session-reminders`, authenticated identically to the existing cron route (`Authorization: Bearer $CRON_SECRET`, 401 otherwise). New GitHub Actions workflow, `send-session-reminders.yml`, on an hourly schedule (`0 * * * *`) plus `workflow_dispatch` for manual runs — modeled directly on `sync-google-calendar.yml`.

The route delegates to a new `lib/sessionReminders.ts`, exporting `sendDueSessionReminders()` — keeping the route itself thin, same division as `sync-google-calendar`'s route delegating to `lib/googleCalendar.ts`'s `pullBusyBlocks()`.

Query for due bookings:

```sql
select ... from bookings
where status = 'confirmed'
  and reminder_sent_at is null
  and start_time > now()
  and start_time <= now() + interval '2 days'
```

This is a **threshold check, not a narrow window** — any run that happens to cross the 2-day-before mark catches the booking, so hourly granularity is safely sufficient (no risk of a booking falling between two runs and never getting caught). `reminder_sent_at is null` is the only dedup mechanism needed; it doubles as: canceled bookings are already excluded by `status = 'confirmed'`, and rescheduled bookings are handled for free. Confirmed directly against the `reschedule_booking` Postgres function (`supabase/schema.sql`): a reschedule sets the *old* row to `status = 'canceled'` and `insert`s a brand-new row with `status = 'confirmed'` hardcoded and no `reminder_sent_at` in its column list — so once the new `reminder_sent_at` column exists, that fresh row defaults to `null` automatically, regardless of whether the original booking had already been reminded.

## Sending

For each due booking:
1. Join to `appointment_types` for `name` (→ `session_type` token) and `uses_boudoir_reminder` (→ template selection).
2. Fetch the appropriate `templates` row (`session_reminder_boudoir` or `session_reminder`).
3. Fill it via the existing `fillTemplate` from `lib/contracts.ts`, with `sessionDate` formatted as a human-readable date **and time** (e.g. "Friday, March 6 at 2:00 PM") — `sessionDate` is just a string slot, nothing about the token name requires it to be date-only.
4. Send via a new `sendSessionReminderEmail` in `lib/email.ts`, following the exact shape of the existing `sendGalleryReadyEmail` (same `RESEND_API_KEY` check, try/catch, `{ ok: true } | { ok: false; error: string }` return, plain-text + `<pre>`-wrapped HTML body).
5. On send success, update that booking's `reminder_sent_at` — **send first, then log**, the reverse of the gallery-ready-email route's ordering, and deliberately so: `reminder_sent_at` is pure bookkeeping with no functional consequence (nothing depends on it being persisted the way a password hash does), so this follows `app/api/admin/contracts/[id]/send-email/route.ts`'s existing precedent instead. A failed bookkeeping write after a successful send is logged and non-fatal; the booking will just be picked up again next run (worst case, it might get a real duplicate email if the write failure repeats across runs, an acceptable and rare failure mode for a bookkeeping field, versus gallery-ready-email's fully different risk profile of a client possibly emailed a password that was never saved).
6. Each booking is processed independently inside a try/catch — one failure is logged and does not stop the rest of that run's batch. The route returns a summary (`{ sent: number, failed: number }`), same shape convention as other batch operations in this repo (e.g. `gallery:upload`'s "Uploaded N, skipped M" summary).

## Out of scope

- No admin UI to preview/force-send a reminder for a specific booking (unlike gallery-ready-email's manual "Notify client" panel) — this is fully automatic, matching how the Google Calendar sync cron has no manual trigger UI either.
- No per-client opt-out — every confirmed booking gets exactly one reminder; if this needs to change later, it's a small addition on top of the same `reminder_sent_at`/`status` gating.
- No SMS/text reminder — email only, matching every other client-facing notification this site sends today.
- No change to `scripts/scheduling.mjs`'s `sweep-pending` — that's a separate, already-existing pending-booking cleanup concern, unrelated to reminders for already-confirmed bookings.

## Testing

No automated test suite exists in this repo (confirmed pattern across every prior feature here). Verification is `tsc --noEmit`, `npm run build`, and a manual end-to-end run against a real test booking: create one with a `start_time` inside the 2-day window (via a direct Supabase update after using the normal booking flow, or by temporarily adjusting the query's interval during a local test), hit the cron route with the correct bearer token, confirm the email arrives with correctly-filled tokens, confirm `reminder_sent_at` is set, confirm a second run does not re-send, and confirm a boudoir-flagged appointment type's booking gets the boudoir template while every other type gets the generic one.
