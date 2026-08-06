// lib/realtimeBroadcast.ts
// Uses Supabase Realtime's REST broadcast endpoint rather than opening a
// websocket and calling .subscribe() first — a serverless function's
// lifetime is too short to reliably keep a socket open long enough for
// a normal channel.send() to flush. REST broadcast is a single HTTP
// call, fire-and-forget, and is Supabase's documented approach for
// broadcasting from server-side/edge code.

const CHANNEL = "scheduling";

async function broadcast(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const projectUrl = url.replace(/\/rest\/v1\/?$/, "");
  try {
    await fetch(`${projectUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: CHANNEL, event, payload }] }),
    });
  } catch (err) {
    // Never let a broadcast failure break the mutation that triggered
    // it — worst case, a client's view is stale until its next natural
    // refetch (e.g. changing dates).
    console.error(`Realtime broadcast (${event}) failed:`, err);
  }
}

export function broadcastAvailabilityChange(payload: { date: string }): Promise<void> {
  return broadcast("availability_changed", payload);
}

export function broadcastBookingChange(payload: { date: string }): Promise<void> {
  return broadcast("booking_changed", payload);
}
