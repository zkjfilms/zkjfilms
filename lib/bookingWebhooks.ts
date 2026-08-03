// Domain logic for Stripe webhook events touching booking_slots — kept
// out of app/api/webhooks/stripe/route.ts so that route stays a thin,
// signature-verified dispatcher (same split as lib/contracts.ts /
// lib/email.ts versus the routes that call them).

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendBookingConfirmedEmail, sendRescheduleConfirmedEmail } from "@/lib/email";

const DEFAULT_TEMPLATE_TYPE = "booking_agreement";

export async function handleDepositCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  const slotId = session.metadata?.slotId;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!slotId || !paymentIntentId) {
    console.error(
      "Deposit checkout completed with missing metadata:",
      session.id,
    );
    return;
  }

  const supabase = getSupabaseClient();

  // Idempotency: only finalize a slot that's still held for this
  // checkout. A duplicate webhook delivery finds status already
  // 'booked' and no-ops here.
  const { data: slot, error: claimError } = await supabase
    .from("booking_slots")
    .update({
      status: "booked",
      deposit_payment_intent_id: paymentIntentId,
      booking_token: crypto.randomUUID(),
      refund_status: null,
      refund_amount_cents: null,
      pending_expires_at: null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to finalize deposit booking:", claimError);
    return;
  }

  if (!slot) {
    console.log(
      "Deposit checkout completed but slot wasn't pending (likely a duplicate webhook delivery):",
      slotId,
    );
    return;
  }

  // Best-effort — the booking itself already succeeded above, so a lead
  // logging failure shouldn't fail the whole request.
  try {
    const { error: leadError } = await supabase.from("leads").insert({
      name: slot.client_name,
      email: slot.client_email,
      session_type: slot.session_type,
      message: slot.client_notes || `Booked via /book for ${slot.session_type}.`,
      source: "booking",
      status: "booked",
    });
    if (leadError) {
      console.error("Failed to record lead from booking:", leadError);
    }
  } catch (err) {
    console.error("Failed to record lead from booking:", err);
  }

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", DEFAULT_TEMPLATE_TYPE)
    .maybeSingle();

  if (templateError || !template) {
    console.error("Failed to load booking_agreement template:", templateError);
    return;
  }

  const sessionDate = new Date(slot.start_time).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contractText = fillTemplate(template.content, {
    clientName: slot.client_name!,
    clientEmail: slot.client_email!,
    sessionType: slot.session_type,
    sessionDate,
  });

  const { data: contract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      template_type: DEFAULT_TEMPLATE_TYPE,
      client_name: slot.client_name,
      client_email: slot.client_email,
      contract_text: contractText,
      appointment_id: slot.id,
      appointment_date: slot.start_time,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Failed to create contract for booking:", insertError);
    return;
  }

  const emailResult = await sendBookingConfirmedEmail({
    contractId: contract.id,
    clientName: slot.client_name!,
    clientEmail: slot.client_email!,
    bookingToken: slot.booking_token,
  });

  if (!emailResult.ok) {
    console.error("Failed to send booking-confirmed email:", emailResult.error);
  } else {
    const { error: updateError } = await supabase
      .from("contracts")
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (updateError) {
      console.error("Email sent but failed to record email_sent flag:", updateError);
    }
  }
}

export async function handleRescheduleFeeCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  const bookingToken = session.metadata?.bookingToken;
  const currentSlotId = session.metadata?.currentSlotId;
  const targetSlotId = session.metadata?.targetSlotId;

  if (!bookingToken || !currentSlotId || !targetSlotId) {
    console.error(
      "Reschedule-fee checkout completed with missing metadata:",
      session.id,
    );
    return;
  }

  const supabase = getSupabaseClient();

  const { data: current, error: currentError } = await supabase
    .from("booking_slots")
    .select("id, client_name, client_email, client_notes, deposit_payment_intent_id")
    .eq("id", currentSlotId)
    .eq("status", "booked")
    .maybeSingle();

  if (currentError) {
    console.error("Failed to load current slot for reschedule swap:", currentError);
    return;
  }

  if (!current) {
    console.error(
      "Reschedule-fee checkout completed but current slot is no longer booked:",
      currentSlotId,
    );
    return;
  }

  // Idempotency: only claim a target that's still held for this
  // checkout. A duplicate webhook delivery finds status already
  // 'booked' and no-ops here.
  const { data: claimed, error: claimError } = await supabase
    .from("booking_slots")
    .update({
      status: "booked",
      client_name: current.client_name,
      client_email: current.client_email,
      client_notes: current.client_notes,
      booking_token: bookingToken,
      deposit_payment_intent_id: current.deposit_payment_intent_id,
      refund_status: null,
      refund_amount_cents: null,
      pending_expires_at: null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", targetSlotId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to claim target slot for paid reschedule:", claimError);
    return;
  }

  if (!claimed) {
    console.log(
      "Reschedule-fee checkout completed but target slot wasn't pending (likely a duplicate webhook delivery):",
      targetSlotId,
    );
    return;
  }

  const { error: releaseError } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      booked_at: null,
      booking_token: null,
      deposit_payment_intent_id: null,
    })
    .eq("id", current.id);

  if (releaseError) {
    console.error("Failed to release original slot after paid reschedule:", releaseError);
  }

  const emailResult = await sendRescheduleConfirmedEmail(claimed);
  if (!emailResult.ok) {
    console.error("Failed to send reschedule confirmation email:", emailResult.error);
  }
}

export async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const purpose = session.metadata?.purpose;
  const slotId =
    purpose === "booking_deposit"
      ? session.metadata?.slotId
      : session.metadata?.targetSlotId;

  if (!slotId) {
    console.error("Checkout expired with no slot id in metadata:", session.id);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("booking_slots")
    .update({
      status: "open",
      client_name: null,
      client_email: null,
      client_notes: null,
      pending_expires_at: null,
    })
    .eq("id", slotId)
    .eq("status", "pending");

  if (error) {
    console.error("Failed to release expired pending slot:", error);
  }
}
