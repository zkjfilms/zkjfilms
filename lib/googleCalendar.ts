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

export function getGoogleAuthUrl(): string {
  const client = getGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on a re-connect
    scope: SCOPES,
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
