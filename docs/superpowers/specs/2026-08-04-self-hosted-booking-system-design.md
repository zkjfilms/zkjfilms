# Self-Hosted Availability & Booking System

## Background

The site currently has a native booking system (`/book`, `/admin/availability`,
`/manage/[token]`) built on a single `booking_slots` table: an admin
pre-creates discrete open time slots, a client claims one and pays a Stripe
deposit, and the same client link supports reschedule (free at 72h+ notice,
$50 fee under that) and cancellation (tiered refund by notice).

This replaces that system entirely with a recurring-availability model closer
to Acuity Scheduling (the tool this site's booking flow originally
replaced) — admin sets weekly hours once, with per-date overrides and
ad-hoc blocked time, rather than hand-creating every open slot. It adds
two-way Google Calendar sync and real-time push updates between the admin
and client views. The reference UI throughout this spec is the admin's own
live Acuity account (`secure.acuityscheduling.com/admin/calendars` and
`/admin/appointment-types`), viewed directly during design.

## Goals

- Admin sets recurring weekly hours once ("I have regular hours every
  week"), with per-date overrides (custom hours or fully closed) and
  separately-tracked ad-hoc blocked time (lunch, vacation) that doesn't
  require touching the day's hours.
- Appointment types (name, duration, buffers, price, active/inactive) are
  managed independently of availability — a flat list, no grouping (may be
  added later; not needed now).
- Client picks a type, then a date (closed/fully-booked dates visibly
  disabled), then an open time slot computed from hours minus existing
  bookings minus buffers minus blocked time minus Google Calendar busy
  blocks.
- Every appointment type can require full payment via Stripe Checkout at
  booking time (not a deposit — the full price). Types that don't require
  payment confirm immediately.
- Admin changes (hours, overrides, blocks) push to any open client booking
  page without a refresh. A client's booking instantly removes that slot
  from every other client currently viewing the page.
- The admin's personal Google Calendar is two-way synced: busy blocks on
  the calendar remove client-visible slots, and new bookings push events
  onto the calendar immediately.
- A client can cancel or reschedule via a link in their confirmation email,
  gated by an admin-configured notice window — full refund within the
  window, blocked past it (client must contact the admin directly).
- No two confirmed-or-pending bookings can ever overlap, enforced at the
  database level, not just application logic — this is what makes the
  "two people book the same slot at once" race safe.
- Zero ongoing subscription cost: stays on the Supabase Postgres project
  and Vercel deployment this site already runs on, no new paid service.

## Non-goals

- No appointment-type groups (different types having different
  availability windows) — flat list of types sharing one calendar. Easy to
  add later without a breaking schema change if it turns out to be needed.
- No tiered refund percentages — cancellation/reschedule is a simple
  notice-window cutoff (full refund inside the window, blocked outside
  it), not the previous system's 100%/50%/0% tiers.
- No per-slot capacity beyond 1 (Acuity's "Appointments Per Time Slot"
  field exists because it supports group classes and multiple staff; this
  is a solo photographer, so a slot is either open or taken).
- No Google Calendar push-webhook — polling every 5 minutes via Vercel Cron
  instead. (See "Google Calendar integration" for the tradeoff.)
- No recurring/repeating blocked-time entries — each block is a single
  date + time range. Acuity has a "Repeat" option on its block-off-time
  panel; skipping it keeps `blocked_times` simple or a one-block-per-date
  row. Can add later.
- No SMS, no third-party CAPTCHA — honeypot field + IP throttling only.
- Deleting the old system (`booking_slots` table, `/book`,
  `/admin/availability`, `/manage/[token]`, the old Stripe deposit/reschedule
  fee logic) happens once the new system is live and verified — see
  "Rollout," not part of the new system's own build.

## Architecture

- **Database**: the existing Supabase Postgres project, not SQLite —
  Supabase's free tier is already $0 and already configured (domain, env
  vars, deploy pipeline); SQLite would force an always-on host this site
  doesn't otherwise need.
