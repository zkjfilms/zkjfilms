import { getStripeClient } from "@/lib/stripe";

export async function createInvoice(params: {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: { description: string; amountCents: number }[];
  dueDate: string | null; // "YYYY-MM-DD"
}): Promise<{ stripeInvoiceId: string; stripeCustomerId: string; hostedInvoiceUrl: string }> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.list({ email: params.clientEmail, limit: 1 });
  const customer =
    existing.data[0] ??
    (await stripe.customers.create({ email: params.clientEmail, name: params.clientName }));

  for (const item of params.lineItems) {
    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: item.amountCents,
      currency: "usd",
      description: item.description,
    });
  }

  const daysUntilDue = params.dueDate
    ? Math.max(1, Math.ceil((new Date(`${params.dueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000))
    : 30;

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    auto_advance: false,
    metadata: params.bookingId ? { bookingId: params.bookingId } : {},
  });

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
