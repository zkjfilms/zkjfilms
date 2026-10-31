import { requireAdmin } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { createInvoice, MAX_LINE_BOOKINGS, type LineBooking } from "@/lib/invoices";
import { sendInvoiceEmail, sendInvoiceSentNotification } from "@/lib/email";
import { EMAIL_REGEX, addMinutesToTime, businessLocalToUtcIso } from "@/lib/scheduling";
import { formatDateOnly, formatTimeRange } from "@/lib/format";
import { STUDIO_ADDRESS } from "@/lib/seo";

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_line_items(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("invoices list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ invoices: data });
}

type LineItemPayload = {
  description: string;
  date: string | null;
  amountCents: number;
  booking: LineBooking | null;
};

// Optional per-line-item service date ("YYYY-MM-DD") for multi-day jobs. In
// POST it's folded into the description ("Oct 3, 2026 — Headshots", or the
// full time range for a booked line) rather than stored separately, so it
// reads the same on the Stripe hosted invoice/PDF, in the local
// invoice_line_items row, and in the admin list — no schema change. A dated
// line can also carry a booking ({ appointmentTypeId, startTime }), created
// on payment by the stripe-invoices webhook.
function parseLineItem(item: unknown): LineItemPayload | null {
  if (typeof item !== "object" || item === null) return null;
  const v = item as Record<string, unknown>;
  if (
    typeof v.description !== "string" ||
    !v.description.trim() ||
    typeof v.amountCents !== "number" ||
    !Number.isInteger(v.amountCents) ||
    v.amountCents <= 0 ||
    (v.date !== null && v.date !== undefined && (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)))
  ) {
    return null;
  }
  let booking: LineBooking | null = null;
  if (v.booking !== null && v.booking !== undefined) {
    const raw = v.booking as Record<string, unknown>;
    if (
      typeof v.date !== "string" ||
      typeof raw !== "object" ||
      typeof raw.appointmentTypeId !== "string" ||
      !raw.appointmentTypeId.trim() ||
      typeof raw.startTime !== "string" ||
      !/^\d{2}:\d{2}$/.test(raw.startTime)
    ) {
      return null;
    }
    booking = { appointmentTypeId: raw.appointmentTypeId, date: v.date, startTime: raw.startTime };
  }
  return {
    description: v.description.trim(),
    date: typeof v.date === "string" ? v.date : null,
    amountCents: v.amountCents,
    booking,
  };
}

type BillingAddressPayload = { line1: string; city: string; state: string; postalCode: string } | null;

type CreatePayload = {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: LineItemPayload[];
  dueDate: string | null;
  clientPhone: string | null;
  billingAddress: BillingAddressPayload;
  bookingNotes: string | null;
  location: string | null;
};

