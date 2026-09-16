import { requireAdmin } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { voidInvoice } from "@/lib/invoices";

// No local status write here — the existing invoice.voided webhook
// listener (lib/invoicesWebhook.ts, wired up in Task 3) is what flips
// invoices.status to 'void', so voiding has exactly one code path
// regardless of whether it's triggered from this admin action or
// directly in Stripe's own dashboard.
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
    .select("id, stripe_invoice_id, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load invoice:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!invoice) {
    return Response.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "draft" && invoice.status !== "open") {
    return Response.json({ error: "Only a draft or open invoice can be voided." }, { status: 409 });
  }

  try {
    await voidInvoice(invoice.stripe_invoice_id);
  } catch (err) {
    console.error("Stripe void failed:", err);
    return Response.json({ error: "Failed to void invoice in Stripe." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
