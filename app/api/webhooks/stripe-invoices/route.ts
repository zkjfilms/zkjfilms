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

  if (event.type === "invoice.paid") {
    await handleInvoicePaid(event.data.object as Stripe.Invoice);
  } else if (event.type === "invoice.voided") {
    await handleInvoiceVoided(event.data.object as Stripe.Invoice);
  } else if (event.type === "invoice.marked_uncollectible") {
    await handleInvoiceMarkedUncollectible(event.data.object as Stripe.Invoice);
  }

  return Response.json({ received: true });
}
