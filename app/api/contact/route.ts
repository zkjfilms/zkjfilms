import { getSupabaseClient } from "@/lib/supabase";
import { sendContactInquiryEmail } from "@/lib/email";
import { turnstileFailureResponse, verifyTurnstileToken } from "@/lib/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { EMAIL_REGEX } from "@/lib/scheduling";

type ContactPayload = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
  turnstileToken: string;
  honeypot: string;
};

function parsePayload(body: unknown): ContactPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, sessionType, message, turnstileToken, honeypot } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof sessionType !== "string" ||
    typeof message !== "string" ||
    (typeof turnstileToken !== "string" && turnstileToken !== undefined) ||
    (typeof honeypot !== "string" && honeypot !== undefined)
  ) {
    return null;
  }

  const trimmed = {
    name: name.trim(),
    email: email.trim(),
    sessionType: sessionType.trim(),
    message: message.trim(),
    turnstileToken: turnstileToken === undefined ? "" : turnstileToken,
    honeypot: honeypot === undefined ? "" : honeypot,
  };

  if (
    !trimmed.name ||
    !EMAIL_REGEX.test(trimmed.email) ||
    !trimmed.sessionType ||
    !trimmed.message
  ) {
    return null;
  }

  return trimmed;
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
    return Response.json(
      { error: "Please fill out all fields with a valid email address." },
      { status: 400 },
    );
  }

  // Honeypot: a real client never fills this hidden field. Silently
  // pretend success so a bot doesn't learn its submission was rejected.
  if (payload.honeypot) {
    return Response.json({ ok: true });
  }

  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({
    ip,
    endpoint: "contact",
    maxHits: 5,
    windowMinutes: 10,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429 },
    );
  }

  if (!payload.turnstileToken) {
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const verification = await verifyTurnstileToken(payload.turnstileToken, ip);
  if (!verification.ok) {
    return turnstileFailureResponse(verification);
  }

  const emailResult = await sendContactInquiryEmail({
    name: payload.name,
    email: payload.email,
    sessionType: payload.sessionType,
    message: payload.message,
  });
  if (!emailResult.ok) {
    console.error("Failed to send contact email:", emailResult.error);
    return Response.json(
      { error: "Failed to send message." },
      { status: 502 },
    );
  }

  // Best-effort — the email is the primary notification, so a lead
  // logging failure shouldn't fail the whole submission.
  try {
    const supabase = getSupabaseClient();
    const { error: leadError } = await supabase.from("leads").insert({
      name: payload.name,
      email: payload.email,
      session_type: payload.sessionType,
      message: payload.message,
    });
    if (leadError) {
      console.error("Failed to record lead:", leadError);
    }
  } catch (err) {
    console.error("Failed to record lead:", err);
  }

  return Response.json({ ok: true });
}
