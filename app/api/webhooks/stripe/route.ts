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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.purpose === "booking_deposit") {
      await handleDepositCheckoutCompleted(session);
    } else if (session.metadata?.purpose === "reschedule_fee") {
      await handleRescheduleFeeCheckoutCompleted(session);
    }
  } else if (event.type === "checkout.session.expired") {
    await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }

  return Response.json({ received: true });
}
