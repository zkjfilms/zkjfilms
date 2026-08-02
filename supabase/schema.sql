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
