import { Resend } from "resend";
import { BUSINESS } from "@/lib/seo";
import { getSupabaseClient } from "@/lib/supabase";
import { escapeHtml } from "@/lib/email";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getClientIp } from "@/lib/rateLimit";

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactPayload = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
  turnstileToken: string;
};

function parsePayload(body: unknown): ContactPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, sessionType, message, turnstileToken } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof sessionType !== "string" ||
    typeof message !== "string" ||
    typeof turnstileToken !== "string" ||
    !turnstileToken
  ) {
    return null;
  }

  const trimmed = {
    name: name.trim(),
    email: email.trim(),
    sessionType: sessionType.trim(),
    message: message.trim(),
    turnstileToken,
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

  const verification = await verifyTurnstileToken(
    payload.turnstileToken,
    getClientIp(request),
  );
  if (!verification.ok) {
    if (verification.reason === "unreachable") {
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set.");
    return Response.json(
      { error: "Email service is not configured yet." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [BUSINESS.email],
      replyTo: payload.email,
      subject: `New inquiry from ${payload.name}`,
      text: [
        `Name: ${payload.name}`,
        `Email: ${payload.email}`,
        `Session type: ${payload.sessionType}`,
        "",
        "Message:",
        payload.message,
      ].join("\n"),
      html: `
        <h2>New contact form submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
        <p><strong>Session type:</strong> ${escapeHtml(payload.sessionType)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(payload.message).replace(/\n/g, "<br />")}</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
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
  } catch (err) {
    console.error("Failed to send contact email:", err);
    return Response.json(
      { error: "Failed to send message." },
      { status: 500 },
    );
  }
}
