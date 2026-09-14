import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { sendInvoiceEmail } from "@/lib/email";

// No Stripe API call at all — this only re-sends our own notification
// email using the hosted_invoice_url already stored on the row.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = getSupabaseClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("client_name, client_email, hosted_invoice_url, status")
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

  const result = await sendInvoiceEmail({
    clientName: invoice.client_name,
    clientEmail: invoice.client_email,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
  });

  if (!result.ok) {
    console.error("Failed to resend invoice email:", result.error);
    return Response.json({ error: "Failed to send email." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
