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
    check (source in ('contact_form', 'manual')),
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
