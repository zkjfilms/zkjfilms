import { getSupabaseClient } from "@/lib/supabase";
import { getClientIp } from "@/lib/contracts";

// Public route — no admin auth here by design, this is what the client
// hits from the signing link. Integrity instead comes from: the contract
// must exist, must not already be signed (no re-signing/tampering once
// signed), and both fields are required before the row is updated.

type Payload = { signerName: string; agreed: boolean };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { signerName, agreed } = body as Record<string, unknown>;

  if (typeof signerName !== "string" || typeof agreed !== "boolean") {
    return null;
  }

  const trimmed = signerName.trim();
  if (!trimmed || !agreed) return null;

  return { signerName: trimmed, agreed };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please type your full legal name and confirm agreement." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  const { data: contract, error: lookupError } = await supabase
    .from("contracts")
    .select("id, signed")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    console.error("Supabase contract lookup failed:", lookupError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!contract) {
    return Response.json({ error: "Contract not found." }, { status: 404 });
  }

  if (contract.signed) {
    return Response.json(
      { error: "This contract has already been signed." },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("contracts")
    .update({
      signed: true,
      signed_at: new Date().toISOString(),
      signer_name: payload.signerName,
      signer_ip: getClientIp(request),
    })
    // Re-check signed = false here too — closes the race between two
    // concurrent submissions both passing the lookup above before either
    // writes; only the first update can match this condition.
    .eq("id", id)
    .eq("signed", false)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error("Failed to record signature:", updateError);
    return Response.json(
      { error: "Failed to record signature." },
      { status: 500 },
    );
  }

  if (!updated) {
    return Response.json(
      { error: "This contract has already been signed." },
      { status: 409 },
    );
  }

  return Response.json({ ok: true, contract: updated });
}
