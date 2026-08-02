import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { fillTemplate } from "@/lib/contracts";

type Payload = {
  templateType: string;
  clientName: string;
  clientEmail: string;
  sessionType: string;
  sessionDate: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { templateType, clientName, clientEmail, sessionType, sessionDate } =
    body as Record<string, unknown>;

  if (
    typeof templateType !== "string" ||
    typeof clientName !== "string" ||
    typeof clientEmail !== "string" ||
    typeof sessionType !== "string" ||
    typeof sessionDate !== "string"
  ) {
    return null;
  }

  const trimmed = {
    templateType: templateType.trim(),
    clientName: clientName.trim(),
    clientEmail: clientEmail.trim(),
    sessionType: sessionType.trim(),
    sessionDate: sessionDate.trim(),
  };

  if (
    !trimmed.templateType ||
    !trimmed.clientName ||
    !EMAIL_REGEX.test(trimmed.clientEmail)
  ) {
    return null;
  }

  return trimmed;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please fill out all fields with a valid email address." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();

  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", payload.templateType)
    .maybeSingle();

  if (templateError) {
    console.error("Failed to load template:", templateError);
    return Response.json(
      { error: "Failed to load template." },
      { status: 500 },
    );
  }

  if (!template) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }

  // Snapshotted into contract_text at creation time — later edits to the
  // template row never change this already-created contract.
  const contractText = fillTemplate(template.content, {
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    sessionType: payload.sessionType,
    sessionDate: payload.sessionDate,
  });

  const { data: contract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      template_type: payload.templateType,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      contract_text: contractText,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Failed to create contract:", insertError);
    return Response.json(
      { error: "Failed to create contract." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, contract });
}
