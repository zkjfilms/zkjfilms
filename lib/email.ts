import { Resend } from "resend";
import { BUSINESS, SITE_URL } from "@/lib/seo";
import { formatTimeRange, formatDate, formatCents } from "@/lib/format";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

// Shared between the /api/book flow (first send) and the admin
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

// Sent once from the Stripe webhook after a booking's deposit is
// confirmed (see lib/bookingWebhooks.ts). Combines the contract-signing
// link and the client's private manage link (reschedule/cancel) into
// one email, since both exist by the time this fires.
export async function sendBookingConfirmedEmail(params: {
  contractId: string;
  clientName: string;
  clientEmail: string;
  bookingToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }

  const signingUrl = `${SITE_URL}/sign/${params.contractId}`;
  const manageUrl = `${SITE_URL}/manage/${params.bookingToken}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: "You're booked!",
      text: [
        `Hi ${params.clientName},`,
        "",
        "Thanks for booking and for your deposit — you're all set.",
        "",
        "Please sign your session agreement here:",
        signingUrl,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(params.clientName)},</p>
        <p>Thanks for booking and for your deposit — you're all set.</p>
        <p>Please sign your session agreement here:</p>
        <p><a href="${signingUrl}">${signingUrl}</a></p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
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

// --- NEW self-hosted `bookings` system (see lib/bookingsWebhook.ts and
// app/api/bookings/route.ts) ---------------------------------------------

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
// from 'pending' to 'confirmed'.
export async function sendBookingPaymentConfirmedEmail(
  booking: BookingForEmail & { amount_paid_cents: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const paidLine = booking.amount_paid_cents
    ? `Payment of ${formatCents(booking.amount_paid_cents)} received — you're all set.`
    : "You're all set.";
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

// Sent after a reschedule (free or paid) actually swaps the client onto
// their new slot.
export async function sendRescheduleConfirmedEmail(slot: {
  client_name: string | null;
  client_email: string | null;
  session_type: string;
  start_time: string;
  end_time: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }
  if (!slot.client_email || !slot.client_name) {
    return { ok: false, error: "Missing client info on slot." };
  }

  const when = formatTimeRange(slot.start_time, slot.end_time);
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [slot.client_email],
      subject: "Your session has been rescheduled",
      text: [
        `Hi ${slot.client_name},`,
        "",
        `Your ${slot.session_type} session is now scheduled for ${when}.`,
        "",
        "See you then,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(slot.client_name)},</p>
        <p>Your ${escapeHtml(slot.session_type)} session is now scheduled for ${escapeHtml(when)}.</p>
        <p>See you then,<br />${escapeHtml(BUSINESS.name)}</p>
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

// Sent after a cancellation, regardless of whether the Stripe refund
// call itself succeeded — refundStatus === "failed" still confirms the
// cancellation to the client, just without promising a refund amount.
export async function sendCancellationConfirmedEmail(params: {
  clientName: string;
  clientEmail: string;
  sessionType: string;
  startTime: string;
  refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";
  refundAmountCents: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }

  const when = formatDate(params.startTime);
  const refundLine =
    params.refundStatus === "refunded"
      ? `A full refund of ${formatCents(params.refundAmountCents)} has been issued.`
      : params.refundStatus === "partial_refund"
        ? `A partial refund of ${formatCents(params.refundAmountCents)} has been issued.`
        : params.refundStatus === "no_refund"
          ? "Per our cancellation policy, this booking wasn't eligible for a refund."
          : "We're processing your refund and will follow up shortly.";

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: "Your session has been cancelled",
      text: [
        `Hi ${params.clientName},`,
        "",
        `Your ${params.sessionType} session on ${when} has been cancelled.`,
        refundLine,
        "",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(params.clientName)},</p>
        <p>Your ${escapeHtml(params.sessionType)} session on ${escapeHtml(when)} has been cancelled.</p>
        <p>${escapeHtml(refundLine)}</p>
        <p>${escapeHtml(BUSINESS.name)}</p>
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
