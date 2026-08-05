import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { handleBookingCheckoutCompleted, handleBookingCheckoutExpired } from "@/lib/bookingsWebhook";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_BOOKINGS;

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
    ({ retry } = await handleBookingCheckoutCompleted(event.data.object as Stripe.Checkout.Session));
  } else if (event.type === "checkout.session.expired") {
    await handleBookingCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }

  if (retry) {
    return new Response("Transient error, please retry.", { status: 500 });
  }
  return Response.json({ received: true });
}
