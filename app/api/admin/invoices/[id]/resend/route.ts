import { requireAdmin } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { sendInvoiceEmail, sendInvoiceSentNotification } from "@/lib/email";
import { getInvoiceEmailDetails } from "@/lib/invoices";

// Re-sends our own branded invoice email using the hosted_invoice_url
// already stored on the row; the itemized summary is read back from Stripe
// (read-only) so it matches the live invoice.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("client_name, client_email, hosted_invoice_url, status, stripe_invoice_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load invoice:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!invoice || !invoice.hosted_invoice_url) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "open") {
    return Response.json({ error: "Only an open invoice can be resent." }, { status: 409 });
  }

  let details: Awaited<ReturnType<typeof getInvoiceEmailDetails>>;
  try {
    details = await getInvoiceEmailDetails(invoice.stripe_invoice_id);
  } catch (err) {
    console.error("Failed to load invoice details from Stripe:", err);
    return Response.json({ error: "Failed to load invoice from Stripe." }, { status: 502 });
  }

  const result = await sendInvoiceEmail({
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    details,
  });

  if (!result.ok) {
    console.error("Failed to resend invoice email:", result.error);
    return Response.json({ error: "Failed to send email." }, { status: 502 });
  }

  const notifyResult = await sendInvoiceSentNotification({
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
  });
  if (!notifyResult.ok) {
    console.error("Invoice-sent admin notification failed:", notifyResult.error);
  }

  return Response.json({ ok: true });
}
