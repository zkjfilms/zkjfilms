export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unreachable" };

export async function verifyTurnstileToken(
  token: string,
  ip: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set.");
    return { ok: false, reason: "unreachable" };
  }

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
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

  const data = (await response.json()) as { success: boolean };
  return data.success ? { ok: true } : { ok: false, reason: "invalid" };
}
