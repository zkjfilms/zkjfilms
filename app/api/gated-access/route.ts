import {
  checkPassword,
  createAccessToken,
  GATED_ACCESS_COOKIE,
} from "@/lib/gatedAccess";

type Payload = { password: string; ageConfirmed: boolean };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password, ageConfirmed } = body as Record<string, unknown>;

  if (typeof password !== "string" || typeof ageConfirmed !== "boolean") {
    return null;
  }

  return { password, ageConfirmed };
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

  if (!payload.ageConfirmed) {
    return Response.json(
      { error: "Please confirm you are 18 or older to continue." },
      { status: 400 },
    );
  }

  if (!process.env.GATED_ACCESS_PASSWORD) {
    console.error("GATED_ACCESS_PASSWORD is not set.");
    return Response.json(
      { error: "This gallery isn't configured yet." },
      { status: 500 },
    );
  }

  if (!checkPassword(payload.password)) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  // No maxAge/expires — a session cookie, cleared when the browser closes,
  // so access doesn't carry over to a new session.
  const cookieParts = [
    `${GATED_ACCESS_COOKIE}=${createAccessToken()}`,
    "Path=/gated",
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
