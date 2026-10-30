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
import { lineBookingsFromMetadata } from "@/lib/invoices";

type InvoiceRow = {
  id: string;
  booking_id: string | null;
  client_name: string;
  client_email: string;
  hosted_invoice_url: string | null;
};

type PendingBooking = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientPhone: string;
  notes: string;
};

type BookingRow = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  booking_token: string;
  notes: string | null;
};

// Creates (or recovers, on redelivery) one deferred booking for a paid
// invoice, then pushes it to Google Calendar and emails the client. Returns
// null when the reservation couldn't be made — the caller flags the invoice.
async function createDeferredBooking(
  supabase: ReturnType<typeof getSupabaseClient>,
  invoiceRow: InvoiceRow,
  pending: PendingBooking,
): Promise<BookingRow | null> {
  const { data: type } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes")
    .eq("id", pending.appointmentTypeId)
    .maybeSingle();

  // Any failure past this point — most likely the database's exclusion
  // constraint rejecting an overlapping booking because someone else took
  // the slot while this invoice sat unpaid, but a deleted appointment type
  // or any other insert error is treated the same way — means the payment
  // is real but the reservation isn't. Flag it for the admin rather than
  // retrying: this is a terminal state for a human to resolve (a new time,
  // a refund), not a transient failure Stripe redelivery would fix.
  if (!type) {
    console.error("Deferred booking creation failed: appointment type not found for invoice", invoiceRow.id);
    return null;
  }

  const endTime = addMinutesToTime(pending.startTime, type.duration_minutes);
  // addMinutesToTime doesn't wrap past midnight, and businessLocalToUtcIso
  // throws on "25:00" — the admin route rejects these up front, but don't
  // let a bad value crash the whole webhook.
  if (Number(endTime.split(":")[0]) >= 24) {
    console.error("Deferred booking creation failed: session runs past midnight for invoice", invoiceRow.id);
    return null;
  }
  const startIso = businessLocalToUtcIso(pending.date, pending.startTime);
  const endIso = businessLocalToUtcIso(pending.date, endTime);

  // Redelivery guard: invoices.booking_id only gets linked *after* an
  // insert succeeds, and line bookings are never linked at all, so Stripe's
  // at-least-once redelivery of this same invoice.paid event can land here
  // again for a booking this webhook already created. Without this check,
  // the retry would hit the exclusion constraint against that booking and
  // wrongly report a real conflict. A confirmed booking already matching
  // this exact appointment/time/client is that prior success, not a
  // stranger's booking — recover it instead of re-inserting.
  const { data: existingBooking } = await supabase
    .from("bookings")
    .select()
    .eq("appointment_type_id", type.id)
    .eq("start_time", startIso)
    .eq("end_time", endIso)
    .eq("client_email", invoiceRow.client_email)
    .eq("status", "confirmed")
    .maybeSingle();

  if (existingBooking) {
    console.error(
      "Recovered a booking already created by a prior run of this webhook for invoice",
      invoiceRow.id,
      "— skipping its calendar push and confirmation email.",
    );
    // A recovered booking already went through the calendar push and
    // confirmation email on the run that actually created it — redoing
    // either here would double-book the calendar event or re-notify the
    // client for no reason.
    return existingBooking;
  }

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: invoiceRow.client_name,
      client_email: invoiceRow.client_email,
      client_phone: pending.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status: "confirmed",
      notes: pending.notes || null,
    })
    .select()
    .single();
  if (insertError || !booking) {
    console.error("Deferred booking creation failed for invoice", invoiceRow.id, insertError);
    return null;
  }

  try {
    const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
    if (eventId) {
      const { error: eventIdError } = await supabase
        .from("bookings")
        .update({ google_event_id: eventId })
        .eq("id", booking.id);
      if (eventIdError) {
        console.error("Failed to save google_event_id for booking", booking.id, eventIdError);
      }
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still created):", err);
  }

  await broadcastBookingChange({ date: pending.date });

  const confirmEmail = await sendInvoiceBookingConfirmedEmail({
    client_name: booking.client_name,
    client_email: booking.client_email,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_token: booking.booking_token,
    appointment_types: { name: type.name },
  });
  if (!confirmEmail.ok) {
    console.error("Booking-confirmed email failed (booking still created):", confirmEmail.error);
  }

  return booking;
}

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

  // Bookings deferred until payment ride along in this invoice's Stripe
  // metadata (see lib/invoices.ts's createInvoice): at most one from "Create
  // new" mode — skipped once invoices.booking_id is linked, as before — plus
  // one per dated line item with a start time and appointment type.
  const meta = invoice.metadata;
  const pending: PendingBooking[] = [];
  if (!data.booking_id && meta?.pendingBookingAppointmentTypeId) {
    pending.push({
      appointmentTypeId: meta.pendingBookingAppointmentTypeId,
      date: meta.pendingBookingDate,
      startTime: meta.pendingBookingStartTime,
      clientPhone: meta.pendingBookingClientPhone ?? "",
      notes: meta.pendingBookingNotes ?? "",
    });
  }
  const { lineBookings, clientPhone } = lineBookingsFromMetadata(meta);
  for (const lineBooking of lineBookings) {
    pending.push({ ...lineBooking, clientPhone, notes: "" });
  }
  if (pending.length === 0) {
    return { retry: false };
  }

  const booked: BookingRow[] = [];
  let anyFailed = false;
  for (const p of pending) {
    let booking: BookingRow | null = null;
    try {
      booking = await createDeferredBooking(supabase, data, p);
    } catch (err) {
      console.error("Deferred booking creation threw for invoice", data.id, err);
    }
    if (booking) booked.push(booking);
    else anyFailed = true;
  }

  if (anyFailed) {
    const { error: conflictFlagError } = await supabase
      .from("invoices")
      .update({ booking_conflict: true })
      .eq("id", data.id);
    if (conflictFlagError) {
      console.error("Failed to set booking_conflict flag for invoice", data.id, conflictFlagError);
    }
    const conflictEmail = await sendInvoiceBookingConflictEmail({
      clientName: data.client_name,
      clientEmail: data.client_email,
      hostedInvoiceUrl: data.hosted_invoice_url ?? "",
    });
    if (!conflictEmail.ok) {
      console.error("Booking-conflict admin notification failed:", conflictEmail.error);
    }
  }

  // invoices.booking_id holds a single booking, so a multi-booking invoice
  // links the first one; the rest are still real bookings on the calendar.
  if (!data.booking_id && booked.length > 0) {
    const { error: linkError } = await supabase
      .from("invoices")
      .update({ booking_id: booked[0].id })
      .eq("id", data.id);
    if (linkError) {
      console.error("Failed to link booking_id for invoice", data.id, linkError);
    }
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
