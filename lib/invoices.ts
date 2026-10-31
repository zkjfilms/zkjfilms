import { getStripeClient } from "@/lib/stripe";
import { BUSINESS, SITE_URL, STUDIO_ADDRESS } from "@/lib/seo";
import type { InvoiceEmailDetails } from "@/lib/email";

// A dated line item that should also become a real booking once the invoice
// is paid ("book each dated line on payment"). Nothing is held while the
// invoice is unpaid — these ride along in Stripe metadata and
// lib/invoicesWebhook.ts creates the bookings on invoice.paid.
export type LineBooking = {
  appointmentTypeId: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
};

// Stripe allows 50 metadata keys per invoice; this keeps plenty of headroom
// under that limit.
export const MAX_LINE_BOOKINGS = 10;

const LINE_BOOKING_KEY_PREFIX = "lineBooking";
const LINE_BOOKING_PHONE_KEY = "lineBookingClientPhone";
const LINE_BOOKING_NOTES_KEY = "lineBookingNotes";
const LINE_BOOKING_LOCATION_KEY = "lineBookingLocation";

// One key per booking, "typeId|date|startTime" (~53 chars, well under
// Stripe's 500-char value limit).
function lineBookingsToMetadata(
  lineBookings: LineBooking[],
  clientPhone: string | null,
  notes: string | null,
  location: string | null,
): Record<string, string> {
  if (lineBookings.length === 0) return {};
  const meta: Record<string, string> = {};
  lineBookings.forEach((b, i) => {
    meta[`${LINE_BOOKING_KEY_PREFIX}${i}`] = `${b.appointmentTypeId}|${b.date}|${b.startTime}`;
  });
  if (clientPhone) meta[LINE_BOOKING_PHONE_KEY] = clientPhone;
  if (notes) meta[LINE_BOOKING_NOTES_KEY] = notes;
  if (location) meta[LINE_BOOKING_LOCATION_KEY] = location;
  return meta;
}

export function lineBookingsFromMetadata(meta: Record<string, string> | null | undefined): {
  lineBookings: LineBooking[];
  clientPhone: string;
  notes: string;
  location: string;
} {
  const lineBookings: LineBooking[] = [];
  for (let i = 0; i < MAX_LINE_BOOKINGS; i++) {
    const raw = meta?.[`${LINE_BOOKING_KEY_PREFIX}${i}`];
    if (!raw) break;
    const [appointmentTypeId, date, startTime] = raw.split("|");
    if (appointmentTypeId && date && startTime) lineBookings.push({ appointmentTypeId, date, startTime });
  }
  return {
    lineBookings,
    clientPhone: meta?.[LINE_BOOKING_PHONE_KEY] ?? "",
    notes: meta?.[LINE_BOOKING_NOTES_KEY] ?? "",
    // Invoices sent before the location field existed were all at the studio.
    location: meta?.[LINE_BOOKING_LOCATION_KEY] ?? STUDIO_ADDRESS,
  };
}

export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // "YYYY-MM-DD"
  clientPhone: string | null;
  billingAddress: { line1: string; city: string; state: string; postalCode: string } | null;
  lineBookings?: LineBooking[];
  bookingNotes?: string | null;
  location?: string | null;
}): Promise<{
  stripeInvoiceId: string;
  stripeCustomerId: string;
  hostedInvoiceUrl: string;
  invoiceNumber: string | null;
  dueDateIso: string | null;
}> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.list({ email: params.clientEmail, limit: 1 });
  // Phone and billing address are only ever attached to a brand-new Stripe
  // customer — this branch. An existing customer found by email above is
  // never updated, so a repeat client's already-populated (possibly more
  // complete) Stripe record can't be clobbered by a blank or partial form.
  const customer =
    existing.data[0] ??
    (await stripe.customers.create({
      email: params.clientEmail,
      name: params.clientName,
      phone: params.clientPhone ?? undefined,
      address: params.billingAddress
        ? {
            line1: params.billingAddress.line1 || undefined,
            city: params.billingAddress.city || undefined,
            state: params.billingAddress.state || undefined,
            postal_code: params.billingAddress.postalCode || undefined,
            country: "US",
          }
        : undefined,
    }));

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

  // Booked line items don't create a real booking synchronously — the
  // intended session details ride along in this invoice's Stripe metadata
  // instead, the same mechanism already used for bookingId. The
  // stripe-invoices webhook (lib/invoicesWebhook.ts) reads these exact keys
  // back out once the invoice is actually paid, and creates the real
  // bookings at that point — see that file for why (no hold on an unpaid
  // invoice is deliberate).

  // Create the invoice first, then attach line items directly to it by ID.
  // Creating items on the customer before the invoice exists would make them
  // "pending invoice items" — Stripe's default pending_invoice_items_behavior
  // is "include", which sweeps in every pending item on the customer,
  // including ones left over from a prior failed attempt. pending_invoice_items_behavior:
  // "exclude" is defense-in-depth in case any pending items exist on this customer.
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    metadata: {
      ...(params.bookingId ? { bookingId: params.bookingId } : {}),
      ...lineBookingsToMetadata(
        params.lineBookings ?? [],
        params.clientPhone,
        params.bookingNotes ?? null,
        params.location ?? null,
      ),
    },
    // The memo at the top of Stripe's hosted invoice page/PDF, and the footer
    // at the bottom — the closest Stripe gets to letterhead and a signature.
    description: params.lineBookings?.length
      ? `Thank you for choosing ${BUSINESS.name} Photography. Your session dates are reserved for you and will be confirmed as soon as payment is received — you'll then receive a confirmation email with a calendar invitation.`
      : `Thank you for choosing ${BUSINESS.name} Photography. Please don't hesitate to reach out with any questions about this invoice.`,
    footer: INVOICE_FOOTER,
    // A labeled, non-billable row on the hosted invoice/PDF (Stripe caps
    // values at 140 chars — the form and route enforce that).
    custom_fields:
      params.lineBookings?.length && params.location ? [{ name: "Session location", value: params.location }] : undefined,
  });

  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);

  return {
    stripeInvoiceId: finalized.id!,
    stripeCustomerId: customer.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url!,
    invoiceNumber: finalized.number ?? null,
    dueDateIso: finalized.due_date ? new Date(finalized.due_date * 1000).toISOString() : null,
  };
}

const INVOICE_FOOTER = [
  `${BUSINESS.name} · Photographer`,
  `${STUDIO_ADDRESS}`,
  `${BUSINESS.email} · ${SITE_URL.replace(/^https?:\/\//, "")}`,
].join("\n");

// What the branded invoice email (lib/email.ts's sendInvoiceEmail) shows,
// read back from Stripe so the create and resend paths always match the
// actual invoice — numbering, final line descriptions, and due date are
// all Stripe's.
export async function getInvoiceEmailDetails(stripeInvoiceId: string): Promise<InvoiceEmailDetails> {
  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
  const lines = await stripe.invoices.listLineItems(stripeInvoiceId, { limit: 100 });
  const hasBookings = lineBookingsFromMetadata(invoice.metadata).lineBookings.length > 0;
  return {
    invoiceNumber: invoice.number ?? null,
    items: lines.data.map((line) => ({ description: line.description ?? "", amountCents: line.amount })),
    totalCents: invoice.total,
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    location: hasBookings ? lineBookingsFromMetadata(invoice.metadata).location : null,
  };
}

export async function voidInvoice(stripeInvoiceId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.invoices.voidInvoice(stripeInvoiceId);
}