- **Data access**: `@supabase-js`, matching every other table in this
  codebase (`lib/supabase.ts`'s `getSupabaseClient()`), not Prisma — avoids
  a second migration/ORM system alongside the existing raw-SQL-in-
  `supabase/schema.sql` convention.
- **Real-time sync**: Supabase Realtime (Postgres change subscriptions on
  `bookings`, `availability_overrides`, `blocked_times`), not a custom
  Socket.io/SSE layer — already available on the project for free, and
  avoids the "separate serverless function instances don't share memory"
  broadcast problem a hand-rolled WebSocket layer would hit on Vercel.
- **Hosting**: unchanged — Vercel, same as today.
- **Email**: Resend, same as today — not Nodemailer/Gmail SMTP. Keeps one
  email path in the codebase instead of two, and Resend's deliverability
  setup (SPF/DKIM already configured for this domain) is a known quantity.
- **Payments**: Stripe Checkout, same integration this site already has
  (`lib/stripe.ts`), extended to support full-price charges per appointment
  type instead of only deposits.
- **Google Calendar**: `googleapis` npm package, OAuth2, single admin user.

## Data model

```sql
create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 0,
  price_cents integer not null default 0,
  requires_payment boolean not null default false,
  color text not null default '#6b7280',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time)
);

create table availability_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  start_time time,
  end_time time,
  is_closed boolean not null default false,
  check (is_closed or (start_time is not null and end_time is not null and end_time > start_time))
);

create table blocked_times (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  reason text
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  appointment_type_id uuid not null references appointment_types(id),
  client_name text not null,
  client_email text not null,
  client_phone text,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  time_range tstzrange generated always as
    (tstzrange(start_time, end_time, '[)')) stored,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'canceled')),
  notes text,
  booking_token uuid not null default gen_random_uuid(),
  payment_intent_id text,
  amount_paid_cents integer,
  google_event_id text,
  pending_expires_at timestamptz,
  created_at timestamptz not null default now(),
  exclude using gist (time_range with &&)
    where (status in ('pending', 'confirmed'))
);

create index bookings_booking_token_idx on bookings (booking_token);
create index bookings_start_time_idx on bookings (start_time);

create table google_calendar_sync (
  id boolean primary key default true check (id),  -- single row
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  connected boolean not null default false
);

create table scheduling_limits (
  id boolean primary key default true check (id),  -- single row
  min_notice_hours integer not null default 24,
  max_advance_days integer not null default 365,
  cancel_reschedule_notice_hours integer not null default 24,
  daily_cap integer,  -- null = no cap
  start_time_interval_minutes integer not null default 30
);

-- Replaced wholesale on every cron poll (delete + reinsert), not
-- incrementally updated — the cron job's output is always "here is
-- everything currently busy," so a full replace can't leave a stale row
-- behind from an event that was since deleted on the calendar.
create table google_busy_blocks_cache (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  synced_at timestamptz not null default now()
);
```

- **`bookings.time_range` + the exclusion constraint** is what makes
  double-booking structurally impossible, not just unlikely: two `pending`-
  or-`confirmed` rows can never have overlapping `time_range`s, enforced by
  Postgres itself under concurrent transactions. This is what the client
  booking submission relies on for "double-check the slot is still free in
  a single transaction" — the insert itself either succeeds or fails with
  an exclusion violation, no separate check-then-act race window.
- Buffers (`buffer_before_minutes` / `buffer_after_minutes`) are **not**
  part of that constraint — they're a slot-computation-time concern (they
  affect which candidate start times get *offered* to a client), not a
  hard invariant. Two back-to-back bookings with zero gap are structurally
  legal; the buffer just stops the *client* from being offered that
  zero-gap slot in the first place.
