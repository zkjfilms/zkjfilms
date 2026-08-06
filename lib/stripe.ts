import Stripe from "stripe";
import { SITE_URL } from "@/lib/seo";

// Server-side Stripe client. Mirrors lib/supabase.ts's
// getSupabaseClient() — a fresh client per call, no shared module-level
// singleton, so nothing here can leak across requests.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function getStripeClient(): Stripe {
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"));
}

const HOLD_SECONDS = 30 * 60;

export async function createFullPaymentCheckoutSession(params: {
  bookingId: string;
  amountCents: number;
  appointmentTypeName: string;
  clientEmail: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: params.clientEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: { name: params.appointmentTypeName },
        },
        quantity: 1,
      },
    ],
    metadata: { purpose: "booking_payment", bookingId: params.bookingId },
    success_url: `${SITE_URL}/book/confirmed`,
    cancel_url: `${SITE_URL}/book`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
  });
}
