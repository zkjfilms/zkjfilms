import { Resend } from "resend";
import { BUSINESS, SITE_URL, STUDIO_ADDRESS } from "@/lib/seo";
import { formatTimeRange, formatCents, formatBusinessDate } from "@/lib/format";
import { escapeHtml, renderEmail, type EmailContent } from "@/lib/emailLayout";
import { buildIcs, bookingEventUid, type CalendarEvent } from "@/lib/ics";

export { escapeHtml };

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

// Every client-facing email below renders through lib/emailLayout.ts's
// branded layout; booking confirmations and reschedules also attach an
// .ics invite (lib/ics.ts). Admin-only notifications further down stay
// plain text-ish on purpose.

type Attachment = { filename: string; content: string; contentType: string };

async function sendClientEmail(params: {
  to: string;
  subject: string;
  content: EmailContent;
  attachments?: Attachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const { html, text } = renderEmail(params.content);
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.to],
      replyTo: BUSINESS.email,
      subject: params.subject,
      html,
      text,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "utf-8"),
        contentType: a.contentType,
      })),
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// "zach johnson" -> "Zach" — greet by first name, capitalized, however the
// name was typed into a form.
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first ? first[0].toUpperCase() + first.slice(1) : "there";
}

function calendarAttachment(events: CalendarEvent[]): Attachment {
  return { filename: "session.ics", content: buildIcs(events), contentType: "text/calendar; charset=utf-8; method=PUBLISH" };
}

// Contract signing link. Sent from the admin send/resend action
// (app/api/admin/contracts/[id]/send-email/route.ts) — its only caller
// since the old booking_slots flow was retired.
export async function sendSigningLinkEmail(contract: {
  id: string;
  client_name: string;
  client_email: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendClientEmail({
    to: contract.client_email,
    subject: "Please review and sign your session agreement",
    content: {
      preheader: "Your session agreement is ready to review and sign.",
      eyebrow: "Session agreement",
      heading: "Your agreement is ready",
      greeting: `Hi ${firstName(contract.client_name)},`,
      intro: [
        "Thank you for booking with me. Before your session, please take a moment to review and sign your session agreement — it only takes a minute and keeps everything clear for both of us.",
      ],
      button: { label: "Review & sign", url: `${SITE_URL}/sign/${contract.id}` },
      outro: ["If you have any questions about the agreement, simply reply to this email."],
    },
  });
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
  if (!rel) return "Your session";
  return Array.isArray(rel) ? (rel[0]?.name ?? "Your session") : rel.name;
}

function manageUrlFor(booking: { booking_token: string }): string {
  return `${SITE_URL}/manage/${booking.booking_token}`;
}

function bookingCalendarEvent(booking: BookingForEmail, location: string): CalendarEvent {
  return {
    uid: bookingEventUid(booking.booking_token),
    startIso: booking.start_time,
    endIso: booking.end_time,
    title: `${appointmentTypeName(booking)} with ${BUSINESS.name}`,
    location,
    description: `Need to reschedule or cancel? ${manageUrlFor(booking)}`,
    url: manageUrlFor(booking),
  };
}

// Website bookings don't carry a location of their own — they're at the
// studio. (Invoice bookings can override it; see sendInvoiceBookingsConfirmedEmail.)
function bookingConfirmedEmail(
  booking: BookingForEmail,
  details: { label: string; value: string }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const typeName = appointmentTypeName(booking);
  return sendClientEmail({
    to: booking.client_email,
    subject: `You're booked: ${typeName}`,
    content: {
      preheader: `${typeName} — ${formatTimeRange(booking.start_time, booking.end_time)}`,
      eyebrow: "Booking confirmed",
      heading: "You're all set",
      greeting: `Hi ${firstName(booking.client_name)},`,
      intro: [
        "Thank you for booking with me — your session is confirmed. A calendar invitation is attached so you can add it to your calendar.",
      ],
      sessions: [
        {
          title: typeName,
          when: formatTimeRange(booking.start_time, booking.end_time),
          location: STUDIO_ADDRESS,
          manageUrl: manageUrlFor(booking),
        },
      ],
      details,
      outro: ["If anything comes up or you have questions before your session, simply reply to this email."],
    },
    attachments: [calendarAttachment([bookingCalendarEvent(booking, STUDIO_ADDRESS)])],
  });
}

// Sent directly from app/api/bookings/route.ts when a free appointment
// type is booked (no payment required, so the booking is confirmed
// immediately — no Stripe webhook round trip).
export async function sendFreeBookingConfirmedEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return bookingConfirmedEmail(booking, []);
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
  const details: { label: string; value: string }[] = [];
  if (booking.amount_paid_cents) details.push({ label: "Amount paid", value: formatCents(booking.amount_paid_cents) });
  if (booking.discount_code && booking.discount_cents) {
    details.push({ label: "Discount", value: `${booking.discount_code} (−${formatCents(booking.discount_cents)})` });
  }
  return bookingConfirmedEmail(booking, details);
}

