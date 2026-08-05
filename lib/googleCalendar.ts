import { google } from "googleapis";
import { getSupabaseClient } from "@/lib/supabase";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function getGoogleAuthUrl(state: string): string {
  const client = getGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on a re-connect
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeAndStoreTokens(code: string): Promise<void> {
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("google_calendar_sync")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      connected: true,
    })
    .eq("id", true);
  if (error) throw error;
}

// Returns an authenticated client, refreshing the access token first if
// it's expired — googleapis' OAuth2 client does this automatically once
// given both tokens, but only if we hand it the stored refresh_token.
export async function getAuthenticatedGoogleClient() {
  const supabase = getSupabaseClient();
  const { data: sync } = await supabase.from("google_calendar_sync").select("*").single();
  if (!sync?.connected || !sync.refresh_token) return null;

  const client = getGoogleOAuthClient();
  client.setCredentials({
    access_token: sync.access_token ?? undefined,
    refresh_token: sync.refresh_token,
    expiry_date: sync.token_expires_at ? new Date(sync.token_expires_at).getTime() : undefined,
  });

  client.on("tokens", async (tokens) => {
    // googleapis fires this when it silently refreshes an expired access
    // token — persist the new one so we're not re-refreshing every call.
    if (tokens.access_token) {
      await supabase
        .from("google_calendar_sync")
        .update({
          access_token: tokens.access_token,
          token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        })
        .eq("id", true);
    }
  });

  return client;
}

type BookingForCalendar = {
  client_name: string;
  notes: string | null;
  start_time: string;
  end_time: string;
  appointment_types: { name: string } | { name: string }[] | null;
};

function typeNameFor(booking: BookingForCalendar): string {
  const rel = booking.appointment_types;
  if (!rel) return "Appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "Appointment") : rel.name;
}

export async function pushBookingToGoogleCalendar(booking: BookingForCalendar): Promise<string | null> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return null; // not connected — not an error, just nothing to do

  const calendar = google.calendar({ version: "v3", auth: client });
  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `${typeNameFor(booking)} — ${booking.client_name}`,
      description: booking.notes ?? undefined,
      start: { dateTime: booking.start_time },
      end: { dateTime: booking.end_time },
    },
  });
  return response.data.id ?? null;
}

export async function deleteGoogleCalendarEvent(eventId: string): Promise<void> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    // Event already gone (manually deleted from Calendar, or never
    // created because Calendar wasn't connected at booking time) — not
    // fatal, cancellation must still succeed.
    console.error("Failed to delete Google Calendar event (continuing):", err);
  }
}

export async function pullBusyBlocks(): Promise<{ synced: boolean; count: number }> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return { synced: false, count: 0 };

  const calendar = google.calendar({ version: "v3", auth: client });
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(); // ~13 months out, comfortably past any realistic max-advance-days setting

  const response = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: "primary" }] },
  });
  const busy = response.data.calendars?.primary?.busy ?? [];

  const supabase = getSupabaseClient();
  // Wholesale replace, never incremental — see the spec's rationale
  // (a deleted calendar event must not leave a stale row behind).
  const { error: deleteError } = await supabase.from("google_busy_blocks_cache").delete().gte("synced_at", "1970-01-01");
  if (deleteError) throw deleteError;

  if (busy.length > 0) {
    const { error: insertError } = await supabase.from("google_busy_blocks_cache").insert(
      busy
        .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
        .map((b) => ({ start_time: b.start, end_time: b.end })),
    );
    if (insertError) throw insertError;
  }

  await supabase.from("google_calendar_sync").update({ last_synced_at: new Date().toISOString() }).eq("id", true);

  return { synced: true, count: busy.length };
}
