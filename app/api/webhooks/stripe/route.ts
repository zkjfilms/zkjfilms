import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import {
  handleDepositCheckoutCompleted,
  handleRescheduleFeeCheckoutCompleted,
  handleCheckoutExpired,
} from "@/lib/bookingWebhooks";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.purpose === "booking_deposit") {
      ({ retry } = await handleDepositCheckoutCompleted(session));
    } else if (session.metadata?.purpose === "reschedule_fee") {
      ({ retry } = await handleRescheduleFeeCheckoutCompleted(session));
    }
  } else if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }

  // A non-2xx tells Stripe to redeliver this event. Only transient
  // failures before anything was finalized set this — see
  // lib/bookingWebhooks.ts.
  if (retry) {
    return new Response("Transient error, please retry.", { status: 500 });
  }

  return Response.json({ received: true });
}
