// Domain logic for Stripe webhook events touching the `invoices` table —
// kept out of app/api/webhooks/stripe-invoices/route.ts so that route
// stays a thin, signature-verified dispatcher, matching
// lib/bookingsWebhook.ts's split from app/api/webhooks/stripe-bookings/route.ts.

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice paid:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }
  return { retry: false };
}

export async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice void:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }
  return { retry: false };
}

export async function handleInvoiceMarkedUncollectible(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "uncollectible" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice uncollectible:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }
  return { retry: false };
}
