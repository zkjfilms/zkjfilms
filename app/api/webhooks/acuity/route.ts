import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";
import { sendSigningLinkEmail } from "@/lib/email";
import { fetchAcuityAppointment, verifyAcuitySignature } from "@/lib/acuity";

// Only new bookings create a contract for now — rescheduled/canceled/
// changed events are acknowledged (200, so Acuity doesn't retry) but
// otherwise ignored.
const HANDLED_ACTIONS = new Set(["scheduled"]);

// Hardcoded per the original request — appointment-type-based template
// selection (e.g. also generating a model_release for boudoir sessions)
// is a follow-up.
const DEFAULT_TEMPLATE_TYPE = "booking_agreement";

const POSTGRES_UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  // Read the raw body before any parsing — the signature is computed
  // over these exact bytes, and re-serializing a parsed version would
  // break verification.
  const rawBody = await request.text();

  if (
    !verifyAcuitySignature(rawBody, request.headers.get("x-acuity-signature"))
  ) {
    console.error("Acuity webhook signature verification failed.");
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const action = params.get("action");
  const appointmentId = params.get("id");

  if (!action || !appointmentId) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!HANDLED_ACTIONS.has(action)) {
    return Response.json({ ok: true, skipped: action });
  }

  const supabase = getSupabaseClient();

  // Idempotent: a retried or duplicate delivery for the same appointment
  // must never create a second contract or send a second email.
  const { data: existing, error: existingError } = await supabase
    .from("contracts")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to check for existing contract:", existingError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (existing) {
    return Response.json({ ok: true, alreadyProcessed: true });
  }

  let appointment;
  try {
    appointment = await fetchAcuityAppointment(appointmentId);
  } catch (err) {
    console.error("Failed to fetch Acuity appointment:", err);
    return Response.json(
      { error: "Failed to fetch appointment details." },
      { status: 502 },
    );
  }

  const clientName = `${appointment.firstName} ${appointment.lastName}`.trim();
  const clientEmail = appointment.email;

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", DEFAULT_TEMPLATE_TYPE)
    .maybeSingle();

  if (templateError || !template) {
    console.error("Failed to load booking_agreement template:", templateError);
    return Response.json({ error: "Template not found." }, { status: 500 });
  }

  const sessionDate = new Date(appointment.datetime).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  const contractText = fillTemplate(template.content, {
    clientName,
    clientEmail,
    sessionType: appointment.type,
    sessionDate,
  });

  const { data: contract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      template_type: DEFAULT_TEMPLATE_TYPE,
      client_name: clientName,
      client_email: clientEmail,
      contract_text: contractText,
      appointment_id: appointmentId,
      appointment_date: appointment.datetime,
    })
    .select()
    .single();

  if (insertError) {
    // Lost a race with a concurrent duplicate delivery for the same
    // appointment — the other request already created the contract.
    if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
      return Response.json({ ok: true, alreadyProcessed: true });
    }
    console.error("Failed to create contract:", insertError);
    return Response.json(
      { error: "Failed to create contract." },
      { status: 500 },
    );
  }

  // The contract already exists at this point regardless of whether the
  // email send below succeeds — a failure here doesn't roll anything
  // back. email_sent stays false, and the admin dashboard's Send/Resend
  // action (see app/api/admin/contracts/[id]/send-email/route.ts) covers
  // retrying it, either automatically-if-noticed or on request.
  const emailResult = await sendSigningLinkEmail(contract);

  if (!emailResult.ok) {
    console.error("Failed to send signing-link email:", emailResult.error);
    return Response.json({ ok: true, contract, emailSent: false });
  }

  const { error: updateError } = await supabase
    .from("contracts")
    .update({ email_sent: true, email_sent_at: new Date().toISOString() })
    .eq("id", contract.id);

  if (updateError) {
    console.error("Email sent but failed to record email_sent flag:", updateError);
  }

  return Response.json({ ok: true, contract, emailSent: true });
}
