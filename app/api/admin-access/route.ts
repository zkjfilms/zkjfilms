import {
  checkPassword,
  createAccessToken,
  ADMIN_ACCESS_COOKIE,
} from "@/lib/adminAccess";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

type Payload = { password: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password } = body as Record<string, unknown>;

  if (typeof password !== "string" || !password) return null;

  return { password };
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { allowed } = await checkRateLimit({
    ip: getClientIp(request),
    endpoint: "admin-access",
    maxHits: 10,
    windowMinutes: 15,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD is not set.");
    return Response.json(
      { error: "Admin area is not configured yet." },
      { status: 500 },
    );
  }

  if (!checkPassword(payload.password)) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  // No maxAge/expires — a session cookie, cleared when the browser closes.
  // Path=/ (not /admin) — the CRM API routes live under /api/admin/*,
  // which isn't a sub-path of /admin, so a narrower scope would silently
  // exclude those requests from carrying the cookie.
  const cookieParts = [
    `${ADMIN_ACCESS_COOKIE}=${createAccessToken()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  // Clear a stale cookie from before this route scoped it to Path=/
  // instead of Path=/admin — browsers key cookies by (name, domain,
  // path), so a mismatched path leaves the old one behind indefinitely
  // otherwise. Harmless no-op for a session that never had one.
  headers.append(
    "Set-Cookie",
    `${ADMIN_ACCESS_COOKIE}=; Path=/admin; Max-Age=0`,
  );
  headers.append("Set-Cookie", cookieParts.join("; "));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
