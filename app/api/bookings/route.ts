import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createFullPaymentCheckoutSession } from "@/lib/stripe";
import { sendFreeBookingConfirmedEmail, sendBookingPaymentConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";
import { turnstileFailureResponse, verifyTurnstileToken } from "@/lib/turnstile";
import { computeDiscountedAmountCents, isDiscountCodeApplicable, type DiscountCode } from "@/lib/discountCodes";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
  honeypot: string;
  turnstileToken: string;
  discountCode: string;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.appointmentTypeId !== "string" ||
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    typeof b.clientPhone !== "string" ||
    !b.clientPhone.trim() ||
    typeof b.notes !== "string" ||
    typeof b.honeypot !== "string" ||
    (typeof b.turnstileToken !== "string" && b.turnstileToken !== undefined) ||
    (typeof b.discountCode !== "string" && b.discountCode !== undefined)
  ) {
    return null;
  }
  return {
    appointmentTypeId: b.appointmentTypeId,
    date: b.date,
    startTime: b.startTime,
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    clientPhone: b.clientPhone.trim(),
    notes: b.notes.trim(),
    honeypot: b.honeypot,
    turnstileToken: b.turnstileToken === undefined ? "" : (b.turnstileToken as string),
    discountCode: typeof b.discountCode === "string" ? b.discountCode.trim().toUpperCase() : "",
  };
}

export async function POST(request: Request) {
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Please fill out all required fields with a valid email address." }, { status: 400 });
  }

  // Honeypot: a real client never fills this hidden field. Silently
  // pretend success so a bot doesn't learn its submission was rejected.
  if (payload.honeypot) {
    return Response.json({ ok: true, checkoutUrl: null });
  }

  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({ ip, endpoint: "bookings", maxHits: 5, windowMinutes: 10 });
  if (!allowed) {
    return Response.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  if (!payload.turnstileToken) {
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const verification = await verifyTurnstileToken(payload.turnstileToken, ip);
  if (!verification.ok) {
    return turnstileFailureResponse(verification);
  }

  const supabase = getSupabaseClient();
  const { data: type, error: typeError } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("id", payload.appointmentTypeId)
    .eq("active", true)
    .maybeSingle();

  if (typeError || !type) {
    return Response.json({ error: "That appointment type is no longer available." }, { status: 404 });
  }

  // Discount codes only mean anything for a paid appointment type — a
  // code submitted alongside a free type is silently ignored rather than
  // rejected, since BookingForm only ever shows the field when
  // requiresPayment is true.
  let finalAmountCents = type.price_cents;
  let appliedDiscount: DiscountCode | null = null;
  if (type.requires_payment && payload.discountCode) {
    const { data: discount, error: discountError } = await supabase
      .from("discount_codes")
      .select("*")
      .eq("code", payload.discountCode)
      .maybeSingle();

    if (discountError) {
      console.error("discount code lookup failed:", discountError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }

    if (!discount || !isDiscountCodeApplicable(discount, type.id)) {
      return Response.json(
        { error: "That discount code is invalid or no longer available." },
        { status: 400 },
      );
    }
    appliedDiscount = discount;
    finalAmountCents = computeDiscountedAmountCents(type.price_cents, discount);
  }

  // A discount that fully covers the price (finalAmountCents === 0) skips
  // Stripe entirely and confirms immediately, same as a free appointment
  // type — there's nothing for Stripe to charge.
  const skipsStripe = !type.requires_payment || finalAmountCents === 0;

  // Re-validate against current availability at submit time — the
  // client's list may be stale by the time they submit.
  const openSlots = await fetchOpenSlotsForDate({ date: payload.date, appointmentType: type });
  if (!openSlots.some((s) => s.startTime === payload.startTime)) {
    return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  // A pending hold whose 30-minute window has already expired but was
  // never swept (e.g. a missed checkout.session.expired webhook) is
  // already excluded from fetchOpenSlotsForDate's visibility check
  // above, but the exclusion constraint below doesn't know about
  // pending_expires_at — it would still 409 this insert forever without
  // this. Clearing it here means a genuinely-open slot stays bookable
  // even if the scheduled sweep never runs.
  await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("pending_expires_at", new Date().toISOString())
    .lt("start_time", endIso)
    .gt("end_time", startIso);

  const status = skipsStripe ? "confirmed" : "pending";
  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_phone: payload.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status,
      notes: payload.notes || null,
      pending_expires_at: skipsStripe ? null : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      discount_code: appliedDiscount?.code ?? null,
      discount_cents: appliedDiscount ? type.price_cents - finalAmountCents : null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres exclusion-violation error code — someone else claimed this
    // exact time between our slot-list check above and this insert.
    if (insertError.code === "23P01") {
      return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
    }
    console.error("bookings insert failed:", insertError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (skipsStripe) {
    // Only count a redemption once the booking is actually confirmed. For
    // every other discounted booking that goes through Stripe, this same
    // RPC is called from the webhook (lib/bookingsWebhook.ts) once
    // payment completes — here there's no payment to wait for, so the
    // increment happens immediately instead.
    if (appliedDiscount) {
      const { error: redemptionError } = await supabase.rpc("increment_discount_code_redemption", {
        p_code: appliedDiscount.code,
      });
      if (redemptionError) {
        console.error("Failed to increment discount code redemption:", redemptionError);
      }
    }

    try {
      if (appliedDiscount) {
        await sendBookingPaymentConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
      } else {
        await sendFreeBookingConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
      }
    } catch (err) {
      console.error("Confirmation email failed (booking still confirmed):", err);
    }

    try {
      const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
      if (eventId) {
        await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
      }
    } catch (err) {
      console.error("Google Calendar push failed (booking still confirmed):", err);
    }

    await broadcastBookingChange({ date: payload.date });
    return Response.json({ ok: true, checkoutUrl: null, bookingToken: booking.booking_token });
  }

  try {
    const session = await createFullPaymentCheckoutSession({
      bookingId: booking.id,
      amountCents: finalAmountCents,
      appointmentTypeName: type.name,
      clientEmail: payload.clientEmail,
    });
    // A `pending` row already removes this slot from other clients' view,
    // same as a confirmed booking would.
    await broadcastBookingChange({ date: payload.date });
    return Response.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create booking checkout session:", err);
    await supabase.from("bookings").update({ status: "canceled" }).eq("id", booking.id);
    return Response.json({ error: "Something went wrong starting checkout." }, { status: 500 });
  }
}

function businessLocalToUtcIso(date: string, time: string): string {
  // Anchored with "Z" so this parses as a UTC instant regardless of the
  // host process's own timezone (mirrors businessDayUtcBounds/
  // formatSlotForDisplay in lib/scheduling.ts, which use the same
  // technique). Without the "Z", `new Date(...)` parses the string as
  // local time in the *host's* timezone, which happens to produce the
  // right answer when the process's TZ is UTC (true on Vercel/Lambda by
  // default) but silently shifts every booking's stored time by the
  // business-timezone offset — doubled — whenever the host isn't UTC
  // (e.g. `next dev` on a laptop set to America/Chicago).
  const naive = new Date(`${date}T${time}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(naive).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
