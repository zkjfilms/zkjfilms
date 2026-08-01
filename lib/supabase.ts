// Server-side Supabase client for the client gallery feature. Uses the
// service role key, which bypasses Row Level Security entirely — this
// must only ever be imported from server code (API routes), never from
// a "use client" component, and SUPABASE_SERVICE_ROLE_KEY must never be
// prefixed with NEXT_PUBLIC_.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

// Accepts either the project base URL or the REST endpoint
// (https://<ref>.supabase.co/rest/v1/) — supabase-js wants the base URL
// and appends /rest/v1 itself.
function toProjectUrl(rawUrl: string): string {
  return rawUrl.replace(/\/rest\/v1\/?$/, "");
}

export function getSupabaseClient(): SupabaseClient {
  return createClient(
    toProjectUrl(requireEnv("SUPABASE_URL")),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
      },
    },
  );
}