// Sent from app/api/manage/[token]/reschedule/route.ts once the
// reschedule_booking RPC swaps the client onto their new slot. The
// attached invite shares the original's UID, so it moves the event the
// client already added rather than adding a second one.
export async function sendBookingRescheduledEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const typeName = appointmentTypeName(booking);
  const when = formatTimeRange(booking.start_time, booking.end_time);
  return sendClientEmail({
    to: booking.client_email,
    subject: `Your session has been rescheduled: ${typeName}`,
    content: {
      preheader: `New time: ${when}`,
      eyebrow: "Updated booking",
      heading: "Your session has been rescheduled",
      greeting: `Hi ${firstName(booking.client_name)},`,
      intro: ["Your session has been moved to the new time below. An updated calendar invitation is attached."],
      sessions: [{ title: typeName, when, location: STUDIO_ADDRESS, manageUrl: manageUrlFor(booking) }],
      outro: ["If you need to make another change, use the link above or simply reply to this email."],
    },
    attachments: [calendarAttachment([bookingCalendarEvent(booking, STUDIO_ADDRESS)])],
  });
}

// Sent from the admin "Notify client" action
// (app/api/admin/galleries/[slug]/send-ready-email/route.ts) once a
// fresh gallery password/PIN have already been generated and persisted.
// The caller fills the template before calling this — same division of
// responsibility as sendSigningLinkEmail, which doesn't know about
// template tokens either. bodyText is the admin's plain-text template
// (/admin/templates), dropped into the branded layout as-is — it carries
// its own greeting and sign-off, so no signature block is added.
export async function sendGalleryReadyEmail(params: {
  clientEmail: string;
  galleryTitle: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendClientEmail({
    to: params.clientEmail,
    subject: `${params.galleryTitle} is ready to view`,
    content: {
      preheader: `${params.galleryTitle} is ready to view.`,
      eyebrow: "Your gallery",
      heading: `${params.galleryTitle} is ready`,
      bodyText: params.bodyText,
      signOff: false,
    },
  });
}

// Sent by the send-session-reminders cron
// (app/api/cron/send-session-reminders/route.ts) 2 days before a
// confirmed booking. Same shape as sendGalleryReadyEmail: the caller
// fills the admin's plain-text template, dropped into the branded layout
// with no extra sign-off.
export async function sendSessionReminderEmail(params: {
  clientEmail: string;
  sessionType: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendClientEmail({
    to: params.clientEmail,
    subject: "Your session is coming up",
    content: {
      preheader: `A quick reminder about your ${params.sessionType} session.`,
      eyebrow: "Session reminder",
      heading: "Your session is coming up",
      bodyText: params.bodyText,
      signOff: false,
    },
  });
}

export type InvoiceEmailDetails = {
  invoiceNumber: string | null;
  items: { description: string; amountCents: number }[];
  totalCents: number;
  dueDate: string | null; // ISO
  location: string | null; // set when the invoice books sessions
};

// Sent from the admin invoice create/resend actions
// (app/api/admin/invoices/route.ts, app/api/admin/invoices/[id]/resend/route.ts)
// once Stripe has finalized the invoice and generated its hosted payment
// page. We send our own branded email rather than Stripe's default invoice
// notification — Stripe still handles the actual payment page, PDF, and its
// own automatic payment-reminder emails for unpaid invoices as the due date
// approaches; this only replaces the first notification.
export async function sendInvoiceEmail(params: {
  clientName: string;
  clientEmail: string;
  hostedInvoiceUrl: string;
  details: InvoiceEmailDetails;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { invoiceNumber, items, totalCents, dueDate, location } = params.details;
  const total = formatCents(totalCents);
  const details: { label: string; value: string }[] = [];
  if (invoiceNumber) details.push({ label: "Invoice", value: invoiceNumber });
  if (dueDate) details.push({ label: "Due", value: formatBusinessDate(dueDate) });
  if (location) details.push({ label: "Location", value: location });

  return sendClientEmail({
    to: params.clientEmail,
    subject: `Invoice from ${BUSINESS.name}${invoiceNumber ? ` (${invoiceNumber})` : ""} — ${total}`,
    content: {
      preheader: `Your invoice for ${total}${dueDate ? `, due ${formatBusinessDate(dueDate)}` : ""}.`,
      eyebrow: "Invoice",
      heading: "Your invoice is ready",
      greeting: `Hi ${firstName(params.clientName)},`,
      intro: [
        `Thank you for choosing ${BUSINESS.name} Photography. Your invoice is summarized below — you can review the full details and pay securely online.`,
        ...(location
          ? ["Your session dates are reserved for you and will be confirmed as soon as payment is received."]
          : []),
      ],
      items: items.map((item) => ({ description: item.description, amount: formatCents(item.amountCents) })),
      total: { label: "Total due", amount: total },
      details,
      button: { label: "View & pay invoice", url: params.hostedInvoiceUrl },
      outro: [
        location
          ? "Payments are processed securely by Stripe. Once your payment goes through, you'll receive a confirmation with a calendar invitation for each session."
          : "Payments are processed securely by Stripe, and you'll receive a receipt once your payment goes through.",
        "If you have any questions about this invoice, simply reply to this email.",
      ],
    },
  });
}

// Sent to the site owner (BUSINESS.email) alongside the client-facing
// sendInvoiceEmail, from both the initial create and the Resend action
// (app/api/admin/invoices/route.ts, app/api/admin/invoices/[id]/resend/route.ts).
// Gives the owner a standing record of every invoice that actually went out,
// without having to check the admin dashboard.
export async function sendInvoiceSentNotification(params: {
  clientName: string;
  clientEmail: string;
  hostedInvoiceUrl: string;
  clientEmailFailed?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  // Always fires alongside sendInvoiceEmail, even when that send failed —
  // this is the admin's only signal that a client never got their copy,
  // so it must say so plainly rather than a generic "sent" that would be
  // false in that case.
  const subject = params.clientEmailFailed
    ? `Invoice email FAILED to send to ${params.clientName}`
    : `Invoice sent to ${params.clientName}`;
  const statusLine = params.clientEmailFailed
    ? `The invoice was created, but the email to ${params.clientName} (${params.clientEmail}) failed to send — please deliver the link below manually.`
    : `An invoice was sent to ${params.clientName} (${params.clientEmail}).`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [BUSINESS.email],
      subject,
      text: [statusLine, "", "View it here:", params.hostedInvoiceUrl].join("\n"),
      html: `
        <p>${escapeHtml(statusLine)}</p>
        <p>View it here:</p>
        <p><a href="${params.hostedInvoiceUrl}">${params.hostedInvoiceUrl}</a></p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

// Sent once from the stripe-invoices webhook (lib/invoicesWebhook.ts) after
// a paid invoice's booked line items have become real bookings — one email
// covering every session, with one .ics invite holding all of them, rather
// than one email per session. Kept separate from bookingConfirmedEmail:
// invoice bookings carry their own location, and the paid amount comes from
// the Stripe invoice rather than the booking row.
export async function sendInvoiceBookingsConfirmedEmail(params: {
  clientName: string;
  clientEmail: string;
  bookings: (BookingForEmail & { typeName: string })[];
  location: string;
  amountPaidCents: number;
  invoiceNumber: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plural = params.bookings.length > 1;
  const details: { label: string; value: string }[] = [
    { label: "Amount paid", value: formatCents(params.amountPaidCents) },
  ];
  if (params.invoiceNumber) details.push({ label: "Invoice", value: params.invoiceNumber });

  const events = params.bookings.map((b) =>
    bookingCalendarEvent({ ...b, appointment_types: { name: b.typeName } }, params.location),
  );

  return sendClientEmail({
    to: params.clientEmail,
    subject: plural ? "Your sessions are confirmed" : `You're booked: ${params.bookings[0].typeName}`,
    content: {
      preheader: `Payment received — ${plural ? `${params.bookings.length} sessions` : "your session"} confirmed.`,
      eyebrow: "Booking confirmed",
      heading: "You're all set",
      greeting: `Hi ${firstName(params.clientName)},`,
      intro: [
        `Thank you — your payment has been received and your ${plural ? "sessions are" : "session is"} confirmed. A calendar invitation is attached so you can add ${plural ? "everything" : "it"} to your calendar.`,
      ],
      sessions: params.bookings.map((b) => ({
        title: b.typeName,
        when: formatTimeRange(b.start_time, b.end_time),
        location: params.location,
        manageUrl: manageUrlFor(b),
      })),
      details,
      outro: ["If anything comes up or you have questions before your session, simply reply to this email."],
    },
    attachments: [calendarAttachment(events)],
  });
}

// Sent to the site owner (BUSINESS.email) from the stripe-invoices webhook
// (lib/invoicesWebhook.ts) when an invoice with booked line items gets paid
// but one or more deferred bookings can't be created (most often: someone
// else took the slot while the invoice sat unpaid). The invoice stays marked paid —
// resolving the conflict (a new time, a refund) is a manual, out-of-band
// step; this email is the only signal that one's needed.
export async function sendInvoiceBookingConflictEmail(params: {
  clientName: string;
  clientEmail: string;
  hostedInvoiceUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [BUSINESS.email],
      subject: `Action needed: reschedule ${params.clientName}`,
      text: [
        `${params.clientName} (${params.clientEmail}) paid their invoice, but the time slot it was for is no longer available.`,
        "",
        "The invoice is still marked paid. You'll need to reach out and arrange a new time (or a refund).",
        "",
        "Invoice:",
        params.hostedInvoiceUrl,
      ].join("\n"),
      html: `
        <p>${escapeHtml(params.clientName)} (${escapeHtml(params.clientEmail)}) paid their invoice, but the time slot it was for is no longer available.</p>
        <p>The invoice is still marked paid. You'll need to reach out and arrange a new time (or a refund).</p>
        <p>Invoice:</p>
        <p><a href="${params.hostedInvoiceUrl}">${params.hostedInvoiceUrl}</a></p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

export async function sendContactInquiryEmail(params: {
  name: string;
  email: string;
  sessionType: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [BUSINESS.email],
      replyTo: params.email,
      subject: `New inquiry from ${params.name}`,
      text: [
        `Name: ${params.name}`,
        `Email: ${params.email}`,
        `Session type: ${params.sessionType}`,
        "",
        "Message:",
        params.message,
      ].join("\n"),
      html: `
        <h2>New contact form submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(params.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(params.email)}</p>
        <p><strong>Session type:</strong> ${escapeHtml(params.sessionType)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(params.message).replace(/\n/g, "<br />")}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
