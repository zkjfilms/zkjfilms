import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getGoogleAuthUrl } from "@/lib/googleCalendar";

export async function GET() {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  // CSRF protection: a random, single-use state value tied to this
  // browser via an HttpOnly cookie, verified against the `state` query
  // param the callback route receives back from Google. Without this,
  // an attacker could start their own OAuth flow, then trick an
  // already-authenticated admin into completing it — linking the
  // attacker's Google account's tokens into google_calendar_sync.
  const state = randomBytes(32).toString("base64url");
  cookieStore.set("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — the OAuth flow should complete well within this
    path: "/",
  });
  redirect(getGoogleAuthUrl(state));
}
