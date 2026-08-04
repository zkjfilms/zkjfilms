-- Run this in Supabase's SQL editor (Project > SQL Editor > New query).
-- Only the service role key (server-side only, see lib/supabase.ts) can
-- read/write this table — RLS is enabled with no policies, so the anon
-- and authenticated roles get zero access by default.

create table if not exists galleries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  password_hash text not null,
  client_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  archived_at timestamptz
);

create index if not exists galleries_slug_idx on galleries (slug);

alter table galleries enable row level security;

-- Leads: one record per inquiry, moving through a single status pipeline
-- (new -> contacted -> booked -> completed, or lost at any point) rather
-- than separate leads/bookings tables. Created automatically from the
-- contact form (see app/api/contact/route.ts) or manually in
-- /admin/leads.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  session_type text not null,
  message text not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'booked', 'completed', 'lost')),
  source text not null default 'contact_form'
    check (source in ('contact_form', 'manual', 'booking')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_at_idx on leads (created_at desc);

alter table leads enable row level security;

-- Templates: one row per contract type, edited in /admin/templates.
-- Content uses {{token}} placeholders (client_name, client_email,
-- session_type, session_date, today) filled in at contract creation.
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  template_type text not null unique,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table templates enable row level security;

-- Contracts: a full snapshot of the filled-in template text at creation
-- time (contract_text), so later edits to the template never change an
-- already-created contract. signer_name is the typed name captured at
-- signing — added beyond the originally listed columns since nothing
-- else in this schema stores it, and item 5 requires capturing it.
-- appointment_id traces a contract back to its Acuity booking (see
-- app/api/webhooks/acuity/route.ts). The partial unique index makes
-- appointment_id -> contract idempotent (one contract per booking) while
-- still allowing unlimited manually-created contracts, which have no
-- appointment_id.
create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  template_type text not null,
  client_name text not null,
  client_email text not null,
  contract_text text not null,
  signed boolean not null default false,
  signed_at timestamptz,
  signer_name text,
  signer_ip text,
  appointment_id text,
  appointment_date timestamptz,
  email_sent boolean not null default false,
  email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists contracts_created_at_idx on contracts (created_at desc);
create index if not exists contracts_signed_idx on contracts (signed);
create unique index if not exists contracts_appointment_id_idx
  on contracts (appointment_id) where appointment_id is not null;

alter table contracts enable row level security;

-- Seed placeholder content — replace via /admin/templates before real use.
insert into templates (template_type, content)
values
  (
    'model_release',
    'MODEL RELEASE AGREEMENT

This Model Release Agreement ("Agreement") is entered into between {{client_name}} ("Model") and Zach K. Johnson ("Photographer") on {{today}}.

For good and valuable consideration, Model grants Photographer the irrevocable right to use, reproduce, and publish photographs taken during the {{session_type}} session on {{session_date}} for portfolio, marketing, and promotional purposes.

Model releases Photographer from any claims arising from the use of these images, provided such use does not portray Model in a defamatory or unlawful manner.

[PLACEHOLDER TEXT — replace with your actual model release language before use.]

By signing below, Model confirms they are 18 years of age or older (or have parental/guardian consent) and agree to the terms above.'
  ),
  (
    'booking_agreement',
    'PHOTOGRAPHY BOOKING AGREEMENT

This Booking Agreement ("Agreement") is entered into between {{client_name}} ("Client") and Zach K. Johnson ("Photographer") on {{today}}, for a {{session_type}} session scheduled on {{session_date}}.

Client agrees to the session terms, including scheduling, payment, and delivery timelines as discussed. A non-refundable deposit may be required to secure the booking date.

Photographer retains copyright to all images produced during the session. Client is granted a personal-use license unless otherwise agreed in writing.

[PLACEHOLDER TEXT — replace with your actual booking agreement language before use.]

By signing below, Client agrees to the terms outlined above.'
  )
on conflict (template_type) do nothing;

-- Native booking, replacing the Acuity embed on /contact. A slot's whole
-- lifecycle lives in one row: admin opens it (status 'open'), a client
-- claims it via /api/book (status -> 'booked', race-safe via an update
-- guarded by `where status = 'open'`), admin can cancel a booked slot to
-- reopen it (clearing client fields) rather than deleting the row.
-- Deliberately no recurring-availability engine for v1 — the admin opens
-- specific slots by hand, which fits the site's existing "every other
-- week" hours better than a rigid weekly-recurrence model would.
create table if not exists booking_slots (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  session_type text not null,
  status text not null default 'open' check (status in ('open', 'booked')),
  client_name text,
  client_email text,
  client_notes text,
  booked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists booking_slots_start_time_idx on booking_slots (start_time);
create index if not exists booking_slots_status_idx on booking_slots (status);

alter table booking_slots enable row level security;

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

-- Self-hosted availability & booking system (replaces booking_slots).
create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  price_cents integer not null default 0 check (price_cents >= 0),
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
  id boolean primary key default true check (id),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  connected boolean not null default false
);

create table scheduling_limits (
  id boolean primary key default true check (id),
  min_notice_hours integer not null default 24,
  max_advance_days integer not null default 365,
  cancel_reschedule_notice_hours integer not null default 24,
  daily_cap integer,
  start_time_interval_minutes integer not null default 30
);
insert into scheduling_limits (id) values (true);

-- Replaced wholesale on every cron poll, never incrementally updated.
create table google_busy_blocks_cache (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  synced_at timestamptz not null default now()
);