function parseBillingAddress(value: unknown): { value: BillingAddressPayload; valid: boolean } {
  if (value === null || value === undefined) return { value: null, valid: true };
  if (typeof value !== "object") return { value: null, valid: false };
  const v = value as Record<string, unknown>;
  const fields = ["line1", "city", "state", "postalCode"] as const;
  const parsed: Record<string, string> = {};
  for (const field of fields) {
    const raw = v[field];
    if (raw === undefined) {
      parsed[field] = "";
      continue;
    }
    if (typeof raw !== "string" || raw.trim().length > 100) return { value: null, valid: false };
    parsed[field] = raw.trim();
  }
  const isBlank = fields.every((field) => !parsed[field]);
  if (isBlank) return { value: null, valid: true };
  return {
    value: { line1: parsed.line1, city: parsed.city, state: parsed.state, postalCode: parsed.postalCode },
    valid: true,
  };
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const { value: billingAddress, valid: billingAddressValid } = parseBillingAddress(b.billingAddress);
  const lineItems = Array.isArray(b.lineItems) ? b.lineItems.map(parseLineItem) : [];

  if (
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    (b.bookingId !== null && typeof b.bookingId !== "string") ||
    lineItems.length === 0 ||
    !lineItems.every((item): item is LineItemPayload => item !== null) ||
    (b.dueDate !== null && (typeof b.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.trim().length > 32)) ||
    (b.bookingNotes !== null &&
      b.bookingNotes !== undefined &&
      // Rides along in Stripe invoice metadata (lineBookingNotes in
      // lib/invoices.ts), which caps each value at 500 chars — this leaves
      // headroom under that limit rather than sitting flush against it.
      (typeof b.bookingNotes !== "string" || b.bookingNotes.trim().length > 450)) ||
    (b.location !== null &&
      b.location !== undefined &&
      // Shown as a Stripe invoice custom field, whose values cap at 140 chars.
      (typeof b.location !== "string" || b.location.trim().length > 140)) ||
    !billingAddressValid
  ) {
    return null;
  }
  return {
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    bookingId: b.bookingId as string | null,
    lineItems: lineItems as LineItemPayload[],
    dueDate: b.dueDate as string | null,
    clientPhone: typeof b.clientPhone === "string" && b.clientPhone.trim() ? b.clientPhone.trim() : null,
    billingAddress,
    bookingNotes: typeof b.bookingNotes === "string" && b.bookingNotes.trim() ? b.bookingNotes.trim() : null,
    location: typeof b.location === "string" && b.location.trim() ? b.location.trim() : null,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid invoice." }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  // Checked before anything is created in Stripe: the webhook can't ask the
  // admin to fix a bad line booking after the client has already paid.
  const lineBookings = payload.lineItems.flatMap((item) => (item.booking ? [item.booking] : []));
  if (lineBookings.length > MAX_LINE_BOOKINGS) {
    return Response.json({ error: `An invoice can book at most ${MAX_LINE_BOOKINGS} line items.` }, { status: 400 });
  }
  const durations = new Map<string, number>();
  if (lineBookings.length > 0) {
    const typeIds = [...new Set(lineBookings.map((b) => b.appointmentTypeId))];
    const { data: types, error: typesError } = await supabase
      .from("appointment_types")
      .select("id, duration_minutes")
      .in("id", typeIds);
    if (typesError) {
      console.error("appointment_types lookup failed:", typesError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
    for (const b of lineBookings) {
      const type = types?.find((t) => t.id === b.appointmentTypeId);
      if (!type) {
        return Response.json({ error: "A booked line item has an unknown appointment type." }, { status: 400 });
      }
      // addMinutesToTime doesn't wrap past midnight.
      if (Number(addMinutesToTime(b.startTime, type.duration_minutes).split(":")[0]) >= 24) {
        return Response.json({ error: "A booked line item would run past midnight." }, { status: 400 });
      }
      durations.set(type.id, type.duration_minutes);
    }
  }

  // Booked lines show their full session time range ("Sat, Oct 3 ·
  // 10:00 AM–2:00 PM CDT — Headshots"), the same string the old
  // "Session date & time" field used to carry; dated-only lines show the date.
  const lineItems = payload.lineItems.map((item) => {
    let label: string | null = null;
    if (item.booking) {
      const { date, startTime, appointmentTypeId } = item.booking;
      const endTime = addMinutesToTime(startTime, durations.get(appointmentTypeId)!);
      label = formatTimeRange(businessLocalToUtcIso(date, startTime), businessLocalToUtcIso(date, endTime));
    } else if (item.date) {
      label = formatDateOnly(item.date);
    }
    return { description: label ? `${label} — ${item.description}` : item.description, amountCents: item.amountCents };
  });

  let created: Awaited<ReturnType<typeof createInvoice>>;
  try {
    created = await createInvoice({
      clientName: payload.clientName,
      clientEmail: payload.clientEmail,
      bookingId: payload.bookingId,
      lineItems,
      dueDate: payload.dueDate,
      clientPhone: payload.clientPhone,
      billingAddress: payload.billingAddress,
      lineBookings,
      bookingNotes: payload.bookingNotes,
      // Only meaningful when something gets booked; defaults to the studio.
      location: lineBookings.length > 0 ? (payload.location ?? STUDIO_ADDRESS) : null,
    });
  } catch (err) {
    console.error("Stripe invoice creation failed:", err);
    return Response.json({ error: "Failed to create invoice in Stripe." }, { status: 502 });
  }

  const { data: invoice, error: insertError } = await supabase
    .from("invoices")
    .insert({
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      booking_id: payload.bookingId,
      stripe_invoice_id: created.stripeInvoiceId,
      stripe_customer_id: created.stripeCustomerId,
      status: "open" as const,
      due_date: payload.dueDate,
      hosted_invoice_url: created.hostedInvoiceUrl,
    })
    .select()
    .single();

  if (insertError) {
    console.error("invoices insert failed (Stripe invoice already created):", insertError);
    return Response.json({ error: "Invoice created in Stripe but failed to save locally." }, { status: 500 });
  }

  const { error: lineItemsError } = await supabase.from("invoice_line_items").insert(
    lineItems.map((item, index) => ({
      invoice_id: invoice.id,
      description: item.description.trim(),
      amount_cents: item.amountCents,
      sort_order: index,
    })),
  );
  if (lineItemsError) {
    console.error("invoice_line_items insert failed:", lineItemsError);
  }

  const emailResult = await sendInvoiceEmail({
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    hostedInvoiceUrl: created.hostedInvoiceUrl,
    details: {
      invoiceNumber: created.invoiceNumber,
      items: lineItems,
      totalCents: lineItems.reduce((sum, item) => sum + item.amountCents, 0),
      dueDate: created.dueDateIso,
      location: lineBookings.length > 0 ? (payload.location ?? STUDIO_ADDRESS) : null,
    },
  });
  if (!emailResult.ok) {
    console.error("Invoice email failed (invoice still created):", emailResult.error);
  }

  const notifyResult = await sendInvoiceSentNotification({
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    hostedInvoiceUrl: created.hostedInvoiceUrl,
    clientEmailFailed: !emailResult.ok,
  });
  if (!notifyResult.ok) {
    console.error("Invoice-sent admin notification failed:", notifyResult.error);
  }

  return Response.json({ invoice }, { status: 201 });
}
