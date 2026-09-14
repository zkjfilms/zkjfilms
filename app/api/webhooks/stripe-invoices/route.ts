import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import {
  handleInvoicePaid,
  handleInvoiceVoided,
  handleInvoiceMarkedUncollectible,
} from "@/lib/invoicesWebhook";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_INVOICES;

  if (!signature || !webhookSecret) {
    return new Response("Missing signature.", { status: 400 });
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  let retry = false;
  if (event.type === "invoice.paid") {
    ({ retry } = await handleInvoicePaid(event.data.object as Stripe.Invoice));
  } else if (event.type === "invoice.voided") {
    ({ retry } = await handleInvoiceVoided(event.data.object as Stripe.Invoice));
  } else if (event.type === "invoice.marked_uncollectible") {
    ({ retry } = await handleInvoiceMarkedUncollectible(event.data.object as Stripe.Invoice));
  }

  if (retry) {
    return new Response("Transient error, please retry.", { status: 500 });
  }
  return Response.json({ received: true });
}
