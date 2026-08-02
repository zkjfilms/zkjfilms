import { Resend } from "resend";
import { BUSINESS, SITE_URL } from "@/lib/seo";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

// Shared between the Acuity webhook (first send) and the admin
// send/resend action, so both paths produce the same email.
export async function sendSigningLinkEmail(contract: {
  id: string;
  client_name: string;
  client_email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }

  const signingUrl = `${SITE_URL}/sign/${contract.id}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [contract.client_email],
      subject: "Please sign your session agreement",
      text: [
        `Hi ${contract.client_name},`,
        "",
        "Thanks for booking! Please sign your session agreement here:",
        signingUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(contract.client_name)},</p>
        <p>Thanks for booking! Please sign your session agreement here:</p>
        <p><a href="${signingUrl}">${signingUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });

    if (error) {
      return { ok: false, error: error.message ?? "Resend error." };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error.",
    };
  }
}
