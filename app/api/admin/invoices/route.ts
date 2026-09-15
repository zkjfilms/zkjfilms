import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { createInvoice } from "@/lib/invoices";
import { sendInvoiceEmail } from "@/lib/email";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

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

type LineItemPayload = { description: string; amountCents: number };

type BillingAddressPayload = { line1: string; city: string; state: string; postalCode: string } | null;

type CreatePayload = {
  clientName: string;
  clientEmail: string;
  bookingId: string | null;
  lineItems: LineItemPayload[];
  dueDate: string | null;
  sessionDateTime: string | null;
  clientPhone: string | null;
  billingAddress: BillingAddressPayload;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    (b.bookingId !== null && typeof b.bookingId !== "string") ||
    !Array.isArray(b.lineItems) ||
    b.lineItems.length === 0 ||
    !b.lineItems.every(
      (item): item is LineItemPayload =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).description === "string" &&
        ((item as Record<string, unknown>).description as string).trim().length > 0 &&
        typeof (item as Record<string, unknown>).amountCents === "number" &&
        Number.isInteger((item as Record<string, unknown>).amountCents as number) &&
        ((item as Record<string, unknown>).amountCents as number) > 0,
    ) ||
    (b.dueDate !== null && (typeof b.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))) ||
    (b.sessionDateTime !== null &&
      b.sessionDateTime !== undefined &&
      (typeof b.sessionDateTime !== "string" || b.sessionDateTime.trim().length > 140)) ||
    (b.clientPhone !== null &&
      b.clientPhone !== undefined &&
      (typeof b.clientPhone !== "string" || b.clientPhone.trim().length > 32)) ||
    !billingAddressValid
  ) {
    return null;
  }
  return {
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    bookingId: b.bookingId as string | null,
    lineItems: b.lineItems as LineItemPayload[],
    dueDate: b.dueDate as string | null,
    sessionDateTime: typeof b.sessionDateTime === "string" && b.sessionDateTime.trim() ? b.sessionDateTime.trim() : null,
    clientPhone: typeof b.clientPhone === "string" && b.clientPhone.trim() ? b.clientPhone.trim() : null,
    billingAddress,
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

  let created: Awaited<ReturnType<typeof createInvoice>>;
  try {
    created = await createInvoice({
      clientName: payload.clientName,
      clientEmail: payload.clientEmail,
      bookingId: payload.bookingId,
      lineItems: payload.lineItems,
      dueDate: payload.dueDate,
      sessionDateTime: payload.sessionDateTime,
      clientPhone: payload.clientPhone,
      billingAddress: payload.billingAddress,
    });
  } catch (err) {
    console.error("Stripe invoice creation failed:", err);
    return Response.json({ error: "Failed to create invoice in Stripe." }, { status: 502 });
  }

  const supabase = getSupabaseClient();

  // The full row includes session_date_time — a column that can, in
  // principle, not exist yet on a given deployment if a migration hasn't
  // landed (this happened live once already: the app deployed before the
  // matching `alter table` ran). If that insert fails for any reason, the
  // Stripe invoice above is already real and finalized — retry once with
  // only the table's original eight columns, so the invoice still ends up
  // as a manageable local row (voidable/resendable from the admin UI)
  // rather than an orphan only reachable from the Stripe Dashboard.
  const fullRow = {
    client_name: payload.clientName,
    client_email: payload.clientEmail,
    booking_id: payload.bookingId,
    stripe_invoice_id: created.stripeInvoiceId,
    stripe_customer_id: created.stripeCustomerId,
    status: "open" as const,
    due_date: payload.dueDate,
    hosted_invoice_url: created.hostedInvoiceUrl,
    session_date_time: payload.sessionDateTime,
  };

  let { data: invoice, error: insertError } = await supabase
    .from("invoices")
    .insert(fullRow)
    .select()
    .single();

  if (insertError) {
    console.error("invoices insert failed for full row, retrying with core columns only:", insertError);
    const coreRow = {
      client_name: fullRow.client_name,
      client_email: fullRow.client_email,
      booking_id: fullRow.booking_id,
      stripe_invoice_id: fullRow.stripe_invoice_id,
      stripe_customer_id: fullRow.stripe_customer_id,
      status: fullRow.status,
      due_date: fullRow.due_date,
      hosted_invoice_url: fullRow.hosted_invoice_url,
    };
    const fallback = await supabase.from("invoices").insert(coreRow).select().single();
    invoice = fallback.data;
    insertError = fallback.error;
    if (invoice) {
      console.warn("Invoice saved with a degraded row (session_date_time dropped):", created.stripeInvoiceId);
    }
  }

  if (insertError) {
    console.error("invoices insert failed (Stripe invoice already created):", insertError);
    return Response.json({ error: "Invoice created in Stripe but failed to save locally." }, { status: 500 });
  }

  const { error: lineItemsError } = await supabase.from("invoice_line_items").insert(
    payload.lineItems.map((item, index) => ({
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
  });
  if (!emailResult.ok) {
    console.error("Invoice email failed (invoice still created):", emailResult.error);
  }

  return Response.json({ invoice }, { status: 201 });
}
