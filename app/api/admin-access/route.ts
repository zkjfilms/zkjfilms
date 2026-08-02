import {
  checkPassword,
  createAccessToken,
  ADMIN_ACCESS_COOKIE,
} from "@/lib/adminAccess";

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
  const cookieParts = [
    `${ADMIN_ACCESS_COOKIE}=${createAccessToken()}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieParts.join("; "),
    },
  });
}
