import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { sendSigningLinkEmail } from "@/lib/email";

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
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, client_name, client_email")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load contract:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!contract) {
    return Response.json({ error: "Contract not found." }, { status: 404 });
  }

  const result = await sendSigningLinkEmail(contract);

  if (!result.ok) {
    console.error("Failed to send signing-link email:", result.error);
    return Response.json({ error: "Failed to send email." }, { status: 502 });
  }

  const { error: updateError } = await supabase
    .from("contracts")
    .update({ email_sent: true, email_sent_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    // The email did send successfully — don't fail the request over a
    // bookkeeping update, but the dashboard's status will lag until it's
    // retried.
    console.error("Email sent but failed to record email_sent flag:", updateError);
  }

  return Response.json({ ok: true });
}
