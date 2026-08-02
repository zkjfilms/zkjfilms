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
