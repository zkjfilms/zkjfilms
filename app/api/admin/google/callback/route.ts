import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { exchangeCodeAndStoreTokens } from "@/lib/googleCalendar";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const code = new URL(request.url).searchParams.get("code");
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
