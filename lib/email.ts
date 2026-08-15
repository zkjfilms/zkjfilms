import { Resend } from "resend";
import { BUSINESS, SITE_URL } from "@/lib/seo";
import { formatTimeRange, formatCents } from "@/lib/format";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

// Contract signing link. Sent from the admin send/resend action
// (app/api/admin/contracts/[id]/send-email/route.ts) — its only caller
// since the old booking_slots flow was retired.
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

// --- Self-hosted `bookings` system (see lib/bookingsWebhook.ts and
// app/api/bookings/route.ts) ---------------------------------------------
//
// `when` in every template below comes from formatTimeRange, which renders
// in BUSINESS_TIME_ZONE with the timezone abbreviation appended — these run
// on Vercel, whose runtime timezone is UTC.

type BookingForEmail = {
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  booking_token: string;
  appointment_types: { name: string } | { name: string }[] | null;
};

function appointmentTypeName(booking: BookingForEmail): string {
  const rel = booking.appointment_types;
  if (!rel) return "your appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "your appointment") : rel.name;
}

// Sent directly from app/api/bookings/route.ts when a free appointment
// type is booked (no payment required, so the booking is confirmed
// immediately — no Stripe webhook round trip).
export async function sendFreeBookingConfirmedEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent from the Stripe webhook (lib/bookingsWebhook.ts) once a paid
// appointment type's checkout session completes and the booking flips
// from 'pending' to 'confirmed'. Also called directly from
// app/api/bookings/route.ts when a discount code fully covers the price —
// there's no Stripe session in that case, and the row is inserted as
// 'confirmed' outright rather than flipped from 'pending'.
export async function sendBookingPaymentConfirmedEmail(
  booking: BookingForEmail & {
    amount_paid_cents: number | null;
    discount_code: string | null;
    discount_cents: number | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const paidLine = booking.amount_paid_cents
    ? `Payment of ${formatCents(booking.amount_paid_cents)} received — you're all set.`
    : "You're all set.";
  const discountLine =
    booking.discount_code && booking.discount_cents
      ? `Discount applied: ${booking.discount_code} (-${formatCents(booking.discount_cents)}).`
      : null;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        paidLine,
        ...(discountLine ? [discountLine] : []),
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>${escapeHtml(paidLine)}</p>
        ${discountLine ? `<p>${escapeHtml(discountLine)}</p>` : ""}
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent from app/api/manage/[token]/reschedule/route.ts once the
// reschedule_booking RPC swaps the client onto their new slot.
export async function sendBookingRescheduledEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "Your appointment has been rescheduled",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `Your ${typeName} appointment is now scheduled for ${when}.`,
        "",
        "Need to make another change? Use your private booking link:",
        manageUrl,
        "",
        "See you then,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>Your ${escapeHtml(typeName)} appointment is now scheduled for ${escapeHtml(when)}.</p>
        <p>Need to make another change? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you then,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent from the admin "Notify client" action
// (app/api/admin/galleries/[slug]/send-ready-email/route.ts) once a
// fresh gallery password/PIN have already been generated and persisted.
// The caller fills the template before calling this — same division of
// responsibility as sendSigningLinkEmail, which doesn't know about
// template tokens either. bodyText is rendered into a plain <pre> block
// rather than a richer HTML layout: this template is short and
// credential-bearing, not worth a separate HTML version the admin's
// plain-text edits in /admin/templates would drift out of sync with.
export async function sendGalleryReadyEmail(params: {
  clientEmail: string;
  galleryTitle: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: `${params.galleryTitle} is ready to view`,
      text: params.bodyText,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(params.bodyText)}</pre>`,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
