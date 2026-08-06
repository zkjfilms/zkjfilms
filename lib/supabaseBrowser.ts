// lib/supabaseBrowser.ts
// Anon key, browser-only. This client is used exclusively for Realtime
// channel subscriptions — it is never used to query a table directly,
// and the anon key has no table grants, so it couldn't even if asked to.
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}

export function subscribeToSchedulingChannel(
  onMessage: (event: "availability_changed" | "booking_changed", payload: { date: string }) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
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
