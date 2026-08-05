import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { exchangeCodeAndStoreTokens } from "@/lib/googleCalendar";

// Same constant-time comparison pattern as lib/adminAccess.ts's
// timingSafeStringEqual — used here to compare the OAuth `state` query
// param against the cookie set in the connect route.
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = cookieStore.get("google_oauth_state")?.value;
  cookieStore.delete("google_oauth_state");

  if (!expectedState || !returnedState || !timingSafeStringEqual(returnedState, expectedState)) {
    return Response.json({ error: "Invalid or expired OAuth state." }, { status: 400 });
  }
  if (!code) {
    return Response.json({ error: "Missing authorization code." }, { status: 400 });
  }
  try {
    await exchangeCodeAndStoreTokens(code);
  } catch (err) {
    console.error("Google OAuth token exchange failed:", err);
    return Response.json({ error: "Failed to connect Google Calendar." }, { status: 500 });
  }
  redirect("/admin/availability?googleConnected=1");
}