- `bookings.status = 'pending'` is the same "hold before payment confirms"
  pattern as today's system, adapted to a table where rows aren't
  pre-created: the pending insert *is* the atomic claim, and the exclusion
  constraint is what makes it race-safe against a second concurrent
  request for the same time. `pending_expires_at` (30 minutes) plus a
  sweep job (mirroring today's `bookings:sweep-pending` CLI) cleans up
  abandoned checkouts, same as today.
- `booking_token` moves with the client across a reschedule (a reschedule
  cancels the old row and inserts a new one) — same rationale as today's
  system: `id` belongs to whichever row currently represents the
  appointment, the token is the stable client-facing identity.
- `scheduling_limits` and `google_calendar_sync` are both intentionally
  single-row tables (`id boolean primary key default true check (id)` is a
  standard Postgres idiom for "exactly one row, enforced by the primary
  key").

## Slot computation algorithm

Given a date `D` and appointment type `T`:

1. **Resolve the day's working window.** If an `availability_overrides` row
   exists for `D`: use it (empty/no slots if `is_closed`). Otherwise, use
   the `availability_rules` row for `D`'s day-of-week. If neither exists,
   the day is closed.
2. **Generate candidate start times** within that window at
   `scheduling_limits.start_time_interval_minutes` steps, where
   `start + T.duration_minutes <= window_end`.
3. **Exclude candidates that violate buffers.** For each candidate, compute
   its occupied span as `[start - T.buffer_before, start + T.duration +
   T.buffer_after)`. Drop any candidate whose occupied span overlaps an
   existing `confirmed` (and, during that booking's own pending-checkout
   window, `pending`) booking's *own* occupied span (using that other
   booking's appointment type's buffers).
4. **Exclude candidates overlapping `blocked_times`** for `D`.
5. **Exclude candidates overlapping Google Calendar busy blocks** for `D`,
   read from the `google_busy_blocks_cache` table (see "Google Calendar
   integration") — the cron poll's most recent result, not the live
   calendar, so this can lag the calendar by up to the poll interval.
6. **Apply guardrails**: drop candidates starting before `now +
   min_notice_hours`, after `now + max_advance_days`, or — if
   `daily_cap` is set — drop the entire day once `D` already has that many
   `confirmed` bookings.
7. Remaining candidates are the open slots returned to the client.

The admin's monthly override calendar (see below) uses steps 1 and 4 only
(resolved hours + blocked-time count for the day-cell summary), not the
full slot computation.

## Admin flows

Reference: `secure.acuityscheduling.com/admin/calendars` and
`/admin/appointment-types` (the admin's own live Acuity account).

**Calendar overview** (`/admin/availability`, replacing today's page):
a "Block Off Time" button opens a panel with start/end time, date, and a
notes field, writing a `blocked_times` row. A weekly strip below shows each
day's resolved hours (closed or `10:00am–5:00pm`), with an "Edit
Availability/Limits" button.

**Availability editor**, two tabs:

- *Set Hours of Availability*: "I have regular hours every week" checkbox
  revealing day-by-day start/end inputs (→ `availability_rules`). Below
  that, a monthly calendar where each day cell shows its resolved hours
  (override if one exists, else the template) and a blocked-time count
  linking to a day view. Clicking a day cell opens the override editor for
  that date (custom hours, or "mark closed" → `availability_overrides`).
- *Scheduling Limits*: `min_notice_hours`, `max_advance_days`,
  `cancel_reschedule_notice_hours`, `daily_cap`,
  `start_time_interval_minutes` — one row in `scheduling_limits`, editable
  here. Seed defaults match the admin's current live Acuity settings: 24h
  min notice, 365 days max advance, 24h cancel/reschedule notice, no daily
  cap, 30-minute start-time intervals.

**Appointment types** (`/admin/appointment-types`): flat list, color
swatch, name/duration/price shown inline, Edit/Duplicate, drag-to-reorder
(`sort_order`). "New Type" opens a form: name, duration, buffer before/
after, price, "requires payment" toggle, color, active/inactive.

**Day view**: bookings, blocked times, and open slots for one date, side
by side.

**Google Calendar connection**: a "Connect Google Calendar" button on the
admin settings area, running the OAuth2 flow once and storing tokens in
`google_calendar_sync`.

## Client flow

Same shape as today's `/book`: pick an appointment type → calendar with
only dates that have at least one open slot selectable (closed/fully-
booked dates visibly disabled) → pick a time slot from the computed list →
booking form (name, email, phone optional, notes, honeypot field) →
if `requires_payment`, Stripe Checkout for the full `price_cents`; if not,
confirm immediately → confirmation page + email with the cancel/reschedule
link.

**Timezone**: slot times are computed and stored in `America/Chicago`. The
client view detects the browser's local timezone and converts displayed
times, showing both zones side by side when they differ from Central.

## Real-time sync

Supabase Realtime subscriptions, client-side, on:

- `bookings` — a new `confirmed` or `pending` row (or the exclusion
  constraint rejecting one) means the client booking page removes that
  slot from its displayed list instantly, without a refresh; the admin day
  view updates live too.
- `availability_overrides` / `blocked_times` — an admin edit updates any
  open client booking page's available dates/slots immediately.

## Google Calendar integration

OAuth2, single user (the admin). A Vercel Cron job runs every 5 minutes,
pulls busy blocks from the connected calendar via the Calendar API's
`freebusy` query, and **replaces the entire contents** of
`google_busy_blocks_cache` (delete all rows, insert the fresh result) in
one transaction — never an incremental update, so a calendar event the
admin deleted between polls can't leave a stale row behind. Slot
computation (step 5 above) reads this cache table, not `blocked_times` —
keeping "admin manually blocked this" and "Google Calendar says this is
busy" as two distinct, separately-sourced concerns even though they have
the same effect on availability.

On every new `confirmed` booking, immediately create a Calendar event
(client name + notes in the description) via a direct API call — not
waiting for the next poll cycle. On cancellation, delete that event using
the stored `google_event_id`.

**Push webhooks vs polling**: Google's push-notification mechanism would
give near-instant updates instead of up-to-5-minutes lag, and this site
does have a public HTTPS endpoint to receive it. But it needs webhook
signature validation and channels that expire every 30 days and must be
renewed — real ongoing maintenance for a personal calendar where a few
minutes of lag on picking up a manually-added busy block is a non-issue.
Polling is the simpler, lower-maintenance choice here.

## Cancellation & reschedule flow

`/manage/[booking_token]`, same URL pattern as today.

1. If `now` is within `cancel_reschedule_notice_hours` of the booking's
   `start_time`: **allowed**. Reschedule cancels the current row and
   inserts a new one for the chosen slot **in a single database
   transaction** — if the new slot's insert fails (exclusion violation
   because someone else just took it), the whole transaction rolls back
   and the client keeps their original booking rather than losing it with
   nothing to replace it. Cancellation sets `status = 'canceled'`, deletes
   the Google Calendar event, and — if `requires_payment` was true —
   issues a full Stripe refund against `payment_intent_id`.
2. If outside the notice window: self-service is **blocked**. The page
   shows the admin's contact info instead of reschedule/cancel controls.

## Environment variables

Add to `.env.example` / `.env.local` / Vercel (alongside the existing
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`ADMIN_PASSWORD`):

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `CRON_SECRET` — verifies Vercel Cron's request to the polling endpoint

## Validation & spam protection

- Server-side: valid email format, no past-dated bookings, appointment
  type is `active`, and the slot is re-validated against the current
  computed availability (not just trusted from the client) at submit time
  — the exclusion constraint is the final backstop, this is the friendly
  pre-check.
- Honeypot field on the booking form (hidden input real clients never
  fill; a submission with it populated is silently dropped).
- IP-based throttling on the booking endpoint (a simple in-memory or
  Postgres-backed request-count window — no third-party service).

## Rollout

Same process as today's Stripe work: an isolated git worktree, full build
and test there without touching the live site — the current
`booking_slots`-based system keeps running in production throughout
development. Once the new system is verified end-to-end in production
(including a real Google Calendar OAuth connection and a real Stripe
Checkout payment), a single coordinated cutover: swap `/book`,
`/admin/availability`, `/manage/[token]` over to the new implementation,
drop the old `booking_slots` table and its associated routes/scripts.

## Testing plan

- Slot computation: unit tests covering recurring rules, overrides
  (including `is_closed`), blocked-time exclusion, buffer exclusion,
  Google Calendar busy-block exclusion, and each guardrail.
- Concurrency: two simultaneous booking attempts for the same slot — one
  succeeds, one gets a friendly "no longer available" response, verified
  against the actual exclusion constraint (not mocked).
- Real-time: a live browser test with two tabs — admin edits availability
  in one, confirm the client tab updates without a refresh; book in the
  client tab, confirm the admin tab updates live.
- Google Calendar: OAuth connect flow, a manually-added calendar event
  removing a slot after the next poll, a new booking appearing on the
  calendar immediately.
- Payment: full Stripe Checkout flow for a `requires_payment` type in test
  mode, then one live-mode verification (mirroring how the deposit system
  was verified) before cutover.
- Cancellation/reschedule: within-window (allowed, refund issued,
  Calendar event removed) and outside-window (blocked, contact-info shown)
  for both cancel and reschedule.
