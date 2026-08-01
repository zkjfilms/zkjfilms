import { Resend } from "resend";
import { BUSINESS } from "@/lib/seo";

// PLACEHOLDER — swap for a verified domain address once one is set up in Resend.
const FROM_ADDRESS = `${BUSINESS.name} <onboarding@resend.dev>`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactPayload = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsePayload(body: unknown): ContactPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, sessionType, message } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof sessionType !== "string" ||
    typeof message !== "string"
  ) {
    return null;
  }

  const trimmed = {
    name: name.trim(),
    email: email.trim(),
    sessionType: sessionType.trim(),
    message: message.trim(),
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set.");
    return Response.json(
      { error: "Email service is not configured yet." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);

  // Resend's sandbox mode (before a sending domain is verified) only
  // allows delivery to the Resend account's own email. CONTACT_TO_EMAIL
  // lets that be overridden independently of the public-facing business
  // email in lib/seo.ts. Once a domain is verified, this can be dropped
  // in favor of BUSINESS.email again.
  const toEmail = process.env.CONTACT_TO_EMAIL || BUSINESS.email;

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
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

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Failed to send contact email:", err);
    return Response.json(
      { error: "Failed to send message." },
      { status: 500 },
    );
  }
}
