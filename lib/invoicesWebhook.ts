// Domain logic for Stripe webhook events touching the `invoices` table —
// kept out of app/api/webhooks/stripe-invoices/route.ts so that route
// stays a thin, signature-verified dispatcher, matching
// lib/bookingsWebhook.ts's split from app/api/webhooks/stripe-bookings/route.ts.

import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { businessLocalToUtcIso, addMinutesToTime } from "@/lib/scheduling";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { sendInvoiceBookingConfirmedEmail, sendInvoiceBookingConflictEmail } from "@/lib/email";

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<{ retry: boolean }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid" })
    .eq("stripe_invoice_id", invoice.id)
    .select("id, booking_id, client_name, client_email, hosted_invoice_url")
    .maybeSingle();
  if (error) {
    console.error("Failed to mark invoice paid:", error);
    return { retry: true };
  }
  if (!data) {
    console.error("No local invoice row found for stripe_invoice_id:", invoice.id);
    return { retry: false };
  }

  // "Create new" mode invoices don't create a real booking until payment —
  // the intended session details ride along in this invoice's Stripe
  // metadata instead (see lib/invoices.ts's createInvoice). If this invoice
  // doesn't carry that intent, or already has a booking linked, there's
  // nothing more to do.
  const meta = invoice.metadata;
  if (data.booking_id || !meta || !meta.pendingBookingAppointmentTypeId) {
    return { retry: false };
  }

  const appointmentTypeId = meta.pendingBookingAppointmentTypeId;
  const date = meta.pendingBookingDate;
  const startTime = meta.pendingBookingStartTime;
  const clientPhone = meta.pendingBookingClientPhone ?? "";
  const notes = meta.pendingBookingNotes ?? "";

  const { data: type } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes")
    .eq("id", appointmentTypeId)
    .maybeSingle();

  // Any failure past this point — most likely the database's exclusion
  // constraint rejecting an overlapping booking because someone else took
  // the slot while this invoice sat unpaid, but a deleted appointment type
  // or any other insert error is treated the same way — means the payment
  // is real but the reservation isn't. Flag it for the admin rather than
  // retrying: this is a terminal state for a human to resolve (a new time,
  // a refund), not a transient failure Stripe redelivery would fix.
  let booking: {
    id: string;
    client_name: string;
    client_email: string;
    start_time: string;
    end_time: string;
    booking_token: string;
    notes: string | null;
  } | null = null;

  if (type) {
    const startIso = businessLocalToUtcIso(date, startTime);
    const endIso = businessLocalToUtcIso(date, addMinutesToTime(startTime, type.duration_minutes));
    const { data: insertedBooking, error: insertError } = await supabase
      .from("bookings")
      .insert({
        appointment_type_id: type.id,
        client_name: data.client_name,
        client_email: data.client_email,
        client_phone: clientPhone || null,
        start_time: startIso,
        end_time: endIso,
        status: "confirmed",
        notes: notes || null,
      })
      .select()
      .single();
    if (insertError) {
      console.error("Deferred booking creation failed for invoice", data.id, insertError);
    } else {
      booking = insertedBooking;
    }
  } else {
    console.error("Deferred booking creation failed: appointment type not found for invoice", data.id);
  }

  if (!booking) {
    await supabase.from("invoices").update({ booking_conflict: true }).eq("id", data.id);
    const conflictEmail = await sendInvoiceBookingConflictEmail({
      clientName: data.client_name,
      clientEmail: data.client_email,
      hostedInvoiceUrl: data.hosted_invoice_url ?? "",
    });
    if (!conflictEmail.ok) {
      console.error("Booking-conflict admin notification failed:", conflictEmail.error);
    }
    return { retry: false };
  }

  await supabase.from("invoices").update({ booking_id: booking.id }).eq("id", data.id);

  try {
    const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type!.name } });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still created):", err);
  }

  await broadcastBookingChange({ date });

  const confirmEmail = await sendInvoiceBookingConfirmedEmail({
    client_name: booking.client_name,
    client_email: booking.client_email,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_token: booking.booking_token,
    appointment_types: { name: type!.name },
  });
  if (!confirmEmail.ok) {
    console.error("Booking-confirmed email failed (booking still created):", confirmEmail.error);
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
