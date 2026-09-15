import { getStripeClient } from "@/lib/stripe";

export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // "YYYY-MM-DD"
  sessionDateTime: string | null;
  clientPhone: string | null;
  billingAddress: { line1: string; city: string; state: string; postalCode: string } | null;
}): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }> {
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
            line1: params.billingAddress.line1,
            city: params.billingAddress.city,
            state: params.billingAddress.state,
            postal_code: params.billingAddress.postalCode,
            country: "US",
          }
        : undefined,
    }));

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

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
    metadata: params.bookingId ? { bookingId: params.bookingId } : {},
    // Stripe's built-in mechanism for a labeled, non-billable row on the
    // hosted invoice/PDF — distinct from line items, doesn't affect the
    // total. Up to 4 allowed; this feature only ever sends one.
    custom_fields: params.sessionDateTime ? [{ name: "Session", value: params.sessionDateTime }] : undefined,
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
  };
}

export async function voidInvoice(stripeInvoiceId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.invoices.voidInvoice(stripeInvoiceId);
}
