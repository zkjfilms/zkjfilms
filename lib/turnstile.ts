export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unreachable" };

// A real client IP always contains a dot or colon (IPv4/IPv6). getClientIp
// falls back to the literal string "unknown" when no forwarding header is
// present (never happens on Vercel, but can happen in local dev) — Cloudflare
// tolerates it, but there's no reason to send a value that isn't an IP.
function isLikelyIp(value: string): boolean {
  return value !== "unknown" && value.length > 0;
}

export async function verifyTurnstileToken(
  token: string,
  ip: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set.");
    return { ok: false, reason: "unreachable" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (isLikelyIp(ip)) {
    body.set("remoteip", ip);
  }

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
  } catch (err) {
    console.error("Turnstile verification request failed:", err);
    return { ok: false, reason: "unreachable" };
  }

  if (!response.ok) {
    console.error(
      "Turnstile siteverify returned non-OK status:",
      response.status,
    );
    return { ok: false, reason: "unreachable" };
  }

  try {
    const data = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (typeof data?.success !== "boolean") {
      console.error("Turnstile response missing a boolean success field:", data);
      return { ok: false, reason: "unreachable" };
    }

    if (!data.success) {
      console.error("Turnstile verification failed:", data["error-codes"]);
      return { ok: false, reason: "invalid" };
    }

    return { ok: true };
  } catch (err) {
    console.error("Turnstile response JSON parse failed:", err);
    return { ok: false, reason: "unreachable" };
  }
}

// Shared by both API routes so the 503-vs-400 mapping for a failed
// verification lives in one place instead of being duplicated per route.
export function turnstileFailureResponse(
  result: Extract<TurnstileResult, { ok: false }>,
): Response {
  if (result.reason === "unreachable") {
    return Response.json(
      {
        error:
          "Verification service is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
  return Response.json(
    { error: "Verification failed. Please try again." },
    { status: 400 },
  );
}
