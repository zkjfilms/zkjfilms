import Stripe from "stripe";

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
