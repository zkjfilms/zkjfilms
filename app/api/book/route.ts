import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendSigningLinkEmail } from "@/lib/email";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TEMPLATE_TYPE = "booking_agreement";

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

  // Race-safe claim: only succeeds if the slot is still open, so two
  // clients hitting the same slot at once can't both win it.
  const { data: slot, error: claimError } = await supabase
    .from("booking_slots")
    .update({
      status: "booked",
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_notes: payload.notes || null,
      booked_at: new Date().toISOString(),
    })
    .eq("id", payload.slotId)
    .eq("status", "open")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to claim booking slot:", claimError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!slot) {
    return Response.json(
      { error: "That time is no longer available. Please pick another." },
      { status: 409 },
    );
  }

  // Best-effort — the booking itself already succeeded above, so a lead
  // logging failure shouldn't fail the whole request.
  try {
    const { error: leadError } = await supabase.from("leads").insert({
      name: payload.clientName,
      email: payload.clientEmail,
      session_type: slot.session_type,
      message: payload.notes || `Booked via /book for ${slot.session_type}.`,
      source: "booking",
      status: "booked",
    });
    if (leadError) {
      console.error("Failed to record lead from booking:", leadError);
    }
  } catch (err) {
    console.error("Failed to record lead from booking:", err);
  }

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", DEFAULT_TEMPLATE_TYPE)
    .maybeSingle();

  if (templateError || !template) {
    console.error("Failed to load booking_agreement template:", templateError);
    // The booking itself already succeeded — don't fail the client-facing
    // request over a missing contract template.
    return Response.json({ ok: true, slot, contract: null });
  }

  const sessionDate = new Date(slot.start_time).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contractText = fillTemplate(template.content, {
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    sessionType: slot.session_type,
    sessionDate,
  });

  const { data: contract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      template_type: DEFAULT_TEMPLATE_TYPE,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      contract_text: contractText,
      appointment_id: slot.id,
      appointment_date: slot.start_time,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Failed to create contract for booking:", insertError);
    return Response.json({ ok: true, slot, contract: null });
  }

  const emailResult = await sendSigningLinkEmail(contract);
  if (!emailResult.ok) {
    console.error(
      "Failed to send signing-link email for booking:",
      emailResult.error,
    );
  } else {
    const { error: updateError } = await supabase
      .from("contracts")
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (updateError) {
      console.error("Email sent but failed to record email_sent flag:", updateError);
    }
  }

  return Response.json({ ok: true, slot, contract });
}
