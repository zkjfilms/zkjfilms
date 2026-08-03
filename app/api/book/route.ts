import { getSupabaseClient } from "@/lib/supabase";
import { createDepositCheckoutSession } from "@/lib/stripe";
import { PENDING_HOLD_MINUTES } from "@/lib/booking";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  slotId: string;
  clientName: string;
  clientEmail: string;
  notes: string;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slotId, clientName, clientEmail, notes } = body as Record<
    string,
    unknown
  >;

  if (
    typeof slotId !== "string" ||
    typeof clientName !== "string" ||
    typeof clientEmail !== "string" ||
    typeof notes !== "string"
  ) {
    return null;
  }

  const trimmed = {
    slotId: slotId.trim(),
    clientName: clientName.trim(),
    clientEmail: clientEmail.trim(),
    notes: notes.trim(),
  };

  if (
    !trimmed.slotId ||
    !trimmed.clientName ||
    !EMAIL_REGEX.test(trimmed.clientEmail)
  ) {
    return null;
  }

  return trimmed;
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please fill out all required fields with a valid email address." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  // Race-safe hold: only succeeds if the slot is still open, so two
  // clients hitting the same slot at once can't both start checkout for
  // it.
  const { data: slot, error: holdError } = await supabase
    .from("booking_slots")
    .update({
      status: "pending",
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_notes: payload.notes || null,
      pending_expires_at: new Date(
        Date.now() + PENDING_HOLD_MINUTES * 60 * 1000,
      ).toISOString(),
    })
    .eq("id", payload.slotId)
    .eq("status", "open")
    .select("id, deposit_cents, session_type")
    .maybeSingle();

  if (holdError) {
    console.error("Failed to hold booking slot:", holdError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!slot) {
    return Response.json(
      { error: "That time is no longer available. Please pick another." },
      { status: 409 },
    );
  }

  try {
    const session = await createDepositCheckoutSession({
      slotId: slot.id,
      amountCents: slot.deposit_cents,
      sessionType: slot.session_type,
      clientEmail: payload.clientEmail,
    });

    return Response.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create deposit checkout session:", err);
    // Release the hold — no point leaving the slot stuck pending if we
    // couldn't even start checkout.
    await supabase
      .from("booking_slots")
      .update({
        status: "open",
        client_name: null,
        client_email: null,
        client_notes: null,
        pending_expires_at: null,
      })
      .eq("id", slot.id)
      .eq("status", "pending");

    return Response.json(
      { error: "Something went wrong starting checkout." },
      { status: 500 },
    );
  }
}
