// lib/supabaseBrowser.ts
// Anon key, browser-only. This client is used exclusively for Realtime
// channel subscriptions — it is never used to query a table directly,
// and the anon key has no table grants, so it couldn't even if asked to.
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let warnedMissingConfig = false;

// Returns null (rather than throwing) when the browser-facing Supabase env
// vars aren't configured, so callers can degrade to a no-op — the same
// "disconnected is a no-op, never an error" invariant this codebase
// already applies to Google Calendar (Tasks 16-19). Realtime sync is a
// live-UX enhancement, not load-bearing for booking correctness (every
// mutation path re-fetches on its own), so its absence must never break
// page rendering.
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!warnedMissingConfig) {
      console.warn(
        "Realtime sync disabled: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY not set.",
      );
      warnedMissingConfig = true;
    }
    return null;
  }
  client = createClient(url, anonKey);
  return client;
}

export function subscribeToSchedulingChannel(
  onMessage: (event: "availability_changed" | "booking_changed", payload: { date: string }) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return () => {};
  }
  const channel = supabase
    .channel("scheduling")
    .on("broadcast", { event: "availability_changed" }, ({ payload }) =>
      onMessage("availability_changed", payload as { date: string }),
    )
    .on("broadcast", { event: "booking_changed" }, ({ payload }) =>
      onMessage("booking_changed", payload as { date: string }),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
